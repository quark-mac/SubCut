"""
gemini_segment_diarize.py — Gemini 多模态按视频片段批量改标字幕 speaker。

与 gemini_multimodal_diarize.py 的区别：
  - 不是每条字幕切一个短视频。
  - 而是把连续字幕合成一个较长视频片段，一次发给 Gemini。
  - Gemini 返回该片段内每个字幕 idx 的 speaker 标注。

适用场景：
  用户希望模型看一段连续视频，根据画面、音频、上下文整体修正说话人。

示例：
  # 测试 1 个片段，不写 SRT
  env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --start-idx 220 --end-idx 230 --max-segments 1

  # 处理一段范围并写出 segment_labeled.srt
  env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --start-idx 200 --end-idx 260 --write-srt
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sub._srt_io import NormalizedEntry, parse_srt, seconds_to_srt_time, write_srt
from sub.llm.diarize_llm import CANONICAL_SPEAKERS, INTERMEDIATE_ROOT, _format_role_descriptions, load_role_descriptions
from sub.llm.gemini_video_verify import (
    DEFAULT_CONFIG_PATH,
    _call_gemini,
    _cell,
    _load_config,
    _load_dotenv,
    _make_clip,
    _make_gemini_client,
    _resolve_ffmpeg,
)
from sub.project_io import resolve_project


@dataclass
class Segment:
    idx: int
    entries: list[NormalizedEntry]
    context_entries: list[NormalizedEntry]
    start: float
    end: float


@dataclass
class ReferenceImage:
    label: str
    path: Path


@dataclass
class ReferenceAudio:
    label: str
    path: Path


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Gemini 多模态按较长视频片段批量标注说话人",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("project", help="项目名，对应 sub/input/<project>/")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Gemini 配置 JSON 路径")
    parser.add_argument("--model", default=None, help="Gemini 模型名，默认读取配置")
    parser.add_argument("--base-url", default=None, help="Gemini API base URL，默认读取配置")
    parser.add_argument("--api-key-env", default=None, help="API key 环境变量名，默认读取配置")
    parser.add_argument("--input", type=Path, default=Path("sub/input"), help="项目输入根目录")
    parser.add_argument("--media", type=Path, default=None, help="显式指定源视频")
    parser.add_argument("--srt", type=Path, default=None, help="输入 SRT，默认 normalized.srt，缺失时回退 llm_corrected.srt")
    parser.add_argument("--role-desc", type=Path, default=None, help="角色介绍 JSON 路径")
    parser.add_argument("--speakers", default=None, help="限制 canonical speaker，逗号分隔，例如 Iroha,Yachiyo,Kaguya")
    parser.add_argument("--speaker-images-dir", type=Path, default=None, help="角色参考图目录，默认 sub/input/<project>/SPKS")
    parser.add_argument("--use-speaker-images", action="store_true", help="附加角色参考图（实验性，默认关闭）")
    parser.add_argument("--speaker-audio-dir", type=Path, default=None, help="角色语音参考目录，默认 sub/input/<project>/SPKS")
    parser.add_argument("--use-speaker-audio", action="store_true", help="附加角色语音参考并使用严格三角色 prompt（默认关闭，实验性）")
    parser.add_argument("--ffmpeg", type=Path, default=None, help="显式指定 ffmpeg 路径")
    parser.add_argument("--start-idx", type=int, default=None, help="起始字幕 idx")
    parser.add_argument("--end-idx", type=int, default=None, help="结束字幕 idx")
    parser.add_argument("--segments-json", type=Path, default=None, help="使用 scene_segmenter.py 生成的场景分段 JSON")
    parser.add_argument("--max-segments", type=int, default=1, help="最多处理 N 个片段，0=不限（默认 1）")
    parser.add_argument(
        "--preset",
        choices=("custom", "baseline", "safe", "fine", "long-test", "extreme-test"),
        default="custom",
        help="分段预设：baseline=45s/25条；safe=90s/40条；fine=25s/10条；long-test=180s/70条；extreme-test=300s/100条（默认 custom）",
    )
    parser.add_argument("--segment-seconds", type=float, default=45.0, help="单个视频片段目标最大秒数（默认 45）")
    parser.add_argument("--max-entries", type=int, default=25, help="单个片段最多字幕条数（默认 25）")
    parser.add_argument("--gap-split", type=float, default=6.0, help="相邻字幕间隔超过 N 秒则切段（默认 6）")
    parser.add_argument("--pre-roll", type=float, default=1.5, help="片段前扩展秒数（默认 1.5）")
    parser.add_argument("--post-roll", type=float, default=1.5, help="片段后扩展秒数（默认 1.5）")
    parser.add_argument("--context-before", type=float, default=15.0, help="额外向前提供 N 秒上下文视频/字幕，但不要求标注这些上下文条目（默认 15）")
    parser.add_argument("--height", type=int, default=360, help="输出视频高度（默认 360）")
    parser.add_argument("--fps", type=int, default=6, help="输出视频帧率（默认 6）")
    parser.add_argument("--compact-video", action="store_true", help="压缩视频：仅保留字幕附近窗口，剪掉长空白，再拼接给 Gemini")
    parser.add_argument("--compact-pre-roll", type=float, default=1.0, help="compact 模式每段字幕前保留秒数（默认 1.0）")
    parser.add_argument("--compact-post-roll", type=float, default=1.0, help="compact 模式每段字幕后保留秒数（默认 1.0）")
    parser.add_argument("--compact-merge-gap", type=float, default=1.0, help="compact 模式窗口间隔小于等于 N 秒则合并（默认 1.0）")
    parser.add_argument(
        "--include-current-speaker",
        action="store_true",
        help="在发给 Gemini 的字幕清单中包含当前 speaker/tags（默认不包含，避免误导）",
    )
    parser.add_argument(
        "--explicit-anchor",
        choices=("none", "canonical", "all"),
        default="none",
        help="发送给 Gemini 的无 tag 显式 speaker 锚点：none=不发（默认）；canonical=只发 canonical；all=全部发送",
    )
    parser.add_argument("--overwrite-clips", action="store_true", help="覆盖已生成视频片段")
    parser.add_argument("--prepare-only", action="store_true", help="只生成视频片段和清单，不调用 Gemini")
    parser.add_argument("--plan-only", action="store_true", help="只输出分段计划，不生成视频也不调用 Gemini")
    parser.add_argument("--report-only", action="store_true", help="只从现有 results.jsonl 重新生成 report.md，不调用 Gemini")
    parser.add_argument("--dump-prompts", action="store_true", help="保存每个 batch 实际发送的文字 prompt，便于诊断；不改变模型输入")
    parser.add_argument("--segments-per-request", type=int, default=2, help="每次 Gemini 请求合并处理多少个完整 scene（默认 2）")
    parser.add_argument("--max-request-duration", type=float, default=90.0, help="预算式 batching：单次请求目标最大视频秒数，0=关闭（默认 90）")
    parser.add_argument("--max-request-entries", type=int, default=30, help="预算式 batching：单次请求目标最大字幕条数，0=不限（默认 30）")
    parser.add_argument("--max-request-scenes", type=int, default=2, help="预算式 batching：单次请求最大 scene 数，0=使用 --segments-per-request（默认 2）")
    parser.add_argument("--write-srt", action="store_true", help="生成 segment_labeled.srt")
    parser.add_argument("--keep-tags", action="store_true", help="写 SRT 时保留原 tags；默认输出干净 [speaker] text")
    parser.add_argument(
        "--explicit-lock",
        choices=("none", "canonical", "all"),
        default="none",
        help="写回时锁定无 tag 显式 speaker：none=不锁（默认）；canonical=只锁 canonical；all=全部锁定",
    )
    parser.add_argument("--output-dir", type=Path, default=None, help="输出目录")
    return parser.parse_args()


def _apply_preset(args: argparse.Namespace) -> None:
    if args.preset == "baseline":
        args.segment_seconds = 45.0
        args.max_entries = 25
        args.gap_split = 6.0
        args.context_before = 15.0
    elif args.preset == "safe":
        args.segment_seconds = 90.0
        args.max_entries = 40
        args.gap_split = 6.0
        args.context_before = 5.0
    elif args.preset == "fine":
        args.segment_seconds = 25.0
        args.max_entries = 10
        args.gap_split = 3.0
        args.context_before = 5.0
    elif args.preset == "long-test":
        args.segment_seconds = 180.0
        args.max_entries = 70
        args.gap_split = 8.0
        args.context_before = 0.0
    elif args.preset == "extreme-test":
        args.segment_seconds = 300.0
        args.max_entries = 100
        args.gap_split = 10.0
        args.context_before = 0.0


def _resolve_srt(project: str, explicit: Path | None) -> Path:
    if explicit is not None:
        if not explicit.exists():
            raise FileNotFoundError(f"找不到输入 SRT: {explicit}")
        return explicit
    intermediate = INTERMEDIATE_ROOT / project
    for name in ("normalized.srt", "llm_corrected.srt"):
        path = intermediate / name
        if path.exists():
            return path
    raise FileNotFoundError(f"找不到 SRT: {intermediate}")


def _select_entries(entries: list[NormalizedEntry], args: argparse.Namespace) -> list[NormalizedEntry]:
    selected = [e for e in entries if e.speaker != "NONSPEECH" and "♪" not in e.text]
    if args.start_idx is not None:
        selected = [e for e in selected if e.idx >= args.start_idx]
    if args.end_idx is not None:
        selected = [e for e in selected if e.idx <= args.end_idx]
    return selected


def _build_segments(entries: list[NormalizedEntry], args: argparse.Namespace, context_source: list[NormalizedEntry] | None = None) -> list[Segment]:
    context_source = context_source or entries
    segments: list[Segment] = []
    current: list[NormalizedEntry] = []

    def flush() -> None:
        nonlocal current
        if not current:
            return
        context_start = max(0.0, current[0].start - args.context_before)
        context_entries = [
            e for e in context_source
            if e.idx < current[0].idx and e.end >= context_start and e.start < current[0].start
        ]
        start = max(0.0, current[0].start - args.pre_roll - args.context_before)
        end = current[-1].end + args.post_roll
        segments.append(Segment(len(segments) + 1, current, context_entries, start, end))
        current = []

    for entry in entries:
        if not current:
            current = [entry]
            continue
        duration_if_added = entry.end - current[0].start
        gap = entry.start - current[-1].end
        if (
            duration_if_added > args.segment_seconds
            or len(current) >= args.max_entries
            or gap > args.gap_split
        ):
            flush()
        current.append(entry)
    flush()
    if args.max_segments > 0:
        return segments[: args.max_segments]
    return segments


def _build_segments_from_json(
    all_entries: list[NormalizedEntry],
    path: Path,
    args: argparse.Namespace,
) -> list[Segment]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"segments JSON 应为数组: {path}")
    by_idx = {e.idx: e for e in all_entries}
    segments: list[Segment] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if item.get("enabled") is False:
            continue
        try:
            start_idx = int(item["start_idx"])
            end_idx = int(item["end_idx"])
        except (KeyError, TypeError, ValueError):
            continue
        entries = [by_idx[idx] for idx in range(start_idx, end_idx + 1) if idx in by_idx]
        entries = [e for e in entries if e.speaker != "NONSPEECH" and "♪" not in e.text]
        if args.start_idx is not None:
            entries = [e for e in entries if e.idx >= args.start_idx]
        if args.end_idx is not None:
            entries = [e for e in entries if e.idx <= args.end_idx]
        if not entries:
            continue
        context_start = max(0.0, entries[0].start - args.context_before)
        context_entries = [
            e for e in all_entries
            if e.idx < entries[0].idx and e.end >= context_start and e.start < entries[0].start
        ]
        start = max(0.0, entries[0].start - args.pre_roll - args.context_before)
        end = entries[-1].end + args.post_roll
        segments.append(Segment(len(segments) + 1, entries, context_entries, start, end))
    if args.max_segments > 0:
        return segments[: args.max_segments]
    return segments


def _format_entries(entries: list[NormalizedEntry], include_current_speaker: bool = False) -> str:
    lines: list[str] = []
    for e in entries:
        text = e.text.replace("\n", " / ").replace("\\N", " / ")
        if include_current_speaker:
            tags = " ".join("{" + t + "}" for t in e.tags)
            lines.append(
                f"[{e.idx}] {seconds_to_srt_time(e.start)} --> {seconds_to_srt_time(e.end)} "
                f"speaker={e.speaker} {tags} text={text}"
            )
        else:
            lines.append(
                f"[{e.idx}] {seconds_to_srt_time(e.start)} --> {seconds_to_srt_time(e.end)} "
                f"text={text}"
            )
    return "\n".join(lines)


def _format_compact_timeline(entries: list[NormalizedEntry], compact_map: dict[int, tuple[float, float]]) -> str:
    if not compact_map:
        return "（未使用压缩视频；视频时间就是原片连续时间）"
    lines: list[str] = []
    for entry in entries:
        if entry.idx not in compact_map:
            continue
        compact_start, compact_end = compact_map[entry.idx]
        lines.append(
            f"[{entry.idx}] compact {seconds_to_srt_time(compact_start)} --> {seconds_to_srt_time(compact_end)}"
        )
    return "\n".join(lines) if lines else "（无）"


def _format_context_entries(
    entries: list[NormalizedEntry],
    compact_map: dict[int, tuple[float, float]],
    explicit_anchor: str = "none",
) -> str:
    if not entries:
        return "（无）"
    lines: list[str] = []
    for entry in entries:
        text = entry.text.replace("\n", " / ").replace("\\N", " / ")
        compact = compact_map.get(entry.idx)
        compact_text = ""
        if compact:
            compact_text = (
                f" context_compact {seconds_to_srt_time(compact[0])} --> "
                f"{seconds_to_srt_time(compact[1])}"
            )
        anchor = ""
        if _should_lock_explicit(entry.speaker, list(entry.tags), explicit_anchor):
            anchor = f" locked_anchor={entry.speaker}"
        lines.append(f"[{entry.idx}] context{compact_text}{anchor} text={text}")
    return "\n".join(lines)


def _format_batch_entries(
    segments: list[Segment],
    include_current_speaker: bool,
    compact_map: dict[int, tuple[float, float]],
    explicit_anchor: str = "none",
) -> str:
    def format_target_entries(entries: list[NormalizedEntry]) -> str:
        lines: list[str] = []
        for entry in entries:
            compact = compact_map.get(entry.idx)
            if compact:
                time_text = (
                    f"compact {seconds_to_srt_time(compact[0])} --> "
                    f"{seconds_to_srt_time(compact[1])}"
                )
            else:
                time_text = "compact time unavailable"
            text = entry.text.replace("\n", " / ").replace("\\N", " / ")
            speaker_text = ""
            if include_current_speaker:
                tags = " ".join("{" + tag + "}" for tag in entry.tags)
                speaker_text = f" speaker={entry.speaker} {tags}" if tags else f" speaker={entry.speaker}"
            elif _should_lock_explicit(entry.speaker, list(entry.tags), explicit_anchor):
                speaker_text = f" locked_anchor={entry.speaker}"
            lines.append(f"[{entry.idx}] {time_text}{speaker_text} text={text}")
        return "\n".join(lines)

    blocks: list[str] = []
    for segment in segments:
        blocks.append(
            f"SCENE {segment.idx} idx={segment.entries[0].idx}-{segment.entries[-1].idx}\n"
            + format_target_entries(segment.entries)
        )
    return "\n\n".join(blocks)


def _batch_prompt(
    segments: list[Segment],
    role_text: str,
    include_current_speaker: bool = False,
    compact_map: dict[int, tuple[float, float]] | None = None,
    allowed_speakers: set[str] | None = None,
    context_entries: list[NormalizedEntry] | None = None,
    context_map: dict[int, tuple[float, float]] | None = None,
    explicit_anchor: str = "none",
) -> str:
    speaker_list = " / ".join(sorted(allowed_speakers or CANONICAL_SPEAKERS))
    compact_map = compact_map or {}
    context_text = _format_context_entries(
        context_entries or [],
        context_map or {},
        explicit_anchor=explicit_anchor,
    )
    entries_text = _format_batch_entries(
        segments,
        include_current_speaker,
        compact_map,
        explicit_anchor=explicit_anchor,
    )
    allowed_rule = ""
    if allowed_speakers:
        allowed_rule = (
            "\n本次实验只允许把 canonical speaker 标为 "
            + ", ".join(sorted(allowed_speakers))
            + "。如果实际发声者不是这些角色，必须输出 OTHER，不能为了填答案强行选择其中任何一个。特别注意：年轻女性配角、同学、老师、路人或背景角色即使年龄、性别、音高或说话方式与 Iroha/Kaguya 相似，也不能因此强行归入这三个主要角色。只有声线、画面发声者和上下文都支持时，才能选择三人之一。\n"
        )
    return f"""你会看到一个由多个场景片段拼接而成的动画视频，包含下面这些字幕条目的画面和音频。

