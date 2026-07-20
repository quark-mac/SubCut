"""
gemini_multimodal_diarize.py — Gemini 多模态全角色说话人标注。

用途：
  对归一化 SRT 中的字幕条目逐条生成短视频，调用 Gemini 根据画面+音频
  在角色列表中选择说话人。适合后续按角色导出视频/音频片段。

示例：
  # 只跑 1 条测试
  env\python.exe sub\llm\gemini_multimodal_diarize.py "Cosmic Princess Kaguya" --max-items 1 --idx 223

  # 跑前 20 条需要审查的条目，不写 SRT
  env\python.exe sub\llm\gemini_multimodal_diarize.py "Cosmic Princess Kaguya" --max-items 20 --mode review-targets

  # 跑指定范围并生成 multimodal_labeled.srt
  env\python.exe sub\llm\gemini_multimodal_diarize.py "Cosmic Princess Kaguya" --start-idx 200 --end-idx 260 --write-srt
"""

from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sub._srt_io import NormalizedEntry, parse_srt, seconds_to_srt_time, write_srt
from sub.llm.diarize_llm import (
    CANONICAL_SPEAKERS,
    INTERMEDIATE_ROOT,
    _format_entry_line,
    _format_role_descriptions,
    load_role_descriptions,
)
from sub.llm.gemini_video_verify import (
    DEFAULT_CONFIG_PATH,
    _call_gemini,
    _cell,
    _clip_window,
    _load_config,
    _load_dotenv,
    _make_clip,
    _make_gemini_client,
    _resolve_ffmpeg,
)
from sub.project_io import resolve_project


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Gemini 多模态全角色说话人标注",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("project", help="项目名，对应 sub/input/<project>/")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="Gemini 配置 JSON 路径")
    parser.add_argument("--model", default=None, help="Gemini 模型名，默认读取配置")
    parser.add_argument("--base-url", default=None, help="Gemini API base URL，默认读取配置")
    parser.add_argument("--api-key-env", default=None, help="API key 环境变量名，默认读取配置")
    parser.add_argument("--input", type=Path, default=Path("sub/input"), help="项目输入根目录")
    parser.add_argument("--media", type=Path, default=None, help="显式指定源视频")
    parser.add_argument("--srt", type=Path, default=None, help="输入 SRT，默认 llm_corrected.srt 或 normalized.srt")
    parser.add_argument("--role-desc", type=Path, default=None, help="角色介绍 JSON 路径")
    parser.add_argument("--ffmpeg", type=Path, default=None, help="显式指定 ffmpeg 路径")
    parser.add_argument(
        "--mode",
        choices=("all", "review-targets", "unknown", "canonical"),
        default="review-targets",
        help="处理哪些条目：all=全部；review-targets=?/INHERITED/MULTI；unknown=只处理?；canonical=只处理已有 canonical speaker",
    )
    parser.add_argument("--idx", type=int, action="append", default=[], help="只处理指定 idx，可重复")
    parser.add_argument("--start-idx", type=int, default=None, help="起始 idx")
    parser.add_argument("--end-idx", type=int, default=None, help="结束 idx")
    parser.add_argument("--max-items", type=int, default=20, help="最多处理 N 条，0=不限（默认 20）")
    parser.add_argument("--seed", type=int, default=42, help="抽样种子（默认 42）")
    parser.add_argument("--context-window", type=int, default=3, help="字幕上下文条数（默认 ±3）")
    parser.add_argument("--pre-roll", type=float, default=1.5, help="字幕前扩展秒数（默认 1.5）")
    parser.add_argument("--post-roll", type=float, default=1.5, help="字幕后扩展秒数（默认 1.5）")
    parser.add_argument("--min-window", type=float, default=4.0, help="最短视频窗口秒数（默认 4）")
    parser.add_argument("--max-window", type=float, default=12.0, help="最长视频窗口秒数（默认 12）")
    parser.add_argument("--height", type=int, default=360, help="输出视频高度（默认 360）")
    parser.add_argument("--fps", type=int, default=6, help="输出视频帧率（默认 6）")
    parser.add_argument(
        "--role-desc-mode",
        choices=("short", "full"),
        default="full",
        help="角色介绍模式：short=省 token 摘要；full=完整描述（默认 full，准确优先）",
    )
    parser.add_argument(
        "--candidate-mode",
        choices=("scene", "all"),
        default="all",
        help="候选角色模式：scene=当前场景相关角色；all=全部 canonical（默认 all，准确优先）",
    )
    parser.add_argument("--overwrite-clips", action="store_true", help="覆盖已生成短视频")
    parser.add_argument("--prepare-only", action="store_true", help="只生成短视频和清单，不调用 Gemini")
    parser.add_argument("--write-srt", action="store_true", help="生成 multimodal_labeled.srt")
    parser.add_argument("--output-dir", type=Path, default=None, help="输出目录")
    return parser.parse_args()


