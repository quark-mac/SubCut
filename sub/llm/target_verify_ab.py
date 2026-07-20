"""
target_verify_ab.py — 文本 LLM 的 N 选 1 vs 目标角色二分类 A/B 测试。

用途：
  从现有 llm_audit.json 或 SRT 中抽取“可能属于某目标角色”的条目，
  对同一条目分别询问：
    A. N 选 1：这句是谁说的？
    B. 目标验证：这句是否由 <target> 说出？

  脚本只生成测试报告，不修改 llm_corrected.srt / normalized.srt。

示例：
  env\python.exe sub\llm\target_verify_ab.py "Cosmic Princess Kaguya" --target Iroha --max-items 20
  env\python.exe sub\llm\target_verify_ab.py "Cosmic Princess Kaguya" --target Kaguya --dry-run --max-items 3
"""

from __future__ import annotations

import argparse
import json
import random
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
    CANONICAL_SPEAKERS,
    DEFAULT_CONFIG_PATH,
    INTERMEDIATE_ROOT,
    LLMConfig,
    _format_entry_line,
    _format_role_descriptions,
    _make_client,
    call_llm,
    load_config,
    load_role_descriptions,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="文本 LLM A/B 测试：N 选 1 vs 目标角色二分类",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("project", help="项目名，对应 sub/input/<project>/")
    parser.add_argument("--target", required=True, help="目标角色，如 Iroha / Kaguya")
    parser.add_argument("--max-items", type=int, default=30, help="最多抽取 N 条（默认 30）")
    parser.add_argument("--context-window", type=int, default=None, help="覆盖配置里的上下文窗口")
    parser.add_argument("--seed", type=int, default=42, help="随机抽样种子（默认 42）")
    parser.add_argument(
        "--source",
        choices=("auto", "audit", "srt"),
        default="auto",
        help="候选来源：audit=llm_audit 中 final_spk/corrected_spk 命中目标；srt=SRT speaker 命中目标；auto 优先 audit",
    )
    parser.add_argument(
        "--confidence",
        default="high",
        help="audit 来源下筛选 confidence，逗号分隔；空字符串表示不限（默认 high）",
    )
    parser.add_argument("--srt", type=Path, default=None, help="输入 SRT，默认优先 llm_corrected.srt 再 normalized.srt")
    parser.add_argument("--audit", type=Path, default=None, help="输入 audit JSON，默认 sub/intermediate/<project>/llm_audit.json")
    parser.add_argument("--role-desc", type=Path, default=None, help="角色介绍 JSON 路径")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH, help="LLM 配置文件路径")
    parser.add_argument("--output", type=Path, default=None, help="输出 JSONL 路径")
    parser.add_argument("--markdown", type=Path, default=None, help="输出 Markdown 审核表路径")
    parser.add_argument("--report-only", action="store_true", help="只把已有 JSONL 转成 Markdown，不调用 API")
    parser.add_argument("--dry-run", action="store_true", help="只打印 prompt，不调用 API")
    return parser.parse_args()


def _resolve_srt(project: str, explicit: Path | None) -> Path:
    if explicit is not None:
        if not explicit.exists():
            raise FileNotFoundError(f"找不到输入 SRT: {explicit}")
        return explicit
    intermediate_dir = INTERMEDIATE_ROOT / project
    for name in ("llm_corrected.srt", "normalized.srt"):
        candidate = intermediate_dir / name
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"找不到 SRT: {intermediate_dir / 'llm_corrected.srt'} 或 normalized.srt")


def _resolve_audit(project: str, explicit: Path | None) -> Path:
    path = explicit or (INTERMEDIATE_ROOT / project / "llm_audit.json")
    if not path.exists():
        raise FileNotFoundError(f"找不到 audit JSON: {path}")
    return path


def _entry_context(entries: list[NormalizedEntry], pos: int, window: int) -> str:
    start = max(0, pos - window)
    end = min(len(entries), pos + window + 1)
    lines = []
    for i in range(start, end):
        lines.append(_format_entry_line(entries[i], i == pos))
    return "\n".join(lines)