=== 角色介绍 ===
{role_text}

=== 可选 canonical 角色 ===
{speaker_list}

=== 前文上下文（只供理解，不要输出这些 idx） ===
{context_text}

=== 需要标注的字幕条目 ===
{entries_text}

=== 任务 ===
请根据拼接视频的音频、画面和字幕上下文，为每个字幕 idx 判断实际说话人。

只允许输出 JSON 数组，不要输出其他文字：
[
  {{
    "scene_id": <场景编号>,
    "idx": <字幕idx>,
    "speaker": "<canonical角色名 | ? | NONSPEECH | OTHER>",
    "speaker_raw": "<如果是OTHER，写具体称呼；否则同speaker>",
    "confidence": "high" | "mid" | "low",
    "reason": "<简短理由>"
  }}
]

规则：
{allowed_rule}
1. 必须只为“需要标注的字幕条目”中的每个 idx 输出一条记录，不要输出“前文上下文”的 idx。
1a. `locked_anchor=<speaker>` 来自标准化字幕中无 tag 的人工显式标记，是已确认锚点：该 idx 的输出必须保持这个身份。若锚点不是 canonical 名称（例如 FUSHIの分身、オタ公、先生），按角色规则归一：有语义的 FUSHI 变体输出 FUSHI；其他非 canonical 人物输出 OTHER，并把原锚点写入 speaker_raw。
1b. locked_anchor 只锁定它自己的 idx，并作为邻近条目的强参考，但不能自动继承到后续字幕。后续每个 idx 仍必须根据声线变化、同步嘴型和独立音源重新判断，避免把错误锚点扩散到整段。
2. 输出必须包含 scene_id 和原始 idx；即使视频经过拼接或压缩，也不要改 idx。
3. 必须综合画面、台词语义、上下文和声音判断。逐 idx 检查嘴巴是否在该 compact 时间内随台词连续开合，并核对开口起止与声音时机；连续同步嘴型是强证据。嘴巴静止、背对镜头、只有点头/转头/惊讶等反应动作时，不能因为角色在画面中央就判其为 speaker。若没有任何人类嘴型与声音同步，优先检查画外音、系统/吉祥物语音、直播或赛事解说等独立音源，不要反向猜画面人物。
4. 目标和前文都提供了 compact 时间；用 compact 时间在当前拼接视频中定位，但绝不能输出 context idx。
5. 画面中出现角色不代表该角色一定正在说话；画外音、旁白、电话/直播声音、路人插话都必须结合声音和上下文识别。
6. 不要只凭台词内容、角色外貌、谁在画面中央、或前后 speaker 承接猜测。短促语气词、笑声、叹息、喘息必须重新按 compact 时间对齐声音起点、嘴型/身体发声动作和其他角色反应；不能自动继承前后 speaker。
7. 如果画面、声线和上下文互相冲突，不要强行选择；降低 confidence，必要时输出 OTHER 或 ?。
8. 禁止输出 OVERLAP。即使多人同时发声，也必须根据当前 idx 的字幕文本、主导音量、嘴型同步和发声时机，选择文本对应最清晰或主要的一个 speaker。若主要声音是非 canonical 群体或无法区分的多人，输出 OTHER 并在 speaker_raw 写群体身份；只有完全无法判断主要声源时才输出 ?。
9. 如果是音效、歌曲、非台词，speaker 输出 NONSPEECH。
10. 如果能确认不是 canonical 角色但知道大概是谁，speaker 输出 OTHER，speaker_raw 写具体称呼。
11. 如果无法判断，speaker 输出 ?，confidence 输出 low。
12. 赛事/直播解说要区分 Koto 与忠犬オタ公：Koto 是专业正式、流畅爽快的 canonical 主解说；オタ公是夸张口语化、犬系煽动气氛的固定搭档。确认是オタ公时输出 OTHER，speaker_raw 写オタ公，不要归给 Koto。
13. Mami/Roka 连续对话不能按轮次机械交替。Mami 更从容务实、常谈食物或 Mikado；Roka 更细腻时尚、对 Iroha 的状态更敏感。必须以嘴型和声线为主。
14. FUSHI 的教程、系统说明、FUSHIの分身、FUSHIアラーム的有语义台词统一输出 FUSHI，不要因 Kaguya/Yachiyo 出现在画面中而被吸收。只有纯警报声或无语义电子音才输出 NONSPEECH；检查小型吉祥物、界面图标和独立系统声源。
15. 不要为了填答案强行猜。"""


def _image_experiment_batch_prompt(
    segments: list[Segment],
    role_text: str,
    include_current_speaker: bool,
    compact_map: dict[int, tuple[float, float]],
    reference_images: list[ReferenceImage],
    allowed_speakers: set[str] | None,
    context_entries: list[NormalizedEntry],
    context_map: dict[int, tuple[float, float]],
    explicit_anchor: str = "none",
) -> str:
    base_prompt = _batch_prompt(
        segments,
        role_text,
        include_current_speaker=include_current_speaker,
        compact_map=compact_map,
        allowed_speakers=allowed_speakers,
        context_entries=context_entries,
        context_map=context_map,
        explicit_anchor=explicit_anchor,
    )
    image_section = f"""=== 实验性角色参考图 ===
{_reference_image_prompt(reference_images)}
参考图只用于确认目标视频中出现的角色形象，不能单独决定 speaker；必须与目标视频中的声线、口型/动作、发声时机、台词和上下文共同判断。