def _resolve_srt(project: str, explicit: Path | None) -> Path:
    if explicit is not None:
        if not explicit.exists():
            raise FileNotFoundError(f"找不到输入 SRT: {explicit}")
        return explicit
    intermediate = INTERMEDIATE_ROOT / project
    for name in ("llm_corrected.srt", "normalized.srt"):
        path = intermediate / name
        if path.exists():
            return path
    raise FileNotFoundError(f"找不到 SRT: {intermediate}")


def _is_review_target(entry: NormalizedEntry) -> bool:
    if entry.speaker == "NONSPEECH":
        return False
    if "♪" in entry.text:
        return False
    return entry.speaker == "?" or "INHERITED" in entry.tags or "MULTI" in entry.tags


def _select_entries(entries: list[NormalizedEntry], args: argparse.Namespace) -> list[NormalizedEntry]:
    selected = entries
    if args.idx:
        wanted = set(args.idx)
        selected = [entry for entry in selected if entry.idx in wanted]
    if args.start_idx is not None:
        selected = [entry for entry in selected if entry.idx >= args.start_idx]
    if args.end_idx is not None:
        selected = [entry for entry in selected if entry.idx <= args.end_idx]

    if not args.idx:
        if args.mode == "review-targets":
            selected = [entry for entry in selected if _is_review_target(entry)]
        elif args.mode == "unknown":
            selected = [entry for entry in selected if entry.speaker == "?"]
        elif args.mode == "canonical":
            selected = [entry for entry in selected if entry.speaker in CANONICAL_SPEAKERS]

    if args.max_items > 0 and len(selected) > args.max_items:
        rng = random.Random(args.seed)
        selected = rng.sample(selected, args.max_items)
        selected.sort(key=lambda entry: entry.idx)
    return selected


def _context_text(entries: list[NormalizedEntry], entry: NormalizedEntry, window: int) -> str:
    pos = next(i for i, candidate in enumerate(entries) if candidate.idx == entry.idx)
    start = max(0, pos - window)
    end = min(len(entries), pos + window + 1)
    return "\n".join(_format_entry_line(entries[i], i == pos) for i in range(start, end))


def _entry_to_record(entry: NormalizedEntry) -> dict[str, Any]:
    return {
        "idx": entry.idx,
        "start": round(entry.start, 3),
        "end": round(entry.end, 3),
        "speaker_in_srt": entry.speaker,
        "tags": list(entry.tags),
        "text": entry.text,
    }


CORE_SPEAKERS: frozenset[str] = frozenset({"Iroha", "Kaguya", "Yachiyo", "FUSHI"})


