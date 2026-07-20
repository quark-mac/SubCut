"""
scene_segmenter.py — 自动生成可编辑的场景分段。

目标：
  不要求人工填写 keep / merge / split 操作。默认只生成：
    - scene_segments.srt：可拖进字幕编辑软件调整时间轴，正文是场景概要
    - scene_segments.json：给 gemini_segment_diarize.py 消费

推荐流程：
  1. 使用文字 LLM 生成语义分段：
     env\python.exe sub\llm\scene_segmenter.py "Cosmic Princess Kaguya" --llm-refine

  2. 如有必要，用字幕编辑软件调整 scene_segments.srt 的时间轴。

  3. 使用 scene_srt_to_json.py 把编辑后的场景 SRT 映射回 JSON。

  4. 用 gemini_segment_diarize.py --segments-json scene_segments.json 批量标注。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sub._srt_io import NormalizedEntry, parse_srt, seconds_to_srt_time
from sub.llm.diarize_llm import (
    DEFAULT_CONFIG_PATH as LLM_DEFAULT_CONFIG_PATH,
    INTERMEDIATE_ROOT,
    _make_client,
    call_llm,
    load_config,
)
from sub.llm.gemini_segment_diarize import Segment, _resolve_srt


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="自动生成/转换场景分段文件",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("project", help="项目名，对应 sub/input/<project>/")
    parser.add_argument("--srt", type=Path, default=None, help="输入 SRT，默认 normalized.srt，缺失时回退 llm_corrected.srt")
    parser.add_argument("--pre-roll", type=float, default=1.5, help="片段前扩展秒数")
    parser.add_argument("--post-roll", type=float, default=1.5, help="片段后扩展秒数")
    parser.add_argument("--context-before", type=float, default=5.0, help="前置上下文秒数")
    parser.add_argument("--llm-window-entries", type=int, default=80, help="LLM 每批负责判断多少个候选边界（默认 80）")
    parser.add_argument("--llm-context-entries", type=int, default=20, help="LLM 判断窗口前后附加多少条上下文（默认 20）")
    parser.add_argument("--llm-max-prompt-chars", type=int, default=50000, help="单次 LLM prompt 最大字符数，超出时自动拆批（默认 50000）")
    parser.add_argument("--warn-scene-seconds", type=float, default=120.0, help="scene 超过 N 秒时告警但不自动拆分，0=关闭（默认 120）")
    parser.add_argument("--llm-refine", action="store_true", help="第二遍重审超长、极短和可疑 scene，可添加或删除边界")
    parser.add_argument("--llm-refine-from", type=Path, default=None, help="直接读取已有 scene_segments.json 做第二遍重审，跳过第一遍调用")
    parser.add_argument("--llm-refine-max-seconds", type=float, default=75.0, help="超过 N 秒的 scene 进入二次重审（默认 75）")
    parser.add_argument("--llm-refine-max-entries", type=int, default=0, help="超过 N 条字幕的 scene 进入预算细分，0=关闭（默认关闭，实验性）")
    parser.add_argument("--llm-refine-min-seconds", type=float, default=5.0, help="短于 N 秒的 scene 进入二次重审（默认 5）")
    parser.add_argument("--llm-refine-neighbor-scenes", type=int, default=1, help="二次重审时向问题 scene 两侧扩展的 scene 数（默认 1）")
    parser.add_argument("--llm-refine-region-entries", type=int, default=120, help="单个二次重审区域最多字幕数（默认 120）")
    parser.add_argument("--llm-refine-passes", type=int, default=2, help="二次重审迭代轮数；0=只读取已有 JSON（默认 2）")
    parser.add_argument("--llm-max-batches", type=int, default=0, help="最多调用 N 个 LLM 边界批次，0=不限（用于测试）")
    parser.add_argument("--llm-plan-only", action="store_true", help="只统计全片 LLM 请求规模，不调用 API 或生成场景")
    parser.add_argument("--dump-llm-prompts", action="store_true", help="保存 LLM 场景边界 prompt 和原始响应")
    parser.add_argument(
        "--summary-mode",
        choices=("preview", "llm"),
        default="preview",
        help="场景 SRT 正文生成方式：preview=截取字幕预览；llm=文本 LLM 总结（默认 preview）",
    )
    parser.add_argument("--llm-config", type=Path, default=LLM_DEFAULT_CONFIG_PATH, help="文本 LLM 配置文件")
    parser.add_argument("--llm-batch-size", type=int, default=12, help="LLM 摘要每批处理多少个场景（默认 12）")
    parser.add_argument("--max-scenes", type=int, default=0, help="最多生成 N 个场景，0=不限（用于测试）")
    parser.add_argument("--output-dir", type=Path, default=None, help="输出目录")
    return parser.parse_args()


def _entry_text(entry: NormalizedEntry) -> str:
    return " ".join(entry.text.replace("\\N", " / ").split())


def _select_entries(entries: list[NormalizedEntry]) -> list[NormalizedEntry]:
    return [entry for entry in entries if entry.speaker != "NONSPEECH" and "♪" not in entry.text]


def _summary_preview(entries: list[NormalizedEntry]) -> str:
    if not entries:
        return "空场景"
    first = _entry_text(entries[0])
    last = _entry_text(entries[-1])
    if len(entries) == 1:
        return first
    return f"{first} / ... / {last}"


def _segment_name(segment: Any) -> str:
    return f"scene_{segment.idx:04d}_{segment.entries[0].idx}-{segment.entries[-1].idx}"


def _segment_to_json(segment: Any, summary: str | None = None) -> dict[str, Any]:
    return {
        "scene_id": segment.idx,
        "enabled": True,
        "name": summary or _segment_name(segment),
        "start_idx": segment.entries[0].idx,
        "end_idx": segment.entries[-1].idx,
        "start": round(segment.entries[0].start, 3),
        "end": round(segment.entries[-1].end, 3),
    }


def _format_boundary_entry(
    entry: NormalizedEntry,
    can_cut_after: bool,
    current_cut_after: bool = False,
) -> str:
    text = _entry_text(entry)
    tags = " ".join(f"{{{tag}}}" for tag in entry.tags)
    metadata = " ".join(part for part in (f"[{entry.speaker}]", tags) if part)
    marker = "  <CUT_CANDIDATE_AFTER>" if can_cut_after else ""
    if current_cut_after:
        marker += " <CURRENT_CUT_AFTER>"
    return (
        f"[{entry.idx}] {seconds_to_srt_time(entry.start)} --> {seconds_to_srt_time(entry.end)} "
        f"{metadata} {text}{marker}"
    )


def _boundary_prompt(
    context_entries: list[NormalizedEntry],
    candidate_idxs: set[int],
) -> str:
    lines = [_format_boundary_entry(entry, entry.idx in candidate_idxs) for entry in context_entries]
    return """请判断下面动画字幕中的语义场景边界。

