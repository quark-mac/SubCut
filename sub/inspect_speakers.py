"""
inspect_speakers.py — 扫描字幕，统计说话人标注情况。

只生成报告（不切片、不调 ffmpeg）。配合 docs/skills/build_speaker_aliases.md
里的工作流，用于人工/AI 决定如何写 speaker_aliases.json。

用法:
    python sub/inspect_speakers.py                              # 处理 sub/input 下所有项目
    python sub/inspect_speakers.py "Cosmic Princess Kaguya"     # 单个项目
    python sub/inspect_speakers.py --top 100 --samples 1
    python sub/inspect_speakers.py --subtitle path/to/file.ass  # 显式指定字幕
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

from _subtitle_utils import (
    parse_subtitle,
    iter_speakers,
    load_aliases,
)
from project_io import (
    DEFAULT_INPUT_ROOT,
    list_projects,
    resolve_project,
    ProjectIOError,
)

# UTF-8 stdout（Windows GBK 会乱）
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def inspect_one(
    subtitle_path: Path,
    *,
    aliases_path: Path | None = None,
    top: int = 80,
    samples: int = 1,
) -> list[str]:
    """对单个字幕文件生成报告行（list[str]）。"""
    out: list[str] = []

    def w(line: str = ""):
        print(line)
        out.append(line)

    w(f"\n=== {subtitle_path.name} ===")
    entries = parse_subtitle(subtitle_path)

    # 按 kind 计数
    kind_counts: Counter[str] = Counter(e.kind for e in entries)
    speaker_count: Counter[str] = Counter()
    speaker_samples: dict[str, list[str]] = defaultdict(list)
    raw_variants: dict[str, set[str]] = defaultdict(set)

    for e in entries:
        for raw, norm, text in iter_speakers(e):
            speaker_count[norm] += 1
            raw_variants[norm].add(raw)
            if len(speaker_samples[norm]) < samples:
                speaker_samples[norm].append(text[:60])

    w(f"总 Dialogue 行数: {len(entries)}")
    w(f"  有说话人标签 (single):    {kind_counts.get('single', 0)} 行")
    w(f"  一行多说话人 (multi):     {kind_counts.get('multi', 0)} 行")
    w(f"  纯音效行 (nonspeech):     {kind_counts.get('nonspeech', 0)} 行")
    w(f"  无标签 (unlabeled):       {kind_counts.get('unlabeled', 0)} 行")
    w(f"  独立说话人 (normalize 后): {len(speaker_count)}")

    w(f"\n--- 出现频次 Top {top} ---")
    for name, cnt in speaker_count.most_common(top):
        variants = raw_variants[name]
        variant_str = ""
        if len(variants) > 1 or (variants and list(variants)[0] != name):
            variant_str = "  原始变体: " + " | ".join(sorted(variants))
        w(f"  {cnt:>5d}  {name}{variant_str}")
        for s in speaker_samples[name]:
            w(f"          - {s}")

    # 各类别样本
    no_label = [e for e in entries if e.kind == "unlabeled"]
    nonspeech = [e for e in entries if e.kind == "nonspeech"]
    multi = [e for e in entries if e.kind == "multi"]

    w("\n--- 无标签行样本 (前 5) ---")
    for e in no_label[:5]:
        w(f"  [{e.start_str}] {e.text[:80]}")

    w("\n--- 纯音效行样本 (前 5) ---")
    for e in nonspeech[:5]:
        w(f"  [{e.start_str}] {e.text[:80]}")

    w("\n--- 多说话人行样本 (前 3) ---")
    for e in multi[:3]:
        w(f"  [{e.start_str}] {e.text[:120]}")

    # 如果有 aliases，附带覆盖率统计
    if aliases_path and aliases_path.is_file():
        amap = load_aliases(aliases_path)
        canon_count: Counter[str] = Counter()
        unmapped: Counter[str] = Counter()
        for e in entries:
            for _raw, norm, _txt in iter_speakers(e):
                c = amap.get(norm)
                if c:
                    canon_count[c] += 1
                else:
                    unmapped[norm] += 1
        w(f"\n--- aliases 覆盖率 ({aliases_path.name}) ---")
        w(f"加载 {len(amap)} 条 variant -> canonical 映射")
        w(f"\n命中 canonical:")
        for k, v in canon_count.most_common():
            w(f"  {v:>5d}  {k}")
        w(f"\n未命中变体 (前 15):")
        for k, v in unmapped.most_common(15):
            w(f"  {v:>5d}  {k}")

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "project", nargs="?", default=None,
        help="项目名（sub/input 下的子目录）；省略则处理全部项目"
    )
    ap.add_argument("--input", default=str(DEFAULT_INPUT_ROOT),
                    help="input 根目录")
    ap.add_argument("--subtitle", default=None,
                    help="显式指定字幕文件（绕过 project_io 自动配对）")
    ap.add_argument("--aliases", default=None,
                    help="显式指定 aliases 文件")
    ap.add_argument("--top", type=int, default=100,
                    help="频次 Top N 列出（默认 100，写 aliases 用 100+）")
    ap.add_argument("--samples", type=int, default=1,
                    help="每个 speaker 附带样本台词数")
    ap.add_argument("--report", default="sub/inspect_report.txt",
                    help="把报告写到该文件（UTF-8）")
    args = ap.parse_args()

    input_root = Path(args.input)
    all_lines: list[str] = []

    # 1) 优先：--subtitle 显式指定
    if args.subtitle:
        sub = Path(args.subtitle)
        if not sub.is_file():
            print(f"[!] 字幕文件不存在: {sub}", file=sys.stderr)
            return 1
        aliases = Path(args.aliases) if args.aliases else None
        all_lines.extend(inspect_one(sub, aliases_path=aliases,
                                     top=args.top, samples=args.samples))
    # 2) 指定项目名
    elif args.project:
        try:
            pf = resolve_project(args.project, input_root=input_root,
                                 aliases=args.aliases)
        except ProjectIOError as e:
            print(f"[!] {e}", file=sys.stderr)
            return 1
        all_lines.extend(inspect_one(pf.subtitle, aliases_path=pf.aliases,
                                     top=args.top, samples=args.samples))
    # 3) 处理全部项目
    else:
        projects = list_projects(input_root)
        if not projects:
            print(f"[!] {input_root} 下没有项目")
            return 1
        for proj_dir in projects:
            try:
                pf = resolve_project(proj_dir.name, input_root=input_root)
            except ProjectIOError as e:
                print(f"[!] 跳过 {proj_dir.name}: {e}", file=sys.stderr)
                continue
            all_lines.extend(inspect_one(pf.subtitle,
                                         aliases_path=pf.aliases,
                                         top=args.top, samples=args.samples))

    if args.report:
        rp = Path(args.report)
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text("\n".join(all_lines), encoding="utf-8")
        print(f"\n[报告已写入] {rp}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