def _short_role_descriptions(role_desc: dict[str, Any], speakers: list[str]) -> str:
    lines: list[str] = []
    for name in speakers:
        info = role_desc.get(name)
        if not isinstance(info, dict):
            continue
        parts = [f"{name}"]
        if info.get("name_ja"):
            parts.append(f"日文名: {info['name_ja']}")
        if info.get("first_person"):
            parts.append(f"一人称: {info['first_person']}")
        if info.get("speech_style"):
            parts.append(f"说话: {info['speech_style']}")
        if info.get("address_others"):
            parts.append(f"称呼: {info['address_others']}")
        if info.get("catchphrases"):
            parts.append(f"口癖: {', '.join(info['catchphrases'])}")
        # notes 很长，只取前一句，保留关键身份关系但避免塞完整设定。
        notes = str(info.get("notes") or "")
        if notes:
            first_note = notes.split("。", 1)[0]
            if first_note and "请在此填入" not in first_note:
                parts.append(f"备注: {first_note}")
        lines.append("- " + " | ".join(parts))
    return "\n".join(lines) if lines else "（无角色介绍）"


def _candidate_speakers(entries: list[NormalizedEntry], entry: NormalizedEntry, context: str, mode: str) -> list[str]:
    if mode == "all":
        return sorted(CANONICAL_SPEAKERS)
    speakers: set[str] = set(CORE_SPEAKERS)
    if entry.speaker in CANONICAL_SPEAKERS:
        speakers.add(entry.speaker)
    for line in context.splitlines():
        start = line.find("[")
        if start == -1:
            continue
        second = line.find("[", start + 1)
        end = line.find("]", second + 1) if second != -1 else -1
        if second != -1 and end != -1:
            speaker = line[second + 1:end]
            if speaker in CANONICAL_SPEAKERS:
                speakers.add(speaker)
    return sorted(speakers)


def _prompt(
    entry: NormalizedEntry,
    context: str,
    role_desc: dict[str, Any],
    role_desc_mode: str,
    candidate_mode: str,
    entries: list[NormalizedEntry],
) -> str:
    speakers = _candidate_speakers(entries, entry, context, candidate_mode)
    speaker_list = " / ".join(speakers)
    role_text = (
        _format_role_descriptions({name: role_desc[name] for name in speakers if name in role_desc})
        if role_desc_mode == "full"
        else _short_role_descriptions(role_desc, speakers)
    )
    text = entry.text.replace("\\N", "\n")
    time_text = f"{seconds_to_srt_time(entry.start)} --> {seconds_to_srt_time(entry.end)}"
    return f"""你会看到一段短视频，包含目标字幕附近的画面和音频。

=== 角色介绍 ===
{role_text}

=== 可选 canonical 角色 ===
{speaker_list}

=== 目标字幕 ===
idx: {entry.idx}
time: {time_text}
当前字幕 speaker: {entry.speaker}
tags: {', '.join(entry.tags) if entry.tags else '(none)'}
text:
{text}

=== 周边字幕上下文 ===
{context}

=== 任务 ===
请根据短视频画面、音频和字幕上下文，判断目标字幕 idx={entry.idx} 的实际说话人。

只允许输出 JSON 对象，不要输出其他文字：
{{
  "idx": {entry.idx},
  "speaker": "<canonical角色名 | ? | NONSPEECH | OVERLAP | OTHER>",
  "speaker_raw": "<如果是OTHER，写画面/字幕中的具体称呼；否则同speaker>",
  "confidence": "high" | "mid" | "low",
  "visible_evidence": "<画面证据，无法判断就写无法判断>",
  "audio_evidence": "<音频/语音证据，无法判断就写无法判断>",
  "reason": "<简短理由>"
}}

规则：
1. 优先根据视频画面和音频，不要盲信当前字幕 speaker 或 INHERITED 承接。
2. 如果可明确归为 canonical 角色，请输出 canonical 名称。
3. 如果明显是多人同时说话，speaker 输出 OVERLAP。
4. 如果是非台词、歌曲、音效或笑声且不适合单说话人片段，speaker 输出 NONSPEECH。
5. 如果能确认不是 canonical 角色但知道大概是谁，speaker 输出 OTHER，speaker_raw 写具体称呼。
6. 如果无法判断，speaker 输出 ?，confidence 输出 low。
7. 不要为了填答案强行猜。"""


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {"_parse_error": "no_json_object", "raw": raw}
    try:
        data = json.loads(text[start: end + 1])
    except json.JSONDecodeError as exc:
        return {"_parse_error": str(exc), "raw": raw}
    return data if isinstance(data, dict) else {"_parse_error": "not_object", "raw": raw}