“场景”指同一个地点、事件、连续对话或叙事段落。speaker 标签仅帮助理解上下文，不需要修正。

应该切分：
- 地点、时间或事件明确变化
- 一个事件结束并开始新的事件
- 旁白与现场对话发生结构性切换
- 对话参与者或主题明显改变
- 音乐、音效或较长无台词段明确承担转场作用
- 同一大场景内出现可独立理解的新行动、新对话阶段或新小事件

不应该切分：
- 问题和紧接着的回答之间
- 连续喘息、惊叫、动作反应之间
- 同一段旁白或同一事件中的短暂停顿
- 仅仅因为台词较多、持续时间较长或 speaker 轮换

划分尺度：
- 目标是便于后续多模态 speaker labeling 的事件级片段，不是整段剧情章节，也不是逐镜头切分
- 一个 scene 通常约 20 到 75 秒；连续事件可以更短或更长，不要机械按时间切
- 如果连续 75 到 120 秒内已经发生多个可独立描述的小事件，应在自然承接处切开
- 请检查所有候选位置，不要只输出最明显的一两个大转场

只有标有 <CUT_CANDIDATE_AFTER> 的字幕后方由你负责判断。未标记的字幕只是上下文。
如果某个候选位置不是自然边界，不要输出它。不要为了均匀长度而强行切分。

只输出 JSON 对象：
{
  "cuts": [
    {
      "after_idx": <在该字幕之后切分>,
      "title": "<刚结束场景的简短中文标题>",
      "reason": "<简短边界理由>"
    }
  ]
}

没有自然边界时输出 {"cuts": []}。

