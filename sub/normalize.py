"""
normalize.py — 把 ASS 字幕归一化为统一的 NormalizedEntry 中间表示，
并落到 sub/intermediate/<project>/{normalized.srt, normalized.jsonl,
normalize_report.json}。

下游（extract_simple.py / 未来 LLM 补全 / 用户手编辑）只读这套中间产物，
不再回看 ASS。

详细规约见 sub/normalize_subtitle_design.md。

CLI:
    python sub/normalize.py "Cosmic Princess Kaguya"
    python sub/normalize.py "<proj>" --keep-nonspeech
    python sub/normalize.py "<proj>" --no-keep-unknown
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass, asdict
from pathlib import Path

# Windows 控制台 UTF-8 修复
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# 让 `python sub/normalize.py ...` 直接跑时也能 import 同目录模块
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from project_io import resolve_project, ProjectFiles, ProjectIOError  # noqa: E402
from _subtitle_utils import (  # noqa: E402
    SubtitleEntry,
    parse_subtitle,
    load_aliases,
    normalize_speaker,
    to_canonical,
    strip_lyric_lines,
)
from _srt_io import (  # noqa: E402
    NormalizedEntry,
    SPEAKER_UNKNOWN,
    SPEAKER_NONSPEECH,
    write_srt,
    write_jsonl,
)


# ============================================================
# 配置
# ============================================================

@dataclass
class NormalizeConfig:
    keep_nonspeech: bool = False
    keep_unknown: bool = True          # unlabeled 是否输出 [?]
    merge_overlap: bool = False        # 默认不做桶内合并（合并下放到 extract_simple 剪辑层）
    merge_gap_sec: float = 0.1         # 启用合并时：同 speaker 桶内合并的允许 gap

    def as_dict(self) -> dict:
        return asdict(self)


# 默认中间产物目录
DEFAULT_INTERMEDIATE_ROOT = Path("sub/intermediate")


# ============================================================
# 文本处理
# ============================================================

# 双向控制字符 + BOM（SDH 字幕排版用，不应出现在台词文本里）
_BIDI_CTRL = "\u200e\u200f\u202a\u202b\u202c\u202d\u202e\ufeff"


def _expand_ass_newlines(s: str) -> str:
    """ASS \\N (硬换行) / \\n (软换行) → 真换行。"""
    return s.replace("\\N", "\n").replace("\\n", "\n")


def _clean_text(s: str) -> str:
    """去掉 ASS 排版用的双向控制字符（LRM/RLM/PDF 等）和 BOM。"""
    for ch in _BIDI_CTRL:
        s = s.replace(ch, "")
    return s


def _prep_text(s: str) -> str:
    """展开 ASS 换行 + 清理控制字符，并去除 ♪ 歌词行。"""
    return _clean_text(strip_lyric_lines(_expand_ass_newlines(s)))


# ============================================================
# 核心算法
# ============================================================

def normalize_entries(
    entries: list[SubtitleEntry],
    alias_map: dict[str, str],
    config: NormalizeConfig,
) -> tuple[list[NormalizedEntry], dict]:
    """ASS entries → NormalizedEntry 列表 + 统计 dict。

    步骤:
      1. 顺序遍历 entries, 产出 raw 列表
      2. 同 speaker 分组合并重叠
      3. 全局按 (start, speaker) 排序, 分配 1-based idx
    """
    stats = _init_stats(entries)

    # ---------- Step 1: 遍历产出 raw entries（idx 暂置 0）----------
    raw: list[NormalizedEntry] = []

    for ass_idx, e in enumerate(entries):
        if e.kind == "single":
            sp_norm = e.speaker_norm or ""
            canonical = to_canonical(sp_norm, alias_map)
            if canonical is not None:
                speaker = canonical
                stats["alias_hit_singles"] += 1
            else:
                # decision #2: 保留原 token（normalize 后），不丢弃
                speaker = sp_norm or "?"
                stats["alias_miss_singles"] += 1
            text = _prep_text(e.speaker_text or "")
            if not text:
                stats["empty_speech_dropped"] += 1
                continue
            raw.append(NormalizedEntry(
                idx=0, start=e.start, end=e.end,
                speaker=speaker, tags=[],
                text=text,
                source_entries=[ass_idx],
            ))
        elif e.kind == "multi":
            stats["multi_entries"] += 1
            for part_raw, part_norm, part_text in e.multi_parts:
                text = _prep_text(part_text)
                if not text:
                    stats["empty_speech_dropped"] += 1
                    continue
                stats["multi_parts_emitted"] += 1
                canonical = to_canonical(part_norm, alias_map)
                if canonical is not None:
                    speaker = canonical
                    stats["alias_hit_in_multi_parts"] += 1
                else:
                    speaker = part_norm or "?"
                    stats["alias_miss_in_multi_parts"] += 1
                raw.append(NormalizedEntry(
                    idx=0, start=e.start, end=e.end,
                    speaker=speaker, tags=["MULTI"],
                    text=text,
                    source_entries=[ass_idx],
                ))
        elif e.kind == "nonspeech":
            if config.keep_nonspeech:
                raw.append(NormalizedEntry(
                    idx=0, start=e.start, end=e.end,
                    speaker=SPEAKER_NONSPEECH, tags=[],
                    text=_prep_text(e.text.strip()),
                    source_entries=[ass_idx],
                ))
                stats["nonspeech_kept"] += 1
            else:
                stats["nonspeech_dropped"] += 1
        elif e.kind == "unlabeled":
            if config.keep_unknown:
                raw.append(NormalizedEntry(
                    idx=0, start=e.start, end=e.end,
                    speaker=SPEAKER_UNKNOWN, tags=[],
                    text=_prep_text(e.text.strip()),
                    source_entries=[ass_idx],
                ))
                stats["unlabeled_unknown"] += 1
            else:
                stats["unlabeled_dropped"] += 1

        else:
            stats["unknown_kind"] += 1

    # ---------- Step 2: 同 speaker 分组, 桶内合并重叠 ----------
    if config.merge_overlap:
        merged, merge_pairs_per_speaker = _merge_overlapping_in_speaker(
            raw, gap_sec=config.merge_gap_sec
        )
        stats["merged_overlap_pairs_per_speaker"] = merge_pairs_per_speaker
    else:
        merged = raw
        stats["merged_overlap_pairs_per_speaker"] = {}

    # ---------- Step 3: 全局排序 + 分配 idx ----------
    merged.sort(key=lambda x: (x.start, x.speaker))
    for i, ent in enumerate(merged, start=1):
        ent.idx = i

    # ---------- 输出统计 ----------
    stats["output_entries_total"] = len(merged)
    out_speakers: dict[str, dict] = {}
    for ent in merged:
        bucket = out_speakers.setdefault(
            ent.speaker, {"count": 0, "total_duration_sec": 0.0}
        )
        bucket["count"] += 1
        bucket["total_duration_sec"] += ent.duration
    for sp in out_speakers:
        out_speakers[sp]["total_duration_sec"] = round(
            out_speakers[sp]["total_duration_sec"], 3
        )
    stats["output_speakers"] = dict(sorted(
        out_speakers.items(), key=lambda kv: -kv[1]["count"]
    ))

    return merged, stats


def _init_stats(entries: list[SubtitleEntry]) -> dict:
    kc = Counter(e.kind for e in entries)
    return {
        "input_ass_total": len(entries),
        "input_kind_counts": dict(kc),
        "alias_hit_singles": 0,
        "alias_miss_singles": 0,
        "multi_entries": 0,
        "multi_parts_emitted": 0,
        "alias_hit_in_multi_parts": 0,
        "alias_miss_in_multi_parts": 0,
        "unlabeled_unknown": 0,
        "unlabeled_dropped": 0,
        "nonspeech_kept": 0,
        "nonspeech_dropped": 0,
        "empty_speech_dropped": 0,
        "unknown_kind": 0,
    }


def _merge_overlapping_in_speaker(
    raw: list[NormalizedEntry], gap_sec: float
) -> tuple[list[NormalizedEntry], dict[str, int]]:
    """同 speaker 桶内贪心合并: cur.start <= last.end + gap_sec 时合并。

    跨 speaker 重叠保留（设计允许）。返回 (合并后列表, 各 speaker 合并次数)。
    `?` 和 `NONSPEECH` 也参与（按字面 speaker 分桶）。
    """
    by_speaker: dict[str, list[NormalizedEntry]] = {}
    for ent in raw:
        by_speaker.setdefault(ent.speaker, []).append(ent)

    out: list[NormalizedEntry] = []
    merge_counts: dict[str, int] = {}

    for sp, items in by_speaker.items():
        items.sort(key=lambda x: (x.start, x.end))
        bucket: list[NormalizedEntry] = []
        for cur in items:
            if not bucket:
                bucket.append(cur)
                continue
            last = bucket[-1]
            if cur.start <= last.end + gap_sec:
                # 歌词行（含 ♪）不与对话合并，各自独立
                if "♪" in cur.text or "♪" in last.text:
                    bucket.append(cur)
                    continue
                # 合并: 时间取并集, 文本拼接, tags 并集 + MERGED, source_entries 拼接
                last.end = max(last.end, cur.end)
                # 合并文本：两段不同台词用 ' / ' 分隔
                if cur.text and last.text:
                    last.text = last.text + " / " + cur.text
                elif cur.text:
                    last.text = cur.text
                # tags 并集（保持顺序：原 last 的 tags + 新加 + MERGED 单次出现）
                tag_set = list(last.tags)
                for t in cur.tags:
                    if t not in tag_set:
                        tag_set.append(t)
                if "MERGED" not in tag_set:
                    tag_set.append("MERGED")
                last.tags = tag_set
                last.source_entries = list(last.source_entries) + list(cur.source_entries)
                merge_counts[sp] = merge_counts.get(sp, 0) + 1
            else:
                bucket.append(cur)
        out.extend(bucket)

    return out, merge_counts


# ============================================================
# 报告
# ============================================================

def build_report(
    project: ProjectFiles,
    config: NormalizeConfig,
    stats: dict,
) -> dict:
    return {
        "project": project.project_name,
        "subtitle_source": project.subtitle.name,
        "aliases_source": project.aliases.name if project.aliases else None,
        "media_source": project.media.name,
        "effective_config": config.as_dict(),
        "stats": stats,
    }


def write_report(report: dict, path: Path) -> None:
    Path(path).write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ============================================================
# CLI
# ============================================================

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="把项目的 ASS 字幕归一化到 sub/intermediate/<project>/.",
    )
    p.add_argument("project", help="项目名（sub/input/<name>) 或项目目录路径")
    p.add_argument("--input-root", default="sub/input",
                   help="项目根目录（默认 sub/input）")
    p.add_argument("--media", default=None, help="覆盖媒体文件（仅记录到 report，不读）")
    p.add_argument("--subtitle", default=None, help="覆盖字幕文件路径")
    p.add_argument("--aliases", default=None, help="覆盖 aliases JSON 路径")
    p.add_argument("--output-dir", default=None,
                   help=f"中间产物输出目录（默认 {DEFAULT_INTERMEDIATE_ROOT}/<project>）")

    p.add_argument("--keep-nonspeech", dest="keep_nonspeech", action="store_true",
                   help="保留 nonspeech 行为 [NONSPEECH]（默认丢弃）")
    p.set_defaults(keep_nonspeech=False)

    p.add_argument("--no-keep-unknown", dest="keep_unknown", action="store_false",
                   help="不保留 unlabeled（默认保留为 [?]）")
    p.set_defaults(keep_unknown=True)

    p.add_argument("--merge-overlap", dest="merge_overlap", action="store_true",
                   help="启用同 speaker 桶内合并（默认禁用，合并已下放到 extract_simple 剪辑层）")
    p.set_defaults(merge_overlap=False)

    p.add_argument("--merge-gap-sec", type=float, default=0.1,
                   help="桶内合并容忍 gap（秒，仅 --merge-overlap 启用时生效）")

    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    # 1) 解析项目文件
    try:
        project = resolve_project(
            args.project,
            input_root=Path(args.input_root),
            media=args.media,
            subtitle=args.subtitle,
            aliases=args.aliases,
        )
    except ProjectIOError as e:
        print(f"[!] 项目解析失败: {e}", file=sys.stderr)
        return 2

    print(project.summary())
    print()

    # 2) 加载字幕 + aliases
    entries = parse_subtitle(project.subtitle)
    alias_map = load_aliases(project.aliases) if project.aliases else {}
    print(f"字幕条数: {len(entries)}; aliases variants: {len(alias_map)}")

    # 3) 配置
    config = NormalizeConfig(
        keep_nonspeech=args.keep_nonspeech,
        keep_unknown=args.keep_unknown,
        merge_overlap=args.merge_overlap,
        merge_gap_sec=args.merge_gap_sec,
    )

    # 4) 跑算法
    normalized, stats = normalize_entries(entries, alias_map, config)

    # 5) 输出目录
    if args.output_dir:
        out_dir = Path(args.output_dir)
    else:
        out_dir = DEFAULT_INTERMEDIATE_ROOT / project.project_name
    out_dir.mkdir(parents=True, exist_ok=True)

    srt_path = out_dir / "normalized.srt"
    jsonl_path = out_dir / "normalized.jsonl"
    report_path = out_dir / "normalize_report.json"

    write_srt(normalized, srt_path)
    write_jsonl(normalized, jsonl_path)
    write_report(build_report(project, config, stats), report_path)

    # 6) 摘要
    print()
    print(f"输出 {len(normalized)} 条 ->")
    print(f"  {srt_path}")
    print(f"  {jsonl_path}")
    print(f"  {report_path}")
    print()
    print("=== 输出 speaker 分布（前 15）===")
    for i, (sp, info) in enumerate(stats["output_speakers"].items()):
        if i >= 15:
            break
        print(f"  {info['count']:>5d}  {info['total_duration_sec']:>8.1f}s  {sp}")
    print()
    print("=== 关键统计 ===")
    keys = [
        "alias_hit_singles", "alias_miss_singles",
        "multi_entries", "multi_parts_emitted",
        "alias_hit_in_multi_parts", "alias_miss_in_multi_parts",
        "unlabeled_unknown", "unlabeled_dropped",
        "nonspeech_kept", "nonspeech_dropped", "empty_speech_dropped",
    ]
    for k in keys:
        print(f"  {k:<32s} {stats[k]}")
    if stats["merged_overlap_pairs_per_speaker"]:
        print("  merged_overlap_pairs_per_speaker:")
        for sp, n in sorted(stats["merged_overlap_pairs_per_speaker"].items(),
                            key=lambda kv: -kv[1]):
            print(f"    {n:>4d}  {sp}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