"""
    return base_prompt.replace("=== 前文上下文", image_section + "=== 前文上下文", 1)


def _parse_json_array(raw: str) -> list[dict[str, Any]]:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    start = text.find("[")
    end = text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        return [{"_parse_error": "no_json_array", "raw": raw}]
    try:
        data = json.loads(text[start: end + 1])
    except json.JSONDecodeError as exc:
        return [{"_parse_error": str(exc), "raw": raw}]
    if not isinstance(data, list):
        return [{"_parse_error": "not_array", "raw": raw}]
    out: list[dict[str, Any]] = []
    for item in data:
        if isinstance(item, dict):
            out.append(item)
    return out


def _call_segment(client: Any, model: str, clip: Path, prompt: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    result, usage = _call_gemini(client, model, clip, prompt)
    if isinstance(result, dict) and result.get("_parse_error") and result.get("raw"):
        return _parse_json_array(str(result["raw"])), usage
    if isinstance(result, dict):
        return [result], usage
    return [], usage


def _is_openai_compatible_base_url(base_url: str | None) -> bool:
    if not base_url:
        return False
    normalized = base_url.rstrip("/").lower()
    return "moyuu.cc" in normalized or "/openai/" in normalized


def _make_openai_client(api_key: str, base_url: str) -> Any:
    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        print(
            "[error] 缺少 openai 包。请安装：\n"
            "  env\\pip.exe install openai",
            file=sys.stderr,
        )
        raise
    return OpenAI(api_key=api_key, base_url=base_url.rstrip("/") if base_url.rstrip("/").endswith("/v1") else base_url.rstrip("/") + "/v1")


def _image_mime(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    return "image/png"


def _load_reference_images(path: Path | None) -> list[ReferenceImage]:
    if not path or not path.exists():
        return []
    image_exts = {".png", ".jpg", ".jpeg", ".webp"}
    refs: list[ReferenceImage] = []
    for image_path in sorted(p for p in path.rglob("*") if p.suffix.lower() in image_exts):
        if image_path.parent == path:
            label = image_path.stem
        else:
            label = image_path.parent.name
        label = label.replace("&", "/")
        refs.append(ReferenceImage(label=label, path=image_path))
    return refs


def _load_reference_audio(path: Path | None, allowed_speakers: set[str]) -> list[ReferenceAudio]:
    if not path or not path.exists():
        return []
    refs: list[ReferenceAudio] = []
    for label in sorted(allowed_speakers):
        candidate = path / label / f"{label}_vocals.wav"
        if candidate.exists():
            refs.append(ReferenceAudio(label=label, path=candidate))
    return refs


def _reference_image_prompt(refs: list[ReferenceImage]) -> str:
    if not refs:
        return "（无）"
    grouped: dict[str, int] = {}
    for ref in refs:
        grouped[ref.label] = grouped.get(ref.label, 0) + 1
    return "\n".join(f"- {label}: {count} reference image(s)" for label, count in grouped.items())


def _strict_three_speaker_audio_prompt(
    segments: list[Segment],
    compact_map: dict[int, tuple[float, float]],
    reference_audio: list[ReferenceAudio],
) -> str:
    context_blocks: list[str] = []
    for segment in segments:
        if segment.context_entries:
            context_blocks.append(
                f"SCENE {segment.idx} 前文上下文（只供理解，不要输出这些 idx）\n"
                + _format_entries(segment.context_entries, include_current_speaker=False)
            )
    context_text = "\n\n".join(context_blocks) if context_blocks else "（无）"
    entries_text = _format_batch_entries(segments, False, compact_map)
    labels = " / ".join(ref.label for ref in reference_audio)
    return f"""这是严格三角色语音匹配实验。先提供有标签的角色语音参考，随后提供需要标注的目标视频。