字幕：
""" + "\n".join(lines)


def _parse_boundary_response(raw: str, candidate_idxs: set[int]) -> list[dict[str, Any]]:
    text = raw.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("响应中找不到 JSON 对象")
    data = json.loads(text[start:end + 1])
    if not isinstance(data, dict) or not isinstance(data.get("cuts"), list):
        raise ValueError("响应必须是包含 cuts 数组的 JSON 对象")

    cuts: list[dict[str, Any]] = []
    seen: set[int] = set()
    for item in data["cuts"]:
        if not isinstance(item, dict):
            raise ValueError("cuts 中包含非对象记录")
        try:
            after_idx = int(item["after_idx"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"无效的 after_idx: {item}") from exc
        if after_idx not in candidate_idxs:
            print(
                f"[warn] 忽略 LLM 返回的上下文边界 after_idx={after_idx}；该位置不由本批负责",
                file=sys.stderr,
            )
            continue
        if after_idx in seen:
            continue
        seen.add(after_idx)
        cuts.append({
            "after_idx": after_idx,
            "title": " ".join(str(item.get("title", "")).split()),
            "reason": " ".join(str(item.get("reason", "")).split()),
        })
    cuts.sort(key=lambda item: item["after_idx"])
    return cuts


def _load_cached_response(
    prompt_path: Path,
    response_path: Path,
    prompt: str,
    candidate_idxs: set[int],
) -> list[dict[str, Any]] | None:
    if not prompt_path.exists() or not response_path.exists():
        return None
    if prompt_path.read_text(encoding="utf-8") != prompt:
        return None
    raw = response_path.read_text(encoding="utf-8")
    try:
        return _parse_boundary_response(raw, candidate_idxs)
    except (ValueError, json.JSONDecodeError):
        return None


def _refine_prompt(
    entries: list[NormalizedEntry],
    candidate_idxs: set[int],
    current_cut_idxs: set[int],
    max_seconds: float,
    max_entries: int,
) -> str:
    lines = [
        _format_boundary_entry(
            entry,
            entry.idx in candidate_idxs,
            entry.idx in current_cut_idxs,
        )
        for entry in entries
    ]
    budget_lines: list[str] = []
    if max_seconds > 0:
        budget_lines.append(f"- 每个最终 scene 应不超过约 {max_seconds:g} 秒")
    if max_entries > 0:
        budget_lines.append(f"- 每个最终 scene 应不超过 {max_entries} 条目标字幕")
    budget_text = "\n".join(budget_lines) or "- 不设置数值预算，只按语义完整性判断"
    return f"""请重新整理下面动画字幕区域的 scene 边界，输出该区域应保留的最终切点。

背景：第一遍自动划分中可能存在 scene 过长、单条 scene、漏切，或在问答/回忆/连续动作中间误切的问题。

标记说明：
- <CUT_CANDIDATE_AFTER>：允许在该字幕后切分
- <CURRENT_CUT_AFTER>：第一遍目前已有切点；可以保留，也可以删除

目标：
- 每个 scene 是同一地点、事件、连续对话或叙事段落
- 优先形成事件级片段，不要逐镜头切分
- 除非确实是独立转场或孤立画面，不要生成只有 1 条字幕或不足 5 秒的 scene
- 问题与回答、口号与回应、闹钟与紧接的反应、连续回忆、连续独白不能从中间切开
- 同一大场景出现新行动、新地点、新对话阶段或可独立描述的小事件时，应自然切开
- 不要机械追求均匀长度；在自然承接处参考下面的目标预算：
{budget_text}
- 如果当前 scene 超过上述任一预算且已经包含多个独立子事件，应寻找自然边界；如果仍是一个连续对话或拆分会丢失关键前后文，可以原样保留

输出要求：
- 输出该区域内部应该保留的全部最终切点，不只是新增或删除的变化
- 只能输出标有 <CUT_CANDIDATE_AFTER> 的 after_idx
- 不需要输出区域最后一条字幕后的固定边界
- 每个 title 描述刚结束的 scene
- 只输出 JSON 对象

格式：
{{
  "cuts": [
    {{"after_idx": 123, "title": "简短中文标题", "reason": "简短理由"}}
  ]
}}

