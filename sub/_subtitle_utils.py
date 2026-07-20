"""
_subtitle_utils.py — 字幕解析与说话人规范化（共享模块）。

服务两类调用方:
- sub/inspect_speakers.py: 统计字幕里出现的所有说话人 token
- sub/extract_simple.py:   按角色切片（待写）

核心数据结构是 SubtitleEntry，对每条 Dialogue 标记 kind:
  "single"     — 单说话人有标签：(角色)台词
  "multi"      — 一行多说话人：-(A)台词\\N-(B)台词
  "nonspeech"  — 整行只有括号包的音效描述：(琵琶の音)
  "unlabeled"  — 有台词但没标签（承接上文）

下游靠 kind 决定保留 / 丢弃 / 拆分。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator


# ============================================================
# 字符 / 正则常量
# ============================================================

# 行首可能的双向控制字符（U+200E LRM 等）
LEAD_CTRL = "\u200e\u200f\u202a\u202b\u202c\u202d\u202e\ufeff "

OPEN_PARENS = "(（"
CLOSE_PARENS = ")）"

# 一行多说话人的 dash 前缀（半角/全角各种）
DASH_CHARS = "-－─―‐"

# ASS Dialogue 行格式
DIALOGUE_RE = re.compile(
    r"^Dialogue:\s*"
    r"(?P<layer>[^,]*),"
    r"(?P<start>[^,]*),"
    r"(?P<end>[^,]*),"
    r"(?P<style>[^,]*),"
    r"(?P<name>[^,]*),"
    r"(?P<ml>[^,]*),"
    r"(?P<mr>[^,]*),"
    r"(?P<mv>[^,]*),"
    r"(?P<effect>[^,]*),"
    r"(?P<text>.*)$"
)

# 嵌套 furigana 括号 (ふりがな) — 只匹配最内层、不含嵌套
_FURIGANA_RE = re.compile(r"[（(][^（()）]*[)）]")

# ASS 样式覆盖 {\an8} 等
_OVERRIDE_RE = re.compile(r"\{[^}]*\}")


# ============================================================
# 字符串底层工具
# ============================================================

def strip_lead(text: str) -> str:
    """去掉行首的控制字符 / BOM / 普通空格。"""
    return text.lstrip(LEAD_CTRL)


def strip_ass_overrides(text: str) -> str:
    """去掉 {\\an8} {\\fad(...)} 这类样式覆盖标签。"""
    return _OVERRIDE_RE.sub("", text)


def find_balanced_paren(s: str, start: int) -> int:
    """从 start 位置（应是开括号）找配对闭括号，支持嵌套。
    找不到返回 -1。"""
    if start >= len(s) or s[start] not in OPEN_PARENS:
        return -1
    depth = 0
    i = start
    while i < len(s):
        c = s[i]
        if c in OPEN_PARENS:
            depth += 1
        elif c in CLOSE_PARENS:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def extract_leading_speaker(text: str) -> tuple[str | None, str]:
    """如果文本开头是 (说话人)，返回 (说话人原始字符串, 剩余文本)。
    否则返回 (None, 原文本)。会跳过开头的 dash 前缀。"""
    t = strip_lead(text)
    while t and t[0] in DASH_CHARS:
        t = t[1:].lstrip(LEAD_CTRL)
    if not t or t[0] not in OPEN_PARENS:
        return None, text
    end = find_balanced_paren(t, 0)
    if end < 0:
        return None, text
    speaker = t[1:end]
    rest = t[end + 1:]
    return speaker, rest


def is_nonspeech_only(text: str) -> bool:
    """整行是否只有外层括号 + 内部描述（无任何外部文字）。"""
    t = strip_lead(text).strip()
    if not t or t[0] not in OPEN_PARENS:
        return False
    end = find_balanced_paren(t, 0)
    if end < 0:
        return False
    return t[end + 1:].strip() == ""


def normalize_speaker(raw: str) -> str:
    """字幕原始说话人 token → 规范化形式。

    规则:
      - 去掉所有 furigana 注释 (...) 嵌套（汉字读音）
      - 去掉双向控制字符 (LRM/RLM/PDF 等) 和 BOM —— 它们是字幕排版用的，
        不该出现在角色名里；保留会导致下游 alias 匹配失败
      - 'NA:ヤチヨ' / 'ナレーション:X' 类的冒号前缀**保留**整体
        （它是同一声优在不同情境，aliases 会决定是否合并）

    例:
      '酒寄(さかより)彩葉(いろは)' → '酒寄彩葉'
      '\u200eNA(ナレーション)\u200e:\u200e月見(るなみ)\u200eヤチヨ' → 'NA:月見ヤチヨ'
      '配信:かぐや' → '配信:かぐや'
    """
    s = raw
    # 去 LRM/RLM 等双向控制字符 + BOM
    for ch in "\u200e\u200f\u202a\u202b\u202c\u202d\u202e\ufeff":
        s = s.replace(ch, "")
    # 迭代去 furigana 直到不变
    while True:
        new = _FURIGANA_RE.sub("", s)
        if new == s:
            break
        s = new
    return s.strip()


def is_multispeaker(text: str) -> list[str] | None:
    """检测一行多说话人。返回 \\N 分割后的各段（原始字符串）或 None。

    判定规则: 至少 2 个 \\N-分隔的 part 以 (说话人) 开头（dash 前缀可有可无）。
    包含字幕里两种 SDH 常见格式:
      - 带 dash:  '-(A)台词\\N-(B)台词'
      - 不带 dash: '(A)台词\\N(B)台词'  (例如本片 #411 的 (彩葉)うぅ~\\N(かぐや)だって…)

    要求 (speaker) 后必须有内容（避免把 '(speaker)' 单独占一行的情况误判为多说话人）。
    """
    t = strip_lead(text)
    parts = re.split(r"\\N|\n", t)
    if len(parts) < 2:
        return None

    parts_with_speaker = 0
    for p in parts:
        ps = p.lstrip(LEAD_CTRL)
        while ps and ps[0] in DASH_CHARS:
            ps = ps[1:].lstrip(LEAD_CTRL)
        if not ps or ps[0] not in OPEN_PARENS:
            continue
        end = find_balanced_paren(ps, 0)
        if end > 0 and ps[end + 1:].strip():
            parts_with_speaker += 1

    return parts if parts_with_speaker >= 2 else None


def _scan_parts_for_speaker(text: str) -> tuple[str, str] | None:
    """跨 \\N 分段扫描，找到第一个带 (speaker) 的部分。

    返回 (sp_raw, rebuilt_text) 或 None。
    rebuilt_text 是去掉了 speaker 标记后重组的完整文本。
    """
    parts = re.split(r"\\N|\n", text)
    for i, p in enumerate(parts):
        sp_raw, sp_rest = extract_leading_speaker(p)
        if sp_raw is not None:
            parts[i] = sp_rest.strip()
            rebuilt = "\\N".join(px.strip() for px in parts if px.strip()).strip()
            return sp_raw, rebuilt
    return None


def strip_lyric_lines(text: str) -> str:
    r"""去掉文本中的 ♪ 歌词行（\N 分段中 ♪ ♫ ♬ 开头的部分）。"""
    parts = re.split(r"\\N|\n", text)
    kept = []
    for p in parts:
        p_clean = p.strip().lstrip(LEAD_CTRL).lstrip("~ 　")
        if p_clean.startswith(("♪", "♫", "♬")):
            continue  # 丢弃歌词行
        kept.append(p.strip())
    return "\\N".join(px for px in kept if px).strip()


def ass_time_to_seconds(t: str) -> float:
    """ASS 时间戳 'H:MM:SS.CC' → 秒数 float。"""
    h, m, rest = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest)


def seconds_to_ass_time(sec: float) -> str:
    """秒数 → ASS 'H:MM:SS.CC' 格式（主要给日志/报告用）。"""
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec - h * 3600 - m * 60
    return f"{h}:{m:02d}:{s:05.2f}"


# ============================================================
# 数据结构
# ============================================================

@dataclass
class SubtitleEntry:
    # 时间
    start: float                    # 秒
    end: float                      # 秒
    start_str: str                  # 原始 '0:00:26.02'
    end_str: str
    # 文本
    style: str
    text_raw: str                   # ASS Text 字段原文
    text: str                       # 去掉 {\\xxx} 后
    # 分类
    kind: str                       # single / multi / nonspeech / unlabeled
    # single 专属
    speaker_raw: str | None = None
    speaker_norm: str | None = None
    speaker_text: str | None = None  # 去掉 (speaker) 前缀后的台词
    # multi 专属：[(raw, norm, text_part), ...]
    multi_parts: list[tuple[str, str, str]] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.end - self.start


# ============================================================
# 解析入口
# ============================================================

def parse_ass(path: Path) -> list[SubtitleEntry]:
    """解析 ASS 文件，每条 Dialogue 一个 SubtitleEntry。"""
    entries: list[SubtitleEntry] = []
    raw = Path(path).read_text(encoding="utf-8-sig")

    for line in raw.splitlines():
        m = DIALOGUE_RE.match(line)
        if not m:
            continue

        start_s = m.group("start")
        end_s = m.group("end")
        text_raw = m.group("text")
        text = strip_ass_overrides(text_raw)

        # 分类
        kind: str
        speaker_raw = speaker_norm = speaker_text = None
        multi_parts: list[tuple[str, str, str]] = []

        multi = is_multispeaker(text)
        if multi:
            kind = "multi"
            for part in multi:
                p = part.lstrip(LEAD_CTRL)
                while p and p[0] in DASH_CHARS:
                    p = p[1:].lstrip(LEAD_CTRL)
                sp_raw, rest = extract_leading_speaker(p)
                if sp_raw is not None:
                    multi_parts.append(
                        (sp_raw, normalize_speaker(sp_raw), rest.strip())
                    )
        elif is_nonspeech_only(text):
            kind = "nonspeech"
        else:
            sp_raw, rest = extract_leading_speaker(text)
            if sp_raw is None:
                t_clean = text.strip().lstrip(LEAD_CTRL).lstrip("~ 　")
                # 歌词行（♪ ♫ ♬）→ nonspeech
                if t_clean.startswith(("♪", "♫", "♬")):
                    kind = "nonspeech"
                else:
                    # 尝试跨 \N 分段扫描 speaker（可能不在第一段）
                    found_sp = _scan_parts_for_speaker(text)
                    if found_sp is not None:
                        sp_raw, rebuilt_text = found_sp
                        kind = "single"
                        speaker_raw = sp_raw
                        speaker_norm = normalize_speaker(sp_raw)
                        speaker_text = rebuilt_text.strip()
                    else:
                        kind = "unlabeled"
            else:
                kind = "single"
                speaker_raw = sp_raw
                speaker_norm = normalize_speaker(sp_raw)
                speaker_text = rest.strip()

                # 处理 SDH 的"音效/环境标签 + 实际角色"双层格式：
                #   (音楽が流れる)\N(彩葉)はっ!
                # 第一个 ( ) 是音效描述，\N 后的第二个 ( ) 才是真正说话人。
                rest_trim = rest.lstrip() if rest else ""
                if rest_trim.startswith(("\\N", "\n")):
                    n_index = 1 if rest_trim[0] == "\n" else 2
                    after_n = rest_trim[n_index:].lstrip(LEAD_CTRL)
                    second_sp, second_rest = extract_leading_speaker(after_n)
                    if second_sp is not None:
                        speaker_raw = second_sp
                        speaker_norm = normalize_speaker(second_sp)
                        speaker_text = second_rest.strip()

        try:
            start = ass_time_to_seconds(start_s)
            end = ass_time_to_seconds(end_s)
        except (ValueError, AttributeError):
            # 跳过坏时间戳
            continue

        entries.append(SubtitleEntry(
            start=start, end=end,
            start_str=start_s, end_str=end_s,
            style=m.group("style"),
            text_raw=text_raw, text=text,
            kind=kind,
            speaker_raw=speaker_raw,
            speaker_norm=speaker_norm,
            speaker_text=speaker_text,
            multi_parts=multi_parts,
        ))

    return entries


def parse_subtitle(path: Path) -> list[SubtitleEntry]:
    """通用入口：按扩展名分发到具体解析器。"""
    p = Path(path)
    ext = p.suffix.lower()
    if ext in {".ass", ".ssa"}:
        return parse_ass(p)
    raise NotImplementedError(
        f"暂不支持 {ext} 格式（仅 .ass/.ssa）。"
        f"如需 SRT/VTT 支持，可在 _subtitle_utils.parse_subtitle 里加分发。"
    )


def iter_speakers(entry: SubtitleEntry) -> Iterator[tuple[str, str, str]]:
    """统一遍历一条 entry 里出现的所有说话人 (raw, norm, text)。

    - single → 1 项
    - multi  → N 项
    - nonspeech / unlabeled → 0 项
    """
    if entry.kind == "single" and entry.speaker_raw is not None:
        yield (entry.speaker_raw,
               entry.speaker_norm or "",
               entry.speaker_text or "")
    elif entry.kind == "multi":
        yield from entry.multi_parts


# ============================================================
# 别名映射
# ============================================================

def load_aliases(path: Path) -> dict[str, str]:
    """读取 speaker_aliases.json，返回 {variant_normalized: canonical}。

    JSON 结构: {canonical: [variant1, variant2, ...], "_comment": ...}
    以 '_' 开头的 key 视为注释，跳过。
    变体值会经过 normalize_speaker 处理后再入字典（避免用户写带 furigana
    的形式时匹配失败）。

    返回空 dict 表示 path 为 None 或文件不存在。
    """
    if path is None:
        return {}
    p = Path(path)
    if not p.is_file():
        return {}

    data = json.loads(p.read_text(encoding="utf-8"))
    rev: dict[str, str] = {}
    for canonical, variants in data.items():
        if canonical.startswith("_"):
            continue
        if not isinstance(variants, list):
            continue
        for v in variants:
            if not isinstance(v, str):
                continue
            rev[normalize_speaker(v)] = canonical
    return rev


def to_canonical(speaker_norm: str | None,
                 alias_map: dict[str, str]) -> str | None:
    """variant → canonical；找不到返回 None。"""
    if speaker_norm is None:
        return None
    return alias_map.get(speaker_norm)


# ============================================================
# 自检
# ============================================================

if __name__ == "__main__":
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    # 单元测试若干关键函数
    print("=== normalize_speaker ===")
    cases = [
        ("酒寄(さかより)彩葉(いろは)", "酒寄彩葉"),
        ("配信:かぐや", "配信:かぐや"),
        ("\u200eNA(ナレーション)\u200e:\u200e月見(るなみ)\u200eヤチヨ",
         "NA:月見ヤチヨ"),
        ("FUSHI", "FUSHI"),
    ]
    for raw, expected in cases:
        got = normalize_speaker(raw)
        ok = "OK" if got == expected else "FAIL"
        print(f"  [{ok}] {raw!r} -> {got!r}  (expected {expected!r})")

    print("\n=== ass_time_to_seconds ===")
    for t, expected in [("0:00:26.02", 26.02), ("1:23:45.67", 5025.67)]:
        got = ass_time_to_seconds(t)
        ok = "OK" if abs(got - expected) < 1e-6 else "FAIL"
        print(f"  [{ok}] {t} -> {got}  (expected {expected})")

    print("\n=== extract_leading_speaker ===")
    for text, sp_expected in [
        ("(彩葉)オッケー", "彩葉"),
        ("‎(NA:ヤチヨ)今は昔", "NA:ヤチヨ"),
        ("‎-(先生)酒寄さん", "先生"),
        ("ふぁ... あ...", None),
    ]:
        sp, _ = extract_leading_speaker(text)
        ok = "OK" if sp == sp_expected else "FAIL"
        print(f"  [{ok}] {text!r} -> speaker={sp!r}")

    # 如果命令行给了字幕路径就解析它
    if len(sys.argv) > 1:
        entries = parse_subtitle(Path(sys.argv[1]))
        print(f"\n=== 解析 {sys.argv[1]} ===")
        from collections import Counter
        kc = Counter(e.kind for e in entries)
        print(f"总条数: {len(entries)}, 分类: {dict(kc)}")
        # 测试 aliases
        if len(sys.argv) > 2:
            amap = load_aliases(Path(sys.argv[2]))
            print(f"\n=== aliases ===")
            print(f"加载 {len(amap)} 条 variant -> canonical 映射")
            from collections import Counter
            canon_count: Counter[str] = Counter()
            unmapped: Counter[str] = Counter()
            for e in entries:
                for raw, norm, _txt in iter_speakers(e):
                    c = to_canonical(norm, amap)
                    if c:
                        canon_count[c] += 1
                    else:
                        unmapped[norm] += 1
            print("\n命中 canonical (前 15):")
            for k, v in canon_count.most_common(15):
                print(f"  {v:>5d}  {k}")
            print(f"\n未命中变体数: {len(unmapped)}（前 10）")
            for k, v in unmapped.most_common(10):
                print(f"  {v:>5d}  {k}")