def _call_gemini_diarize(client: Any, model: str, clip: Path, prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
    result, usage = _call_gemini(client, model, clip, prompt)
    if result.get("_parse_error"):
        return result, usage
    # _call_gemini already parses JSON; normalize expected fields.
    return {
        "idx": int(result.get("idx", 0) or 0),
        "speaker": str(result.get("speaker", "?")),
        "speaker_raw": str(result.get("speaker_raw", result.get("speaker", "?"))),
        "confidence": str(result.get("confidence", "low")),
        "visible_evidence": str(result.get("visible_evidence", "")),
        "audio_evidence": str(result.get("audio_evidence", "")),
        "reason": str(result.get("reason", "")),
    }, usage


def _write_jsonl(records: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(record, ensure_ascii=False) for record in records) + "\n", encoding="utf-8")


def _write_markdown(records: list[dict[str, Any]], path: Path) -> None:
    counts: dict[str, int] = {}
    total_tokens = 0
    token_rows = 0
    for record in records:
        speaker = record.get("gemini", {}).get("speaker") or record.get("gemini", {}).get("_parse_error") or "pending"
        counts[speaker] = counts.get(speaker, 0) + 1
        usage = record.get("usage", {})
        count = usage.get("total_token_count") or usage.get("total_tokens")
        if isinstance(count, int):
            total_tokens += count
            token_rows += 1

    lines = [
        "# Gemini Multimodal Diarization Report",
        "",
        f"- total: {len(records)}",
        "- speakers: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())),
    ]
    if token_rows:
        lines.append(f"- avg total tokens: {total_tokens / token_rows:.1f}")
    lines.extend([
        "",
        "| idx | time | SRT speaker | Gemini speaker | conf | text | reason | clip |",
        "|---:|---|---|---|---|---|---|---|",
    ])
    for record in records:
        gemini = record.get("gemini", {})
        lines.append(
            "| "
            + " | ".join([
                _cell(record.get("idx"), 12),
                _cell(seconds_to_srt_time(float(record.get("start", 0)))[:12], 16),
                _cell(record.get("speaker_in_srt"), 24),
                _cell(gemini.get("speaker") or gemini.get("_parse_error") or "pending", 28),
                _cell(gemini.get("confidence"), 12),
                _cell(record.get("text"), 90),
                _cell(gemini.get("reason") or gemini.get("raw") or "", 120),
                _cell(record.get("clip"), 80),
            ])
            + " |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _apply_results_to_srt(entries: list[NormalizedEntry], records: list[dict[str, Any]], output_srt: Path) -> None:
    by_idx = {int(record["idx"]): record for record in records}
    new_entries = [NormalizedEntry(e.idx, e.start, e.end, e.speaker, list(e.tags), e.text, list(e.source_entries)) for e in entries]
    for entry in new_entries:
        record = by_idx.get(entry.idx)
        if not record:
            continue
        gemini = record.get("gemini", {})
        speaker = gemini.get("speaker")
        if not speaker or speaker in ("OVERLAP", "OTHER") or gemini.get("_parse_error"):
            if "MM_REVIEW" not in entry.tags:
                entry.tags.append("MM_REVIEW")
            continue
        if speaker == "?":
            entry.speaker = "?"
            if "MM_UNCLEAR" not in entry.tags:
                entry.tags.append("MM_UNCLEAR")
            continue
        if speaker == "NONSPEECH":
            entry.speaker = "NONSPEECH"
        else:
            entry.speaker = str(speaker)
        if "MM_VERIFIED" not in entry.tags:
            entry.tags.append("MM_VERIFIED")
    write_srt(new_entries, output_srt)


def main() -> int:
    args = _parse_args()
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
    selected = _select_entries(entries, args)
    if not selected:
        print("[error] 没有选中任何字幕条目", file=sys.stderr)
        return 1

    role_desc_path = args.role_desc or (_REPO_ROOT / "sub" / "input" / args.project / "role_descriptions.json")
    role_desc = load_role_descriptions(role_desc_path)

    output_dir = args.output_dir or (INTERMEDIATE_ROOT / args.project / "gemini_multimodal_diarize")
    clips_dir = output_dir / "clips"
    result_jsonl = output_dir / "results.jsonl"
    report_md = output_dir / "report.md"
    output_srt = output_dir / "multimodal_labeled.srt"
    ffmpeg = _resolve_ffmpeg(args.ffmpeg)

    print(f"项目       : {args.project}")
    print(f"输入 SRT   : {srt_path}")
    print(f"源视频     : {project.media}")
    print(f"样本数     : {len(selected)} ({args.mode})")
    print(f"模型       : {model}")
    print(f"base_url   : {base_url or '(default Gemini API)'}")
    print(f"role desc  : {args.role_desc_mode}")
    print(f"candidates : {args.candidate_mode}")
    print(f"video      : {args.height}p / {args.fps}fps, pre={args.pre_roll}s post={args.post_roll}s")
    print(f"输出目录   : {output_dir}")
    print()

    client = None
    if not args.prepare_only:
        api_key = __import__("os").environ.get(api_key_env, "")
        if not api_key:
            print(f"[error] 未设置 {api_key_env}。可写入 sub\\llm\\.env：{api_key_env}=...", file=sys.stderr)
            return 1
        client = _make_gemini_client(api_key, base_url=base_url)

    records: list[dict[str, Any]] = []
    for count, entry in enumerate(selected, start=1):
        record = _entry_to_record(entry)
        start, end = _clip_window(record, args)
        clip = clips_dir / f"{entry.idx:04d}_{start:.2f}_{end:.2f}.mp4"
        print(f"[{count}/{len(selected)}] idx={entry.idx} clip {start:.2f}-{end:.2f}s", end="", flush=True)
        try:
            _make_clip(ffmpeg, project.media, clip, start, end, args)
        except subprocess.CalledProcessError as exc:
            record.update({"clip": str(clip), "gemini": {"_error": f"ffmpeg_failed: {exc}"}})
            records.append(record)
            print("  [ffmpeg error]")
            continue
        record.update({"clip": str(clip), "clip_start": round(start, 3), "clip_end": round(end, 3)})

        if args.prepare_only:
            record["gemini"] = {"speaker": "pending"}
            print("  prepared")
        else:
            try:
                context = _context_text(entries, entry, args.context_window)
                prompt = _prompt(
                    entry,
                    context,
                    role_desc,
                    args.role_desc_mode,
                    args.candidate_mode,
                    entries,
                )
                gemini, usage = _call_gemini_diarize(client, model, clip, prompt)
                record["gemini"] = gemini
                record["usage"] = usage
                print(f"  speaker={gemini.get('speaker') or gemini.get('_parse_error')}")
            except Exception as exc:
                record["gemini"] = {"_error": str(exc)}
                print(f"  [gemini error] {exc}")

        records.append(record)
        _write_jsonl(records, result_jsonl)
        _write_markdown(records, report_md)
        if args.write_srt:
            _apply_results_to_srt(entries, records, output_srt)

    print()
    print(f"完成。JSONL: {result_jsonl}")
    print(f"报告: {report_md}")
    if args.write_srt:
        print(f"标注 SRT: {output_srt}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