字幕：
""" + "\n".join(lines)


def _segments_from_cut_idxs(
    selected: list[NormalizedEntry],
    all_entries: list[NormalizedEntry],
    cut_idxs: set[int],
    context_before: float,
    pre_roll: float,
    post_roll: float,
) -> list[Segment]:
    segments: list[Segment] = []
    current: list[NormalizedEntry] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        context_start = max(0.0, current[0].start - context_before)
        context_entries = [
            entry for entry in all_entries
            if entry.idx < current[0].idx
            and entry.end >= context_start
            and entry.start < current[0].start
        ]
        start = max(0.0, current[0].start - pre_roll - context_before)
        end = current[-1].end + post_roll
        segments.append(Segment(len(segments) + 1, current, context_entries, start, end))
        current = []

    for entry in selected:
        current.append(entry)
        if entry.idx in cut_idxs:
            flush()
    flush()
    return segments


def _segment_is_refine_target(
    segment: Segment,
    llm_cut_idxs: set[int],
    args: argparse.Namespace,
) -> bool:
    duration = segment.entries[-1].end - segment.entries[0].start
    return (
        duration > args.llm_refine_max_seconds
        or (
            args.llm_refine_max_entries > 0
            and len(segment.entries) > args.llm_refine_max_entries
        )
        or duration < args.llm_refine_min_seconds
        or len(segment.entries) == 1
        or segment.entries[-1].idx not in llm_cut_idxs
    )


def _refine_ranges(
    segments: list[Segment],
    llm_cut_idxs: set[int],
    args: argparse.Namespace,
) -> list[tuple[int, int]]:
    if args.llm_refine_neighbor_scenes < 0:
        raise ValueError("--llm-refine-neighbor-scenes 不能小于 0")
    if args.llm_refine_region_entries <= 0:
        raise ValueError("--llm-refine-region-entries 必须大于 0")
    target_positions = [
        pos for pos, segment in enumerate(segments)
        if _segment_is_refine_target(segment, llm_cut_idxs, args)
    ]
    ranges: list[tuple[int, int]] = []
    for pos in target_positions:
        start = max(0, pos - args.llm_refine_neighbor_scenes)
        end = min(len(segments) - 1, pos + args.llm_refine_neighbor_scenes)
        if ranges and start <= ranges[-1][1] + 1:
            ranges[-1] = (ranges[-1][0], max(ranges[-1][1], end))
        else:
            ranges.append((start, end))
    split_ranges: list[tuple[int, int]] = []
    for range_start, range_end in ranges:
        chunk_start = range_start
        chunk_entries = 0
        for pos in range(range_start, range_end + 1):
            segment_entries = len(segments[pos].entries)
            if pos > chunk_start and chunk_entries + segment_entries > args.llm_refine_region_entries:
                split_ranges.append((chunk_start, pos - 1))
                chunk_start = pos
                chunk_entries = 0
            chunk_entries += segment_entries
        split_ranges.append((chunk_start, range_end))
    return split_ranges


def _refine_llm_segments(
    segments: list[Segment],
    selected: list[NormalizedEntry],
    all_entries: list[NormalizedEntry],
    llm_cut_idxs: set[int],
    titles: dict[int, str],
    args: argparse.Namespace,
    prompt_dir: Path | None,
    client: Any,
    model: str,
    pass_no: int,
) -> tuple[list[Segment], dict[int, str], set[int]]:
    ranges = _refine_ranges(segments, llm_cut_idxs, args)
    if not ranges:
        print(f"LLM refine pass {pass_no}: 没有需要重审的 scene", flush=True)
        return segments, titles, llm_cut_idxs

    refined_cut_idxs = set(llm_cut_idxs)
    refined_titles = dict(titles)
    system_prompt = "你是动画字幕场景边界复核助手。严格输出 JSON，只调整指定区域内部边界。"
    print(f"LLM refine pass {pass_no} plan: regions={len(ranges)}", flush=True)

    for region_no, (start_pos, end_pos) in enumerate(ranges, start=1):
        first_idx = segments[start_pos].entries[0].idx
        last_idx = segments[end_pos].entries[-1].idx
        region_entries = [
            entry for entry in selected
            if first_idx <= entry.idx <= last_idx
        ]
        candidate_idxs = {entry.idx for entry in region_entries[:-1]}
        current_internal_cuts = {
            segment.entries[-1].idx
            for segment in segments[start_pos:end_pos]
        }
        prompt = _refine_prompt(
            region_entries,
            candidate_idxs,
            current_internal_cuts,
            args.llm_refine_max_seconds,
            args.llm_refine_max_entries,
        )
        if len(prompt) > args.llm_max_prompt_chars:
            raise ValueError(
                f"LLM refine region {region_no} prompt={len(prompt)} 字符，超过 "
                f"--llm-max-prompt-chars={args.llm_max_prompt_chars}；请减小 neighbor scenes"
            )
        print(
            f"LLM refine pass {pass_no} region {region_no}/{len(ranges)}: "
            f"scene={start_pos + 1}-{end_pos + 1}, idx={first_idx}-{last_idx}, "
            f"entries={len(region_entries)}, prompt={len(prompt)} chars",
            flush=True,
        )
        if prompt_dir is not None:
            prompt_dir.mkdir(parents=True, exist_ok=True)
        prompt_path = prompt_dir / f"refine_p{pass_no}_prompt_{region_no:04d}.txt" if prompt_dir else None
        response_path = prompt_dir / f"refine_p{pass_no}_response_{region_no:04d}.txt" if prompt_dir else None
        cached = (
            _load_cached_response(prompt_path, response_path, prompt, candidate_idxs)
            if prompt_path is not None and response_path is not None
            else None
        )
        if cached is not None:
            parsed = cached
            print("  using cached response", flush=True)
            new_internal_cuts = {int(record["after_idx"]) for record in parsed}
            refined_cut_idxs.difference_update(current_internal_cuts)
            refined_cut_idxs.update(new_internal_cuts)
            for cut_idx in current_internal_cuts - new_internal_cuts:
                refined_titles.pop(cut_idx, None)
            for record in parsed:
                if record.get("title"):
                    refined_titles[int(record["after_idx"])] = str(record["title"])
            continue
        if prompt_path is not None:
            prompt_path.write_text(prompt, encoding="utf-8")

        raw = ""
        last_error: Exception | None = None
        for validation_attempt in range(1, 3):
            raw = call_llm(client, model, prompt, system_prompt=system_prompt)
            try:
                parsed = _parse_boundary_response(raw, candidate_idxs)
                new_internal_cuts = {int(record["after_idx"]) for record in parsed}
                refined_cut_idxs.difference_update(current_internal_cuts)
                refined_cut_idxs.update(new_internal_cuts)
                for cut_idx in current_internal_cuts - new_internal_cuts:
                    refined_titles.pop(cut_idx, None)
                for record in parsed:
                    if record.get("title"):
                        refined_titles[int(record["after_idx"])] = str(record["title"])
                last_error = None
                break
            except (ValueError, json.JSONDecodeError) as exc:
                last_error = exc
                print(f"[warn] refine 响应校验失败（第 {validation_attempt}/2 次）: {exc}", file=sys.stderr)
                prompt += "\n\n上一次格式无效。请只输出本区域候选 after_idx 的最终 cuts。"
        if response_path is not None:
            response_path.write_text(raw, encoding="utf-8")
        if last_error is not None:
            raise RuntimeError(f"LLM refine region {region_no} 连续返回无效结果") from last_error

    refined_segments = _segments_from_cut_idxs(
        selected,
        all_entries,
        refined_cut_idxs,
        args.context_before,
        args.pre_roll,
        args.post_roll,
    )
    final_end_idxs = {segment.entries[-1].idx for segment in refined_segments}
    refined_titles = {
        cut_idx: title for cut_idx, title in refined_titles.items()
        if cut_idx in final_end_idxs
    }
    return refined_segments, refined_titles, refined_cut_idxs


def _run_refine_passes(
    segments: list[Segment],
    selected: list[NormalizedEntry],
    all_entries: list[NormalizedEntry],
    cut_idxs: set[int],
    titles: dict[int, str],
    args: argparse.Namespace,
    prompt_dir: Path | None,
    client: Any,
    model: str,
) -> tuple[list[Segment], dict[int, str], set[int]]:
    if args.llm_refine_passes < 0:
        raise ValueError("--llm-refine-passes 不能小于 0")
    for pass_no in range(1, args.llm_refine_passes + 1):
        previous_ranges = [
            (segment.entries[0].idx, segment.entries[-1].idx)
            for segment in segments
        ]
        segments, titles, cut_idxs = _refine_llm_segments(
            segments,
            selected,
            all_entries,
            cut_idxs,
            titles,
            args,
            prompt_dir,
            client,
            model,
            pass_no,
        )
        current_ranges = [
            (segment.entries[0].idx, segment.entries[-1].idx)
            for segment in segments
        ]
        if current_ranges == previous_ranges:
            print(f"LLM refine pass {pass_no}: 边界未变化，提前结束", flush=True)
            break
    return segments, titles, cut_idxs


def _segments_and_titles_from_json(
    path: Path,
    all_entries: list[NormalizedEntry],
    args: argparse.Namespace,
) -> tuple[list[Segment], dict[int, str], set[int]]:
    if not path.exists():
        raise FileNotFoundError(f"找不到 refine 输入 JSON: {path}")
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("refine 输入 JSON 必须是数组")
    by_idx = {entry.idx: entry for entry in all_entries}
    segments: list[Segment] = []
    titles: dict[int, str] = {}
    cut_idxs: set[int] = set()
    for item in raw:
        if not isinstance(item, dict) or item.get("enabled") is False:
            continue
        start_idx = int(item["start_idx"])
        end_idx = int(item["end_idx"])
        entries = [by_idx[idx] for idx in range(start_idx, end_idx + 1) if idx in by_idx]
        entries = [entry for entry in entries if entry.speaker != "NONSPEECH" and "♪" not in entry.text]
        if not entries:
            continue
        context_start = max(0.0, entries[0].start - args.context_before)
        context_entries = [
            entry for entry in all_entries
            if entry.idx < entries[0].idx
            and entry.end >= context_start
            and entry.start < entries[0].start
        ]
        segments.append(Segment(
            len(segments) + 1,
            entries,
            context_entries,
            max(0.0, entries[0].start - args.pre_roll - args.context_before),
            entries[-1].end + args.post_roll,
        ))
        title = " ".join(str(item.get("name", "")).split())
        if title:
            titles[entries[-1].idx] = title
        if title and title != _summary_preview(entries):
            cut_idxs.add(entries[-1].idx)
    if segments:
        cut_idxs.discard(segments[-1].entries[-1].idx)
    return segments, titles, cut_idxs


def _build_segments_llm(
    all_entries: list[NormalizedEntry],
    selected: list[NormalizedEntry],
    args: argparse.Namespace,
    prompt_dir: Path | None = None,
) -> tuple[list[Segment], dict[int, str]]:
    if args.llm_window_entries <= 0:
        raise ValueError("--llm-window-entries 必须大于 0")
    if args.llm_context_entries < 0:
        raise ValueError("--llm-context-entries 不能小于 0")
    if args.llm_max_prompt_chars <= 0:
        raise ValueError("--llm-max-prompt-chars 必须大于 0")
    if not selected:
        return [], {}

    all_positions = {entry.idx: pos for pos, entry in enumerate(all_entries)}
    eligible = selected[:-1]
    cut_records: list[dict[str, Any]] = []
    system_prompt = "你是动画字幕场景边界分析助手。严格按要求输出 JSON，不要修改字幕。"

    initial_batches = [
        eligible[start:start + args.llm_window_entries]
        for start in range(0, len(eligible), args.llm_window_entries)
    ]
    if args.llm_max_batches > 0:
        initial_batches = initial_batches[:args.llm_max_batches]

    # Candidate count normally controls request size. The character cap also protects
    # projects with unusually long subtitle lines from exceeding model context limits.
    batches: list[tuple[list[NormalizedEntry], str]] = []
    pending = list(initial_batches)
    while pending:
        candidates = pending.pop(0)
        candidate_idxs = {entry.idx for entry in candidates}
        first_pos = all_positions[candidates[0].idx]
        last_pos = all_positions[candidates[-1].idx]
        context_start = max(0, first_pos - args.llm_context_entries)
        context_end = min(len(all_entries), last_pos + args.llm_context_entries + 2)
        prompt = _boundary_prompt(all_entries[context_start:context_end], candidate_idxs)
        if len(prompt) > args.llm_max_prompt_chars and len(candidates) > 1:
            midpoint = len(candidates) // 2
            pending[0:0] = [candidates[:midpoint], candidates[midpoint:]]
            continue
        if len(prompt) > args.llm_max_prompt_chars:
            raise ValueError(
                f"单个候选边界 prompt 已达 {len(prompt)} 字符，超过 "
                f"--llm-max-prompt-chars={args.llm_max_prompt_chars}"
            )
        batches.append((candidates, prompt))

    prompt_lengths = [len(prompt) for _, prompt in batches]
    print(
        "LLM request plan: "
        f"entries={len(selected)}, requests={len(batches)}, "
        f"prompt_chars=min {min(prompt_lengths):,} / "
        f"avg {sum(prompt_lengths) // len(prompt_lengths):,} / max {max(prompt_lengths):,}",
        flush=True,
    )
    if args.llm_plan_only:
        for batch_no, (candidates, prompt) in enumerate(batches, start=1):
            print(
                f"  batch {batch_no:03d}: idx={candidates[0].idx}-{candidates[-1].idx}, "
                f"candidates={len(candidates)}, prompt={len(prompt):,} chars"
            )
        return [], {}

    cfg = load_config(args.llm_config)
    client = _make_client(cfg)

    for batch_no, (candidates, prompt) in enumerate(batches, start=1):
        candidate_idxs = {entry.idx for entry in candidates}
        print(
            f"LLM boundary batch {batch_no}/{len(batches)}: "
            f"candidates idx={candidates[0].idx}-{candidates[-1].idx}, "
            f"prompt={len(prompt)} chars",
            flush=True,
        )
        if prompt_dir is not None:
            prompt_dir.mkdir(parents=True, exist_ok=True)
        prompt_path = prompt_dir / f"boundary_prompt_{batch_no:04d}.txt" if prompt_dir else None
        response_path = prompt_dir / f"boundary_response_{batch_no:04d}.txt" if prompt_dir else None
        cached = (
            _load_cached_response(prompt_path, response_path, prompt, candidate_idxs)
            if prompt_path is not None and response_path is not None
            else None
        )
        if cached is not None:
            cut_records.extend(cached)
            print("  using cached response", flush=True)
            continue
        if prompt_path is not None:
            prompt_path.write_text(prompt, encoding="utf-8")

        last_error: Exception | None = None
        raw = ""
        for validation_attempt in range(1, 3):
            raw = call_llm(client, cfg.model, prompt, system_prompt=system_prompt)
            try:
                parsed = _parse_boundary_response(raw, candidate_idxs)
                cut_records.extend(parsed)
                last_error = None
                break
            except (ValueError, json.JSONDecodeError) as exc:
                last_error = exc
                print(f"[warn] 边界响应校验失败（第 {validation_attempt}/2 次）: {exc}", file=sys.stderr)
                prompt += "\n\n上一次响应格式无效。请重新检查 after_idx，只输出本批标记过的候选位置。"
        if response_path is not None:
            response_path.write_text(raw, encoding="utf-8")
        if last_error is not None:
            raise RuntimeError(f"LLM boundary batch {batch_no} 连续返回无效结果") from last_error

    cut_idxs = {int(record["after_idx"]) for record in cut_records}
    titles = {
        int(record["after_idx"]): str(record["title"])
        for record in cut_records
        if record.get("title")
    }
    segments = _segments_from_cut_idxs(
        selected,
        all_entries,
        cut_idxs,
        args.context_before,
        args.pre_roll,
        args.post_roll,
    )
    if args.llm_refine:
        segments, titles, cut_idxs = _run_refine_passes(
            segments,
            selected,
            all_entries,
            cut_idxs,
            titles,
            args,
            prompt_dir,
            client,
            cfg.model,
        )
    return segments, titles


def _summaries_llm_batch(segments: list[Any], client: Any, model: str) -> dict[int, str]:
    blocks: list[str] = []
    for segment in segments:
        lines = [f"[{e.idx}] {_entry_text(e)}" for e in segment.entries]
        blocks.append(
            f"SCENE {segment.idx} idx={segment.entries[0].idx}-{segment.entries[-1].idx}\n"
            + "\n".join(lines)
        )
    prompt = """请为下面多个动画字幕片段分别生成一句保守的中文内容标签，用于字幕编辑软件中显示片段段落。