=== 语音参考 ===
{labels}
每份参考音频对应其标签角色的声音。用它们比较目标视频中的音色、音高、语速、发声习惯和情绪下的声线。

=== 前文上下文（只供理解，不要输出这些 idx） ===
{context_text}

=== 需要标注的字幕条目 ===
{entries_text}

=== 任务 ===
只为每个目标 idx 判断：实际声音是否明确匹配 Iroha、Yachiyo、Kaguya 中的某一人。

只允许输出 JSON 数组，不要输出其他文字：
[
  {{
    "scene_id": <场景编号>,
    "idx": <原始字幕idx整数>,
    "speaker": "Iroha" | "Yachiyo" | "Kaguya" | "OTHER" | "NONSPEECH" | "?",
    "speaker_raw": "<OTHER 时写具体身份；否则同 speaker>",
    "confidence": "high" | "mid" | "low",
    "reason": "<简短理由>"
  }}
]

严格规则：
1. 只有目标声音与某份角色语音参考明确匹配时，才能输出 Iroha、Yachiyo 或 Kaguya。
2. 如果实际发声者不是这三人，必须输出 OTHER；不能因为人物在画面中、台词符合剧情、或前后字幕属于主角，就强行选择三人之一。
3. 如果声音过短、被音乐遮挡、多人同时发声、或无法与三份参考明确匹配，选择当前字幕文本对应的主导单一声源；非三角色输出 OTHER，完全无法判断才输出 ?，并降低 confidence。
4. 综合声音匹配、说话时口型/动作、画面中角色是否出现、以及上下文是否合理。声音匹配是选择三位主角的必要条件；画面和上下文只能辅助。
5. 禁止输出 OVERLAP。多人同时说话时仍选择当前字幕文本对应最清晰或主要的一个 speaker；音效/歌曲/非台词输出 NONSPEECH。
6. 必须只为目标条目输出一条记录，不能输出前文上下文 idx；idx 必须是单个原始整数，不能写范围。"""


def _select_reference_images_for_group(
    refs: list[ReferenceImage],
    group: list[Segment],
    max_labels: int = 4,
) -> list[ReferenceImage]:
    if not refs:
        return []
    labels = {ref.label for ref in refs}
    candidates: list[str] = []
    for segment in group:
        for entry in segment.context_entries + segment.entries:
            speaker = entry.speaker.replace("帝", "Mikado").replace("朝日", "Asahi")
            if speaker in labels and speaker not in candidates:
                candidates.append(speaker)
    for fallback in ("Iroha", "Kaguya", "Yachiyo"):
        if fallback in labels and fallback not in candidates:
            candidates.append(fallback)
    selected_labels = set(candidates[:max_labels])
    return [ref for ref in refs if ref.label in selected_labels]


def _call_segment_openai(
    client: Any,
    model: str,
    clip: Path,
    prompt: str,
    reference_images: list[ReferenceImage] | None = None,
    reference_audio: list[ReferenceAudio] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    for ref in reference_images or []:
        encoded_image = base64.b64encode(ref.path.read_bytes()).decode("ascii")
        image_url = f"data:{_image_mime(ref.path)};base64,{encoded_image}"
        content.append({"type": "text", "text": f"Reference image for canonical speaker: {ref.label}"})
        content.append({
            "type": "image_url",
            "image_url": {"url": image_url},
        })
    for ref in reference_audio or []:
        encoded_audio = base64.b64encode(ref.path.read_bytes()).decode("ascii")
        content.append({"type": "text", "text": f"Voice reference for canonical speaker: {ref.label}"})
        content.append({
            "type": "audio_url",
            "audio_url": {"url": "data:audio/wav;base64," + encoded_audio},
        })
    encoded = base64.b64encode(clip.read_bytes()).decode("ascii")
    content.append({"type": "text", "text": "Target compact video to label:"})
    content.append({"type": "video_url", "video_url": {"url": "data:video/mp4;base64," + encoded}})
    response = client.chat.completions.create(
        model=model,
        messages=[{
            "role": "user",
            "content": content,
        }],
        temperature=0,
    )
    choice = response.choices[0]
    text = choice.message.content or ""
    if not text.strip():
        reasoning = getattr(choice.message, "reasoning_content", None)
        if isinstance(reasoning, str) and reasoning.strip():
            text = reasoning
        else:
            raise ValueError(
                "OpenAI-compatible endpoint returned empty message content "
                f"(finish_reason={getattr(choice, 'finish_reason', None)!r})"
            )
    usage_obj = getattr(response, "usage", None)
    usage = usage_obj.model_dump() if hasattr(usage_obj, "model_dump") else {}
    return _parse_json_array(text), usage


def _merge_windows(windows: list[tuple[float, float]], merge_gap: float) -> list[tuple[float, float]]:
    if not windows:
        return []
    windows = sorted(windows)
    merged = [windows[0]]
    for start, end in windows[1:]:
        prev_start, prev_end = merged[-1]
        if start - prev_end <= merge_gap:
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


def _compact_windows(segment: Segment, args: argparse.Namespace) -> list[tuple[float, float]]:
    windows: list[tuple[float, float]] = []
    for entry in segment.context_entries + segment.entries:
        windows.append((
            max(0.0, entry.start - args.compact_pre_roll),
            entry.end + args.compact_post_roll,
        ))
    return _merge_windows(windows, args.compact_merge_gap)


def _compact_windows_for_segments(segments: list[Segment], args: argparse.Namespace) -> list[tuple[float, float]]:
    windows: list[tuple[float, float]] = []
    seen: set[int] = set()
    for segment in segments:
        for entry in segment.context_entries + segment.entries:
            if entry.idx in seen:
                continue
            seen.add(entry.idx)
            windows.append((
                max(0.0, entry.start - args.compact_pre_roll),
                entry.end + args.compact_post_roll,
            ))
    return _merge_windows(windows, args.compact_merge_gap)


def _compact_time_for_entry(entry: NormalizedEntry, windows: list[tuple[float, float]]) -> tuple[float, float] | None:
    offset = 0.0
    for start, end in windows:
        if entry.start >= start and entry.end <= end:
            return entry.start - start + offset, entry.end - start + offset
        offset += end - start
    return None


def _make_compact_clip(
    ffmpeg: Path,
    media: Path,
    output: Path,
    segment: Segment,
    args: argparse.Namespace,
) -> tuple[dict[int, tuple[float, float]], list[tuple[float, float]]]:
    windows = _compact_windows(segment, args)
    compact_map: dict[int, tuple[float, float]] = {}
    for entry in segment.entries:
        compact_time = _compact_time_for_entry(entry, windows)
        if compact_time is not None:
            compact_map[entry.idx] = compact_time

    if output.exists() and not args.overwrite_clips:
        return compact_map, windows

    output.parent.mkdir(parents=True, exist_ok=True)
    temp_dir = output.parent / f".{output.stem}_parts"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)

    part_paths: list[Path] = []
    try:
        for i, (start, end) in enumerate(windows, start=1):
            part_path = temp_dir / f"part_{i:04d}.mp4"
            _make_clip(ffmpeg, media, part_path, start, end, args)
            part_paths.append(part_path)

        concat_file = temp_dir / "concat.txt"
        concat_file.write_text(
            "\n".join("file '" + str(path.resolve()).replace("'", "'\\''") + "'" for path in part_paths) + "\n",
            encoding="utf-8",
        )
        cmd = [
            str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",
            str(output),
        ]
        subprocess.run(cmd, check=True)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    return compact_map, windows


def _concat_clips(ffmpeg: Path, parts: list[Path], output: Path, temp_dir: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    concat_file = temp_dir / "concat.txt"
    concat_file.write_text(
        "\n".join("file '" + str(path.resolve()).replace("'", "'\\''") + "'" for path in parts) + "\n",
        encoding="utf-8",
    )
    cmd = [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(concat_file),
        "-c", "copy",
        str(output),
    ]
    subprocess.run(cmd, check=True)


def _make_batch_clip(
    ffmpeg: Path,
    media: Path,
    output: Path,
    segments: list[Segment],
    args: argparse.Namespace,
) -> tuple[dict[int, tuple[float, float]], dict[int, tuple[float, float]], list[dict[str, Any]], float]:
    if output.exists() and not args.overwrite_clips:
        return {}, {}, [], 0.0

    temp_dir = output.parent / f".{output.stem}_batch_parts"
    if temp_dir.exists():
        shutil.rmtree(temp_dir)
    temp_dir.mkdir(parents=True, exist_ok=True)

    compact_map: dict[int, tuple[float, float]] = {}
    context_map: dict[int, tuple[float, float]] = {}
    batch_windows: list[dict[str, Any]] = []
    part_paths: list[Path] = []
    offset = 0.0
    try:
        if args.compact_video:
            windows = _compact_windows_for_segments(segments, args)
            target_entries = [entry for segment in segments for entry in segment.entries]
            target_ids = {entry.idx for entry in target_entries}
            all_entries = [
                entry for segment in segments
                for entry in segment.context_entries + segment.entries
            ]
            seen_entries: set[int] = set()
            for entry in all_entries:
                if entry.idx in seen_entries:
                    continue
                seen_entries.add(entry.idx)
                compact_time = _compact_time_for_entry(entry, windows)
                if compact_time is not None:
                    if entry.idx in target_ids:
                        compact_map[entry.idx] = compact_time
                    else:
                        context_map[entry.idx] = compact_time

            for i, (start, end) in enumerate(windows, start=1):
                part_path = temp_dir / f"window_{i:04d}.mp4"
                _make_clip(ffmpeg, media, part_path, start, end, args)
                part_paths.append(part_path)

            duration = sum(end - start for start, end in windows)
            offset = duration
            for segment in segments:
                batch_windows.append({
                    "scene_id": segment.idx,
                    "mode": "compact",
                    "batch_start": round(
                        min((compact_map[e.idx][0] for e in segment.entries if e.idx in compact_map), default=0.0),
                        3,
                    ),
                    "batch_end": round(
                        max((compact_map[e.idx][1] for e in segment.entries if e.idx in compact_map), default=0.0),
                        3,
                    ),
                    "original_start": round(segment.start, 3),
                    "original_end": round(segment.end, 3),
                    "windows": [],
                })
            batch_windows.append({
                "scene_id": "batch",
                "mode": "compact_windows",
                "batch_start": 0.0,
                "batch_end": round(duration, 3),
                "windows": [
                    {"start": round(start, 3), "end": round(end, 3), "duration": round(end - start, 3)}
                    for start, end in windows
                ],
            })
        else:
            for i, segment in enumerate(segments, start=1):
                part_path = temp_dir / f"scene_{i:04d}.mp4"
                _make_clip(ffmpeg, media, part_path, segment.start, segment.end, args)
                duration = segment.end - segment.start
                for entry in segment.entries:
                    compact_map[entry.idx] = (
                        entry.start - segment.start + offset,
                        entry.end - segment.start + offset,
                    )
                for entry in segment.context_entries:
                    context_map[entry.idx] = (
                        entry.start - segment.start + offset,
                        entry.end - segment.start + offset,
                    )
                batch_windows.append({
                    "scene_id": segment.idx,
                    "mode": "continuous",
                    "batch_start": round(offset, 3),
                    "batch_end": round(offset + duration, 3),
                    "original_start": round(segment.start, 3),
                    "original_end": round(segment.end, 3),
                })
                part_paths.append(part_path)
                offset += duration

        _concat_clips(ffmpeg, part_paths, output, temp_dir)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    return compact_map, context_map, batch_windows, offset


def _write_jsonl(records: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n", encoding="utf-8")


def _write_markdown(records: list[dict[str, Any]], path: Path, explicit_lock: str = "none") -> None:
    lines = [
        "# Gemini Segment Diarization Report",
        "",
        f"- total entries: {sum(len(r.get('entries', [])) for r in records)}",
        f"- segments: {len(records)}",
        "",
        "| segment | idx | SRT speaker | Gemini speaker | final speaker | conf | video | text | reason |",
        "|---:|---:|---|---|---|---|---|---|---|",
    ]
    for record in records:
        by_idx: dict[int, dict[str, Any]] = {}
        for result in record.get("results", []):
            if not isinstance(result, dict):
                continue
            idx = _safe_idx(result.get("idx"))
            if idx is not None:
                by_idx[idx] = result
        duration = record.get("batch_duration")
        if duration is None and record.get("clip_start") is not None and record.get("clip_end") is not None:
            duration = round(float(record["clip_end"]) - float(record["clip_start"]), 3)
        video_mode = "compact" if record.get("compact_video") else "continuous"
        video_label = f"{video_mode} {duration}s" if duration is not None else video_mode
        for entry in record.get("entries", []):
            result = by_idx.get(int(entry["idx"]), {})
            final_speaker, source = _resolve_final_speaker(
                str(entry.get("speaker_in_srt", "?")),
                list(entry.get("tags", [])),
                result,
                explicit_lock,
            )
            final_speaker = f"{final_speaker} ({source})"
            lines.append(
                "| "
                + " | ".join([
                    _cell(record.get("segment"), 10),
                    _cell(entry.get("idx"), 10),
                    _cell(entry.get("speaker_in_srt"), 24),
                    _cell(result.get("speaker") or result.get("_parse_error") or "missing", 28),
                    _cell(final_speaker, 32),
                    _cell(result.get("confidence"), 12),
                    _cell(video_label, 24),
                    _cell(entry.get("text"), 90),
                    _cell(result.get("reason") or result.get("raw") or "", 120),
                ])
                + " |"
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_plan(segments: list[Segment], path: Path, args: argparse.Namespace) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    durations = [s.end - s.start for s in segments]
    entry_counts = [len(s.entries) for s in segments]
    lines = [
        "# Gemini Segment Plan",
        "",
        f"- segments: {len(segments)}",
        f"- entries: {sum(entry_counts)}",
    ]
    if segments:
        lines.extend([
            f"- avg duration: {sum(durations) / len(durations):.1f}s",
            f"- max duration: {max(durations):.1f}s",
            f"- avg entries: {sum(entry_counts) / len(entry_counts):.1f}",
            f"- max entries: {max(entry_counts)}",
        ])
    lines.extend([
        "",
        "| segment | idx range | time range | duration | entries |",
        "|---:|---|---|---:|---:|",
    ])
    for segment in segments:
        lines.append(
            "| "
            + " | ".join([
                _cell(segment.idx, 10),
        _cell(f"{segment.entries[0].idx}-{segment.entries[-1].idx}", 18),
                _cell(f"{seconds_to_srt_time(segment.start)} - {seconds_to_srt_time(segment.end)}", 36),
                _cell(f"{segment.end - segment.start:.1f}s", 12),
                _cell(len(segment.entries), 10),
            ])
            + " |"
        )
    groups = _budget_segment_groups(segments, args)
    group_entries = [sum(len(segment.entries) for segment in group) for group in groups]
    group_scenes = [len(group) for group in groups]
    group_durations = [_group_duration_seconds(group, args) for group in groups]
    lines.extend([
        "",
        "## Request Plan",
        "",
        f"- requests: {len(groups)}",
    ])
    if groups:
        lines.extend([
            f"- scenes/request: avg {sum(group_scenes) / len(groups):.1f}, max {max(group_scenes)}",
            f"- entries/request: avg {sum(group_entries) / len(groups):.1f}, max {max(group_entries)}",
            f"- video seconds/request: avg {sum(group_durations) / len(groups):.1f}s, max {max(group_durations):.1f}s",
            "",
            "| request | scenes | idx range | video duration | entries |",
            "|---:|---|---|---:|---:|",
        ])
        for group_index, (group, duration, entry_count) in enumerate(
            zip(groups, group_durations, group_entries),
            start=1,
        ):
            lines.append(
                f"| {group_index} | {group[0].idx}-{group[-1].idx} | "
                f"{group[0].entries[0].idx}-{group[-1].entries[-1].idx} | "
                f"{duration:.1f}s | {entry_count} |"
            )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _entries_to_records(entries: list[NormalizedEntry]) -> list[dict[str, Any]]:
    return [
        {
            "idx": e.idx,
            "start": round(e.start, 3),
            "end": round(e.end, 3),
            "speaker_in_srt": e.speaker,
            "tags": list(e.tags),
            "text": e.text,
        }
        for e in entries
    ]


def _safe_idx(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _restrict_speakers(results: list[dict[str, Any]], allowed_speakers: set[str]) -> None:
    special = {"?", "NONSPEECH", "OTHER"}
    for result in results:
        speaker = result.get("speaker")
        if not isinstance(speaker, str) or speaker in allowed_speakers or speaker in special:
            continue
        result["speaker_raw"] = result.get("speaker_raw") or speaker
        result["speaker"] = "OTHER"


def _overlap_result_idxs(results: list[dict[str, Any]]) -> list[int]:
    return [
        idx for result in results
        if isinstance(result, dict)
        and result.get("speaker") == "OVERLAP"
        and (idx := _safe_idx(result.get("idx"))) is not None
    ]


def _segment_groups(segments: list[Segment], size: int) -> list[list[Segment]]:
    size = max(1, size)
    return [segments[i:i + size] for i in range(0, len(segments), size)]


def _group_duration_seconds(segments: list[Segment], args: argparse.Namespace) -> float:
    if args.compact_video:
        return sum(end - start for start, end in _compact_windows_for_segments(segments, args))
    return sum(segment.end - segment.start for segment in segments)


def _budget_segment_groups(segments: list[Segment], args: argparse.Namespace) -> list[list[Segment]]:
    if not (
        args.max_request_duration > 0
        or args.max_request_entries > 0
        or args.max_request_scenes > 0
    ):
        return _segment_groups(segments, args.segments_per_request)

    groups: list[list[Segment]] = []
    current: list[Segment] = []

    def over_budget(candidate: list[Segment]) -> bool:
        if args.max_request_scenes > 0 and len(candidate) > args.max_request_scenes:
            return True
        if args.max_request_entries > 0:
            entry_count = sum(len(segment.entries) for segment in candidate)
            if entry_count > args.max_request_entries:
                return True
        if args.max_request_duration > 0:
            return _group_duration_seconds(candidate, args) > args.max_request_duration
        return False

    for segment in segments:
        candidate = current + [segment]
        if current and over_budget(candidate):
            groups.append(current)
            current = [segment]
        else:
            current = candidate

    if current:
        groups.append(current)
    return groups


def _should_lock_explicit(speaker: str, tags: list[str], mode: str) -> bool:
    if mode == "none" or tags or speaker in ("?", "NONSPEECH", ""):
        return False
    if mode == "all":
        return True
    return speaker in CANONICAL_SPEAKERS


def _resolve_final_speaker(
    input_speaker: str,
    input_tags: list[str],
    result: dict[str, Any] | None,
    explicit_lock: str,
) -> tuple[str, str]:
    if _should_lock_explicit(input_speaker, input_tags, explicit_lock):
        return input_speaker, f"locked {explicit_lock}"
    if not result or result.get("_parse_error") or result.get("_error"):
        return input_speaker, "kept input: missing/error"
    speaker = str(result.get("speaker") or "").strip()
    if not speaker:
        return input_speaker, "kept input: empty result"
    if speaker == "OTHER":
        raw = str(result.get("speaker_raw") or "").strip()
        if raw and raw not in ("OTHER", "?", "NONSPEECH"):
            return raw, "Gemini OTHER identity"
        return "OTHER", "Gemini"
    if speaker == "OVERLAP":
        return "?", "legacy OVERLAP requires review"
    if speaker in CANONICAL_SPEAKERS or speaker in ("?", "NONSPEECH"):
        return speaker, "Gemini"
    return str(result.get("speaker_raw") or speaker), "Gemini raw identity"


def _write_labeled_srt(
    entries: list[NormalizedEntry],
    records: list[dict[str, Any]],
    path: Path,
    keep_tags: bool = False,
    explicit_lock: str = "none",
) -> None:
    by_idx: dict[int, dict[str, Any]] = {}
    for record in records:
        for result in record.get("results", []):
            if isinstance(result, dict) and "idx" in result:
                idx = _safe_idx(result.get("idx"))
                if idx is not None:
                    by_idx[idx] = result
    new_entries = [
        NormalizedEntry(e.idx, e.start, e.end, e.speaker, list(e.tags) if keep_tags else [], e.text, list(e.source_entries))
        for e in entries
    ]
    for source_entry, e in zip(entries, new_entries):
        result = by_idx.get(e.idx)
        if not result:
            continue
        final_speaker, source = _resolve_final_speaker(
            source_entry.speaker,
            list(source_entry.tags),
            result,
            explicit_lock,
        )
        e.speaker = final_speaker
        if keep_tags:
            if "missing/error" in source or "requires review" in source:
                if "MM_REVIEW" not in e.tags:
                    e.tags.append("MM_REVIEW")
            elif final_speaker == "?":
                if "MM_UNCLEAR" not in e.tags:
                    e.tags.append("MM_UNCLEAR")
            elif "MM_VERIFIED" not in e.tags:
                e.tags.append("MM_VERIFIED")
    write_srt(new_entries, path)


def main() -> int:
    args = _parse_args()
    _apply_preset(args)
    _load_dotenv()
    cfg = _load_config(args.config)
    model = args.model or cfg.get("model") or "gemini-2.5-flash"
    base_url = args.base_url or cfg.get("base_url") or None
    api_key_env = args.api_key_env or cfg.get("api_key_env") or "GEMINI_API_KEY"

    project = resolve_project(args.project, input_root=args.input, media=args.media)
    if project.media_kind != "video":
        print(f"[error] 源媒体不是视频: {project.media}", file=sys.stderr)
        return 1
    srt_path = _resolve_srt(args.project, args.srt)
    entries = parse_srt(srt_path)
    if args.segments_json:
        segments = _build_segments_from_json(entries, args.segments_json, args)
    else:
        selected = _select_entries(entries, args)
        segments = _build_segments(selected, args, context_source=entries)
    if not segments:
        print("[error] 没有可处理片段", file=sys.stderr)
        return 1

    role_desc_path = args.role_desc or (_REPO_ROOT / "sub" / "input" / args.project / "role_descriptions.json")
    role_desc = load_role_descriptions(role_desc_path)
    allowed_speakers = {
        name.strip() for name in args.speakers.split(",") if name.strip()
    } if args.speakers else set(CANONICAL_SPEAKERS)
    speaker_subset = allowed_speakers if args.speakers else None
    strict_audio_speakers = {"Iroha", "Yachiyo", "Kaguya"}
    if args.use_speaker_audio and allowed_speakers != strict_audio_speakers:
        print(
            "[error] --use-speaker-audio 目前只支持 --speakers \"Iroha,Yachiyo,Kaguya\"。",
            file=sys.stderr,
        )
        return 1
    role_text = _format_role_descriptions({
        key: value for key, value in role_desc.items()
        if key.startswith("_") or key in allowed_speakers
    })
    speaker_images_dir = args.speaker_images_dir or (_REPO_ROOT / "sub" / "input" / args.project / "SPKS")
    reference_images = _load_reference_images(speaker_images_dir) if args.use_speaker_images else []
    speaker_audio_dir = args.speaker_audio_dir or (_REPO_ROOT / "sub" / "input" / args.project / "SPKS")
    reference_audio = _load_reference_audio(speaker_audio_dir, allowed_speakers) if args.use_speaker_audio else []
    if args.use_speaker_audio and {ref.label for ref in reference_audio} != strict_audio_speakers:
        print(f"[error] 缺少三角色语音参考: {speaker_audio_dir}", file=sys.stderr)
        return 1
    ffmpeg = _resolve_ffmpeg(args.ffmpeg)
    output_dir = args.output_dir or (INTERMEDIATE_ROOT / args.project / "gemini_segment_diarize")
    clips_dir = output_dir / "clips"
    result_jsonl = output_dir / "results.jsonl"
    report_md = output_dir / "report.md"
    plan_md = output_dir / "plan.md"
    output_srt = output_dir / "segment_labeled.srt"

    print(f"项目       : {args.project}")
    print(f"输入 SRT   : {srt_path}")
    print(f"源视频     : {project.media}")
    print(f"片段数     : {len(segments)}")
    print(f"模型       : {model}")
    print(f"角色范围   : {', '.join(sorted(allowed_speakers))}")
    print(f"base_url   : {base_url or '(default Gemini API)'}")
    print(f"preset     : {args.preset}")
    print(f"参考图     : {len(reference_images)} ({speaker_images_dir if reference_images else 'none'})")
    print(f"参考音频   : {len(reference_audio)} ({speaker_audio_dir if reference_audio else 'none'})")
    compact_text = "compact" if args.compact_video else "continuous"
    print(f"video      : {args.height}p / {args.fps}fps, {compact_text}, segment<={args.segment_seconds}s, context_before={args.context_before}s")
    print(f"输出目录   : {output_dir}")
    print()

    if args.report_only:
        if not result_jsonl.exists():
            print(f"[error] 找不到 results.jsonl: {result_jsonl}", file=sys.stderr)
            return 1
        records = [
            json.loads(line)
            for line in result_jsonl.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        _write_markdown(records, report_md, explicit_lock=args.explicit_lock)
        print(f"已重新生成报告: {report_md}")
        return 0

    if args.plan_only:
        _write_plan(segments, plan_md, args)
        print(f"分段计划: {plan_md}")
        return 0

    client = None
    use_openai_compatible = _is_openai_compatible_base_url(base_url)
    if not args.prepare_only:
        api_key = os.environ.get(api_key_env, "")
        if not api_key:
            print(f"[error] 未设置 {api_key_env}。可写入 sub\\llm\\.env：{api_key_env}=...", file=sys.stderr)
            return 1
        if use_openai_compatible:
            client = _make_openai_client(api_key, base_url or "")
        else:
            client = _make_gemini_client(api_key, base_url=base_url)

    records: list[dict[str, Any]] = []
    groups = _budget_segment_groups(segments, args)
    for group_index, group in enumerate(groups, start=1):
        first_segment = group[0]
        last_segment = group[-1]
        all_entries = [entry for segment in group for entry in segment.entries]
        all_context_entries = [entry for segment in group for entry in segment.context_entries]
        clip_prefix = "compact_batch" if args.compact_video else "batch"
        clip = clips_dir / (
            f"{clip_prefix}{group_index:04d}_"
            f"s{first_segment.idx:04d}-{last_segment.idx:04d}_"
            f"{all_entries[0].idx:04d}-{all_entries[-1].idx:04d}.mp4"
        )
        print(
            f"[{group_index}/{len(groups)}] scenes={first_segment.idx}-{last_segment.idx} "
            f"idx={all_entries[0].idx}-{all_entries[-1].idx} entries={len(all_entries)}",
            end="",
            flush=True,
        )
        compact_map: dict[int, tuple[float, float]] = {}
        context_map: dict[int, tuple[float, float]] = {}
        batch_windows: list[dict[str, Any]] = []
        batch_duration = 0.0
        try:
            compact_map, context_map, batch_windows, batch_duration = _make_batch_clip(ffmpeg, project.media, clip, group, args)
        except subprocess.CalledProcessError as exc:
            record = {
                "segment": f"{first_segment.idx}-{last_segment.idx}",
                "clip": str(clip),
                "segments": [segment.idx for segment in group],
                "entries": _entries_to_records(all_entries),
                "results": [{"_error": f"ffmpeg_failed: {exc}"}],
            }
            records.append(record)
            print("  [ffmpeg error]")
            continue

        record = {
            "segment": f"{first_segment.idx}-{last_segment.idx}",
            "clip": str(clip),
            "segments": [segment.idx for segment in group],
            "clip_start": round(min(segment.start for segment in group), 3),
            "clip_end": round(max(segment.end for segment in group), 3),
            "batch_duration": round(batch_duration, 3),
            "context_entries": _entries_to_records(all_context_entries),
            "entries": _entries_to_records(all_entries),
            "compact_video": bool(args.compact_video),
            "segments_per_request": len(group),
            "batching": {
                "max_request_duration": args.max_request_duration,
                "max_request_entries": args.max_request_entries,
                "max_request_scenes": args.max_request_scenes,
            },
        }
        record["batch_windows"] = batch_windows
        record["compact_duration"] = round(batch_duration, 3)
        record["compact_map"] = {
            str(idx): {"start": round(times[0], 3), "end": round(times[1], 3)}
            for idx, times in compact_map.items()
        }
        record["context_map"] = {
            str(idx): {"start": round(times[0], 3), "end": round(times[1], 3)}
            for idx, times in context_map.items()
        }
        batch_context: list[NormalizedEntry] = []
        seen_context: set[int] = set()
        target_ids = {entry.idx for entry in all_entries}
        for segment in group:
            for entry in segment.context_entries:
                if entry.idx in target_ids or entry.idx in seen_context:
                    continue
                seen_context.add(entry.idx)
                batch_context.append(entry)
        record["context_entries"] = _entries_to_records(batch_context)
        combined_context_map = {**context_map, **compact_map}
        if args.prepare_only:
            record["results"] = [
                {"scene_id": segment.idx, "idx": entry.idx, "speaker": "pending"}
                for segment in group
                for entry in segment.entries
            ]
            print(f"  prepared batch={record.get('batch_duration')}s")
        else:
            try:
                group_reference_images = _select_reference_images_for_group(reference_images, group)
                if reference_audio:
                    prompt = _strict_three_speaker_audio_prompt(group, compact_map, reference_audio)
                elif group_reference_images:
                    prompt = _image_experiment_batch_prompt(
                        group,
                        role_text,
                        include_current_speaker=args.include_current_speaker,
                        compact_map=compact_map,
                        reference_images=group_reference_images,
                        allowed_speakers=speaker_subset,
                        context_entries=batch_context,
                        context_map=combined_context_map,
                        explicit_anchor=args.explicit_anchor,
                    )
                else:
                    prompt = _batch_prompt(
                        group,
                        role_text,
                        include_current_speaker=args.include_current_speaker,
                        compact_map=compact_map,
                        allowed_speakers=speaker_subset,
                        context_entries=batch_context,
                        context_map=combined_context_map,
                        explicit_anchor=args.explicit_anchor,
                    )
                record["reference_images"] = [ref.label for ref in group_reference_images]
                record["reference_audio"] = [ref.label for ref in reference_audio]
                if args.dump_prompts:
                    prompt_path = output_dir / f"prompt_batch{group_index:04d}.txt"
                    prompt_path.write_text(prompt, encoding="utf-8")
                if use_openai_compatible:
                    results, usage = _call_segment_openai(
                        client,
                        model,
                        clip,
                        prompt,
                        reference_images=[] if reference_audio else group_reference_images,
                        reference_audio=reference_audio,
                    )
                else:
                    results, usage = _call_segment(client, model, clip, prompt)
                overlap_idxs = _overlap_result_idxs(results)
                if overlap_idxs:
                    retry_prompt = (
                        prompt
                        + "\n\n上一次响应错误地输出了已禁止的 OVERLAP，涉及 idx: "
                        + ", ".join(str(idx) for idx in overlap_idxs)
                        + "。请重新输出完整 JSON 数组，并为这些 idx 根据字幕文本、主导音量、嘴型同步和发声时机选择一个单一 speaker；非 canonical 群体输出 OTHER，完全无法判断才输出 ?。绝不能输出 OVERLAP。"
                    )
                    if use_openai_compatible:
                        results, retry_usage = _call_segment_openai(
                            client,
                            model,
                            clip,
                            retry_prompt,
                            reference_images=[] if reference_audio else group_reference_images,
                            reference_audio=reference_audio,
                        )
                    else:
                        results, retry_usage = _call_segment(client, model, clip, retry_prompt)
                    usage = {"initial": usage, "overlap_retry": retry_usage}
                    remaining_overlap = _overlap_result_idxs(results)
                    if remaining_overlap:
                        raise ValueError(
                            "Gemini returned forbidden OVERLAP after retry: "
                            + ", ".join(str(idx) for idx in remaining_overlap)
                        )
                _restrict_speakers(results, allowed_speakers)
                record["results"] = results
                record["usage"] = usage
                speakers = ",".join(str(r.get("speaker", "?")) for r in results[:5] if isinstance(r, dict))
                print(f"  speakers={speakers}")
            except Exception as exc:
                record["results"] = [{"_error": str(exc), "_error_type": type(exc).__name__}]
                print(f"  [gemini error] {exc}")

        records.append(record)
        _write_jsonl(records, result_jsonl)
        _write_markdown(records, report_md, explicit_lock=args.explicit_lock)
        if args.write_srt:
            _write_labeled_srt(
                entries,
                records,
                output_srt,
                keep_tags=args.keep_tags,
                explicit_lock=args.explicit_lock,
            )

    print()
    print(f"完成。JSONL: {result_jsonl}")
    print(f"报告: {report_md}")
    if args.write_srt:
        print(f"标注 SRT: {output_srt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