def _load_audit_candidates(
    audit_path: Path,
    target: str,
    allowed_confidence: set[str] | None,
) -> list[int]:
    raw = json.loads(audit_path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError(f"audit JSON 应为数组: {audit_path}")

    idxs: list[int] = []
    seen: set[int] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        final_spk = str(item.get("final_spk") or item.get("corrected_spk") or "")
        confidence = str(item.get("confidence", ""))
        if final_spk != target:
            continue
        if allowed_confidence is not None and confidence not in allowed_confidence:
            continue
        try:
            idx = int(item["idx"])
        except (KeyError, TypeError, ValueError):
            continue
        if idx not in seen:
            idxs.append(idx)
            seen.add(idx)
    return idxs


def _pick_candidate_positions(args: argparse.Namespace, entries: list[NormalizedEntry]) -> tuple[str, list[int]]:
    idx_to_pos = {entry.idx: i for i, entry in enumerate(entries)}
    source = args.source

    if source in ("auto", "audit"):
        try:
            confidence = None if args.confidence == "" else {c.strip() for c in args.confidence.split(",") if c.strip()}
            audit_path = _resolve_audit(args.project, args.audit)
            idxs = _load_audit_candidates(audit_path, args.target, confidence)
            positions = [idx_to_pos[idx] for idx in idxs if idx in idx_to_pos]
            if positions or source == "audit":
                return "audit", positions
        except FileNotFoundError:
            if source == "audit":
                raise

    positions = [i for i, entry in enumerate(entries) if entry.speaker == args.target]
    return "srt", positions


def _render_n_pick_prompt(
    entry: NormalizedEntry,
    context_text: str,
    role_text: str,
) -> str:
    speakers = " / ".join(sorted(CANONICAL_SPEAKERS)) + " / ?"
    return f"""以下是一段日语动画对话。标有 ← 的条目需要判断真正说话人。

=== 角色介绍 ===
{role_text}

=== 可选说话人 ===
{speakers}

=== 对话 ===
{context_text}

=== 任务 ===
请判断 idx={entry.idx} 这一条是谁说的。不要为了填答案而强行选择；如果文本和上下文不足以判断，speaker 输出 "?"。

只输出 JSON 对象，不要输出其他文字：
{{
  "idx": {entry.idx},
  "speaker": "<推断 speaker 或 ?>",
  "confidence": "high" | "mid" | "low",
  "reason": "<简短理由>"
}}"""


def _render_target_verify_prompt(
    entry: NormalizedEntry,
    target: str,
    context_text: str,
    role_text: str,
) -> str:
    return f"""以下是一段日语动画对话。标有 ← 的条目需要判断是否由目标角色说出。

=== 角色介绍 ===
{role_text}

=== 目标角色 ===
{target}

=== 对话 ===
{context_text}

=== 任务 ===
请判断 idx={entry.idx} 这一条是否由 {target} 说出。

判断原则：
1. 只有在台词、上下文或已知说话人链条足够支持时，才输出 yes_target。
2. 如果更可能是其他角色，输出 no_other_speaker，不需要指出具体是谁。
3. 如果证据不足、短叹词无法判断、上下文冲突，输出 unclear。
4. 如果明显多人同时说话或无法作为单角色 TTS 样本，输出 overlap。

只输出 JSON 对象，不要输出其他文字：
{{
  "idx": {entry.idx},
  "target": "{target}",
  "decision": "yes_target" | "no_other_speaker" | "unclear" | "overlap",
  "reason": "<简短理由>"
}}"""


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
    if not isinstance(data, dict):
        return {"_parse_error": "not_object", "raw": raw}
    return data


def _write_jsonl(records: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(json.dumps(record, ensure_ascii=False) for record in records) + "\n"
    path.write_text(text, encoding="utf-8")


def _cell(value: Any, max_len: int = 80) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\r", " ").replace("\n", " / ").replace("|", "\\|")
    text = " ".join(text.split())
    if len(text) > max_len:
        return text[: max_len - 1] + "…"
    return text


def _write_markdown(records: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    yes_count = sum(1 for r in records if r.get("target_verify", {}).get("decision") == "yes_target")
    no_count = len(records) - yes_count
    target = records[0].get("target", "?") if records else "?"

    lines = [
        f"# Target Verify A/B Report — {target}",
        "",
        f"- total: {len(records)}",
        f"- target_verify yes_target: {yes_count}",
        f"- target_verify rejected: {no_count}",
        "",
        "| idx | time | srt speaker | N pick | target verify | text | reasons |",
        "|---:|---|---|---|---|---|---|",
    ]

    for record in records:
        n_pick = record.get("n_pick", {})
        verify = record.get("target_verify", {})
        time = seconds_to_srt_time(float(record.get("start", 0)))[:12]
        n_label = n_pick.get("speaker") or n_pick.get("_parse_error") or "?"
        verify_label = verify.get("decision") or verify.get("_parse_error") or "?"
        n_reason = n_pick.get("reason") or n_pick.get("raw") or ""
        verify_reason = verify.get("reason") or verify.get("raw") or ""
        reasons = f"N: {n_reason} / V: {verify_reason}"
        lines.append(
            "| "
            + " | ".join([
                _cell(record.get("idx"), 12),
                _cell(time, 16),
                _cell(record.get("speaker_in_srt"), 24),
                _cell(n_label, 24),
                _cell(verify_label, 24),
                _cell(record.get("text"), 90),
                _cell(reasons, 140),
            ])
            + " |"
        )

    conflicts = [
        record for record in records
        if (record.get("n_pick", {}).get("speaker") == record.get("target"))
        != (record.get("target_verify", {}).get("decision") == "yes_target")
    ]
    if conflicts:
        lines.extend([
            "",
            "## Conflicts",
            "",
            "| idx | N pick | target verify | text |",
            "|---:|---|---|---|",
        ])
        for record in conflicts:
            lines.append(
                "| "
                + " | ".join([
                    _cell(record.get("idx"), 12),
                    _cell(record.get("n_pick", {}).get("speaker"), 24),
                    _cell(record.get("target_verify", {}).get("decision"), 24),
                    _cell(record.get("text"), 100),
                ])
                + " |"
            )

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    args = _parse_args()
    cfg: LLMConfig = load_config(args.config)
    context_window = args.context_window if args.context_window is not None else cfg.context_window

    srt_path = _resolve_srt(args.project, args.srt)
    entries = parse_srt(srt_path)
    source, positions = _pick_candidate_positions(args, entries)
    if not positions:
        print(f"[error] 没有找到候选条目：source={source}, target={args.target}", file=sys.stderr)
        return 1

    rng = random.Random(args.seed)
    if args.max_items > 0 and len(positions) > args.max_items:
        positions = rng.sample(positions, args.max_items)
        positions.sort(key=lambda pos: entries[pos].idx)

    role_desc_path = args.role_desc or (_REPO_ROOT / "sub" / "input" / args.project / "role_descriptions.json")
    role_desc = load_role_descriptions(role_desc_path)
    role_text = _format_role_descriptions(role_desc)
    output_path = args.output or (INTERMEDIATE_ROOT / args.project / f"target_verify_ab_{args.target}.jsonl")
    markdown_path = args.markdown or output_path.with_suffix(".md")

    if args.report_only:
        if not output_path.exists():
            print(f"[error] 找不到 JSONL: {output_path}", file=sys.stderr)
            return 1
        records = [
            json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        _write_markdown(records, markdown_path)
        print(f"已生成 Markdown 审核表：{markdown_path}")
        return 0

    print(f"项目       : {args.project}")
    print(f"目标角色   : {args.target}")
    print(f"输入 SRT   : {srt_path}")
    print(f"候选来源   : {source}")
    print(f"测试条目   : {len(positions)}")
    print(f"context    : ±{context_window} 条")
    print(f"模型       : {cfg.model}  ({cfg.base_url})")
    print(f"输出 JSONL : {output_path}")
    print(f"输出 MD    : {markdown_path}")
    print()

    records: list[dict[str, Any]] = []
    if args.dry_run:
        for count, pos in enumerate(positions, start=1):
            entry = entries[pos]
            context_text = _entry_context(entries, pos, context_window)
            print("=" * 60)
            print(f"Item {count}/{len(positions)} idx={entry.idx}")
            print("--- N pick prompt ---")
            print(_render_n_pick_prompt(entry, context_text, role_text))
            print("--- target verify prompt ---")
            print(_render_target_verify_prompt(entry, args.target, context_text, role_text))
        print("[dry-run] 完成，未调用 LLM API")
        return 0

    client = _make_client(cfg)
    system_prompt = (
        "你是一个专业的日语动画角色识别助手。"
        "请严格按照用户要求的 JSON 格式输出，不要输出任何其他内容。"
    )

    for count, pos in enumerate(positions, start=1):
        entry = entries[pos]
        context_text = _entry_context(entries, pos, context_window)
        print(f"[{count}/{len(positions)}] idx={entry.idx} {seconds_to_srt_time(entry.start)} ", end="", flush=True)

        n_prompt = _render_n_pick_prompt(entry, context_text, role_text)
        verify_prompt = _render_target_verify_prompt(entry, args.target, context_text, role_text)

        n_raw = call_llm(client, cfg.model, n_prompt, system_prompt=system_prompt)
        verify_raw = call_llm(client, cfg.model, verify_prompt, system_prompt=system_prompt)
        n_result = _parse_json_object(n_raw)
        verify_result = _parse_json_object(verify_raw)

        record = {
            "idx": entry.idx,
            "start": round(entry.start, 3),
            "end": round(entry.end, 3),
            "speaker_in_srt": entry.speaker,
            "tags": list(entry.tags),
            "text": entry.text,
            "target": args.target,
            "candidate_source": source,
            "n_pick": n_result,
            "target_verify": verify_result,
        }
        records.append(record)
        _write_jsonl(records, output_path)
        _write_markdown(records, markdown_path)

        n_speaker = n_result.get("speaker", "?")
        decision = verify_result.get("decision", "?")
        print(f"N={n_speaker}  verify={decision}")

    print()
    print(f"完成。已写入 {len(records)} 条 A/B 结果：{output_path}")
    print(f"Markdown 审核表：{markdown_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