要求：
- 只输出 JSON 对象，不要输出解释。
- key 是场景编号字符串，value 是该场景标题。
- 每个标题 8 到 20 个汉字左右。
- 只根据给出的字幕文字总结，不要脑补画面、人物动机或未出现的剧情。
- 如果字幕信息不足，不要编故事；用中性主题词，例如“开场旁白”“短暂反应”“关于学校的争执”。
- 避免主观词和因果推断，例如“决心”“鼓励”“被迫”“遭遇”，除非字幕明确表达。
- 可以保留关键角色名、物品名、地点名和原文关键词。

示例输出：
{"1":"开场旁白与否定", "2":"辉夜姬故事讨论"}

场景：
""" + "\n\n".join(blocks)
    system_prompt = "你是字幕场景标题助手，只输出 JSON。"
    raw = call_llm(client, model, prompt, system_prompt=system_prompt).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError(f"LLM 未返回 JSON 对象: {raw[:200]}")
    data = json.loads(raw[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("LLM 返回 JSON 不是对象")
    return {int(k): " ".join(str(v).split()) for k, v in data.items()}


def _summaries_for_segments(
    segments: list[Any],
    summary_mode: str,
    llm_config_path: Path,
    batch_size: int,
) -> dict[int, str]:
    if summary_mode == "preview":
        return {segment.idx: _summary_preview(segment.entries) for segment in segments}

    cfg = load_config(llm_config_path)
    client = _make_client(cfg)
    summaries: dict[int, str] = {}
    for start in range(0, len(segments), batch_size):
        batch = segments[start:start + batch_size]
        print(f"LLM summary batch {start + 1}-{start + len(batch)} / {len(segments)}", flush=True)
        try:
            summaries.update(_summaries_llm_batch(batch, client, cfg.model))
        except Exception as exc:
            for segment in batch:
                summaries[segment.idx] = f"{_summary_preview(segment.entries)} [LLM failed: {exc}]"
    for segment in segments:
        summaries.setdefault(segment.idx, _summary_preview(segment.entries))
    return summaries


def _write_scene_srt(
    segments: list[Any],
    path: Path,
    summaries: dict[int, str],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    blocks: list[str] = []
    for i, segment in enumerate(segments, start=1):
        summary = summaries.get(segment.idx) or _summary_preview(segment.entries)
        blocks.append(
            f"{i}\n"
            f"{seconds_to_srt_time(segment.entries[0].start)} --> {seconds_to_srt_time(segment.entries[-1].end)}\n"
            f"{summary}\n"
        )
    path.write_text("\n".join(blocks), encoding="utf-8")


def _write_json(scenes: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(scenes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _validate_segments(segments: list[Segment], selected: list[NormalizedEntry]) -> None:
    expected = [entry.idx for entry in selected]
    actual = [entry.idx for segment in segments for entry in segment.entries]
    if actual != expected:
        expected_set = set(expected)
        actual_set = set(actual)
        missing = sorted(expected_set - actual_set)
        duplicates = sorted(idx for idx in actual_set if actual.count(idx) > 1)
        unexpected = sorted(actual_set - expected_set)
        raise ValueError(
            "场景覆盖校验失败: "
            f"missing={missing[:20]}, duplicates={duplicates[:20]}, unexpected={unexpected[:20]}"
        )
    for previous, current in zip(segments, segments[1:]):
        if previous.entries[-1].idx >= current.entries[0].idx:
            raise ValueError(
                f"场景顺序或范围重叠: scene {previous.idx} / scene {current.idx}"
            )


def _warn_scene_lengths(segments: list[Segment], threshold_seconds: float) -> None:
    if threshold_seconds < 0:
        raise ValueError("--warn-scene-seconds 不能小于 0")
    if threshold_seconds == 0:
        return
    overlong = [
        segment for segment in segments
        if segment.entries[-1].end - segment.entries[0].start > threshold_seconds
    ]
    if not overlong:
        return
    print(
        f"[warn] {len(overlong)} 个 scene 超过 {threshold_seconds:g} 秒；保留 LLM 边界，不自动拆分:",
        file=sys.stderr,
    )
    for segment in overlong:
        duration = segment.entries[-1].end - segment.entries[0].start
        print(
            f"  scene {segment.idx}: idx={segment.entries[0].idx}-{segment.entries[-1].idx}, "
            f"duration={duration:.1f}s, entries={len(segment.entries)}",
            file=sys.stderr,
        )


def main() -> int:
    args = _parse_args()
    output_dir = args.output_dir or (INTERMEDIATE_ROOT / args.project / "scene_segments_llm")
    json_path = output_dir / "scene_segments.json"
    scene_srt_path = output_dir / "scene_segments.srt"

    srt_path = _resolve_srt(args.project, args.srt)
    entries = parse_srt(srt_path)

    selected = _select_entries(entries)
    if args.llm_max_batches > 0:
        test_entry_count = args.llm_window_entries * args.llm_max_batches + 1
        selected = selected[:test_entry_count]
    llm_titles: dict[int, str] = {}
    titles_by_end_idx: dict[int, str] = {}
    prompt_dir = output_dir / "llm_boundary_debug" if args.dump_llm_prompts else None
    if args.llm_refine_from is not None:
        segments, titles_by_end_idx, llm_cut_idxs = _segments_and_titles_from_json(
            args.llm_refine_from,
            entries,
            args,
        )
        _validate_segments(segments, selected)
        if args.llm_refine_passes > 0:
            cfg = load_config(args.llm_config)
            client = _make_client(cfg)
            segments, titles_by_end_idx, _ = _run_refine_passes(
                segments,
                selected,
                entries,
                llm_cut_idxs,
                titles_by_end_idx,
                args,
                prompt_dir,
                client,
                cfg.model,
            )
    else:
        segments, titles_by_end_idx = _build_segments_llm(entries, selected, args, prompt_dir)
    if args.llm_plan_only:
        return 0
    llm_titles = {
        segment.idx: titles_by_end_idx[segment.entries[-1].idx]
        for segment in segments
        if segment.entries[-1].idx in titles_by_end_idx
    }
    _validate_segments(segments, selected)
    _warn_scene_lengths(segments, args.warn_scene_seconds)
    if args.max_scenes > 0:
        segments = segments[:args.max_scenes]
    if args.summary_mode == "preview":
        summaries = {
            segment.idx: llm_titles.get(segment.idx, _summary_preview(segment.entries))
            for segment in segments
        }
    else:
        summaries = _summaries_for_segments(segments, args.summary_mode, args.llm_config, args.llm_batch_size)
    scenes = [_segment_to_json(segment, summaries.get(segment.idx)) for segment in segments]

    _write_json(scenes, json_path)
    _write_scene_srt(segments, scene_srt_path, summaries)

    print(f"输入 SRT: {srt_path}")
    print(f"summary : {args.summary_mode}")
    print(f"scenes  : {len(scenes)}")
    print(f"JSON    : {json_path}")
    print(f"SceneSRT: {scene_srt_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
