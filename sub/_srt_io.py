"""
_srt_io.py — 归一化中间字幕的 I/O 层（SRT + JSONL）。

服务调用方:
- sub/normalize.py:       生成 normalized.srt + normalized.jsonl
- sub/extract_simple.py:  消费 normalized.srt（P1.4 后）
- 用户:                   手编辑 SRT 修正 speaker / 文本 / 时间

格式契约（详见 sub/normalize_subtitle_design.md）:

  SRT 第三行起的内容主体格式:
    [<speaker>] {<TAG1>} {<TAG2>} <text-line-1>
    <text-line-2>
    ...

  - speaker ∈ {canonical-name / "?" / "NONSPEECH"}
  - tags ⊆ {MULTI, MERGED}，任意顺序，0~N 个
  - text 多行用真换行（ASS \\N 已展开）

  JSONL 每行一对象，含 source_entries 溯源；SRT 主体的 idx/start/end/
  speaker/tags/text 与 JSONL 同步。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path


# ============================================================
# 数据结构
# ============================================================

# 允许的 metadata tag 白名单
ALLOWED_TAGS: frozenset[str] = frozenset({"MULTI", "MERGED"})

# 特殊 speaker 字面量
SPEAKER_UNKNOWN = "?"
SPEAKER_NONSPEECH = "NONSPEECH"


@dataclass
class NormalizedEntry:
    """一条归一化字幕 = 1 角色 × 1 时间区间 × 1 段台词。"""
    idx: int                                  # 1-based，全局序号
    start: float                              # 秒
    end: float                                # 秒
    speaker: str                              # canonical / "?" / "NONSPEECH"
    tags: list[str] = field(default_factory=list)
    text: str = ""                            # 多行用真换行 \n
    source_entries: list[int] = field(default_factory=list)  # 0-based ASS entry 索引

    @property
    def duration(self) -> float:
        return self.end - self.start


# ============================================================
# 时间互转（SRT: HH:MM:SS,mmm）
# ============================================================

_SRT_TIME_RE = re.compile(r"^(\d{1,3}):(\d{2}):(\d{2}),(\d{3})$")


def seconds_to_srt_time(sec: float) -> str:
    """秒数 → 'HH:MM:SS,mmm'。负数夹到 0。"""
    if sec < 0:
        sec = 0.0
    # 加 0.5ms 抵消浮点累计误差，避免 26.0199999 → 26.019
    total_ms = int(round(sec * 1000))
    h, rem = divmod(total_ms, 3600 * 1000)
    m, rem = divmod(rem, 60 * 1000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def srt_time_to_seconds(t: str) -> float:
    """'HH:MM:SS,mmm' → 秒数。"""
    m = _SRT_TIME_RE.match(t.strip())
    if not m:
        raise ValueError(f"invalid SRT time: {t!r}")
    h, mi, s, ms = m.groups()
    return int(h) * 3600 + int(mi) * 60 + int(s) + int(ms) / 1000.0


# ============================================================
# SRT 主体（第三行起）的解析与渲染
# ============================================================

# 贪心匹配：[speaker] 后零或多个 {TAG}，剩余视为文本第一行
_HEAD_RE = re.compile(
    r"^\[(?P<speaker>[^\]]*)\]\s*"
    r"(?P<tags>(?:\{[^{}]*\}\s*)*)"
    r"(?P<text>.*)$"
)
_TAG_RE = re.compile(r"\{([^{}]*)\}")


def render_body(speaker: str, tags: list[str], text: str) -> str:
    """渲染 SRT 第三行起的文本块。多行 text 保留真换行。"""
    parts = [f"[{speaker}]"]
    for tag in tags:
        parts.append("{" + tag + "}")
    head = " ".join(parts)
    if text == "":
        return head
    # 多行 text: 第一行紧跟 head，其余行各占一行
    lines = text.split("\n")
    first = lines[0]
    rest = lines[1:]
    if first:
        head = head + " " + first
    if rest:
        return head + "\n" + "\n".join(rest)
    return head


def parse_body(body_lines: list[str]) -> tuple[str, list[str], str]:
    """SRT 第三行起的若干行 → (speaker, tags, text)。"""
    if not body_lines:
        raise ValueError("empty body")
    first = body_lines[0]
    m = _HEAD_RE.match(first)
    if not m:
        raise ValueError(f"body head doesn't match [speaker] format: {first!r}")
    speaker = m.group("speaker").strip()
    tags = [t.strip() for t in _TAG_RE.findall(m.group("tags"))]
    text_first = m.group("text").lstrip()  # 去掉 head 与 text 之间的分隔空格
    rest = body_lines[1:]
    if rest:
        text = text_first + "\n" + "\n".join(rest) if text_first else "\n".join(rest)
    else:
        text = text_first
    return speaker, tags, text


# ============================================================
# SRT 文件级 I/O
# ============================================================

def write_srt(entries: list[NormalizedEntry], path: Path) -> None:
    """写 SRT。块间以单空行分隔，文件以单换行结尾。UTF-8（无 BOM）。"""
    blocks: list[str] = []
    for e in entries:
        block = (
            f"{e.idx}\n"
            f"{seconds_to_srt_time(e.start)} --> {seconds_to_srt_time(e.end)}\n"
            f"{render_body(e.speaker, e.tags, e.text)}"
        )
        blocks.append(block)
    Path(path).write_text("\n\n".join(blocks) + "\n", encoding="utf-8")


_TIME_LINE_RE = re.compile(
    r"^(?P<start>\d{1,3}:\d{2}:\d{2},\d{3})\s*-->\s*(?P<end>\d{1,3}:\d{2}:\d{2},\d{3})"
)


def parse_srt(path: Path) -> list[NormalizedEntry]:
    """解析归一化 SRT，返回 NormalizedEntry 列表。

    source_entries 字段不在 SRT 中，置为空列表。
    """
    text = Path(path).read_text(encoding="utf-8-sig")
    # 统一换行
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # 按空行分块（一个或多个连续 \n）
    raw_blocks = re.split(r"\n\s*\n", text.strip("\n"))
    entries: list[NormalizedEntry] = []
    for block in raw_blocks:
        if not block.strip():
            continue
        lines = block.split("\n")
        if len(lines) < 3:
            raise ValueError(f"SRT block too short: {block!r}")
        # line 0: idx
        try:
            idx = int(lines[0].strip())
        except ValueError as exc:
            raise ValueError(f"SRT block idx not int: {lines[0]!r}") from exc
        # line 1: time
        tm = _TIME_LINE_RE.match(lines[1])
        if not tm:
            raise ValueError(f"SRT time line invalid: {lines[1]!r}")
        start = srt_time_to_seconds(tm.group("start"))
        end = srt_time_to_seconds(tm.group("end"))
        # line 2+: body
        speaker, tags, body_text = parse_body(lines[2:])
        entries.append(NormalizedEntry(
            idx=idx, start=start, end=end,
            speaker=speaker, tags=tags, text=body_text,
            source_entries=[],
        ))
    return entries


# ============================================================
# JSONL 文件级 I/O
# ============================================================

def write_jsonl(entries: list[NormalizedEntry], path: Path) -> None:
    """写 JSONL。每行一个 entry 对象，UTF-8，ensure_ascii=False。

    时间字段保留 3 位小数。
    """
    lines: list[str] = []
    for e in entries:
        obj = {
            "idx": e.idx,
            "start": round(e.start, 3),
            "end": round(e.end, 3),
            "speaker": e.speaker,
            "tags": list(e.tags),
            "text": e.text,
            "source_entries": list(e.source_entries),
        }
        lines.append(json.dumps(obj, ensure_ascii=False))
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_jsonl(path: Path) -> list[NormalizedEntry]:
    """解析 JSONL → list[NormalizedEntry]。"""
    raw = Path(path).read_text(encoding="utf-8-sig")
    entries: list[NormalizedEntry] = []
    for ln_no, line in enumerate(raw.splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSONL line {ln_no} invalid: {exc}") from exc
        entries.append(NormalizedEntry(
            idx=int(obj["idx"]),
            start=float(obj["start"]),
            end=float(obj["end"]),
            speaker=str(obj["speaker"]),
            tags=list(obj.get("tags", [])),
            text=str(obj.get("text", "")),
            source_entries=list(obj.get("source_entries", [])),
        ))
    return entries


# ============================================================
# 自检
# ============================================================

def _entries_equal_ignore_source(
    a: list[NormalizedEntry], b: list[NormalizedEntry]
) -> bool:
    """比较两组 entry 除 source_entries 外是否一致。"""
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if x.idx != y.idx:
            return False
        if abs(x.start - y.start) > 5e-4 or abs(x.end - y.end) > 5e-4:
            return False
        if x.speaker != y.speaker:
            return False
        if list(x.tags) != list(y.tags):
            return False
        if x.text != y.text:
            return False
    return True


def _selftest() -> int:
    """自检：核心函数 + 幂等性往返。返回失败数。"""
    fails = 0

    def check(label: str, ok: bool, detail: str = "") -> None:
        nonlocal fails
        tag = "OK  " if ok else "FAIL"
        print(f"  [{tag}] {label}" + (f"  -- {detail}" if detail and not ok else ""))
        if not ok:
            fails += 1

    print("=== seconds <-> srt_time roundtrip ===")
    for sec in [0.0, 0.001, 26.02, 27.9, 3661.234, 5025.67]:
        s = seconds_to_srt_time(sec)
        back = srt_time_to_seconds(s)
        check(f"{sec} -> {s} -> {back}", abs(back - sec) < 1e-3)

    print("\n=== render_body / parse_body roundtrip ===")
    cases = [
        ("Iroha", [], "うぅ~"),
        ("Kaguya", ["MULTI"], "だってつまんないんだもん"),
        ("Yachiyo", ["MULTI", "MERGED"], "今は昔 / その後\n二行目"),
        ("?", [], "..."),
        ("NONSPEECH", [], "(琵琶の音)"),
        ("Iroha", [], ""),  # 空文本边界
        ("Iroha", ["MERGED"], "a / b"),
    ]
    for sp, tags, txt in cases:
        body = render_body(sp, tags, txt)
        sp2, tags2, txt2 = parse_body(body.split("\n"))
        ok = sp2 == sp and tags2 == tags and txt2 == txt
        check(f"speaker={sp!r} tags={tags} text={txt!r}", ok,
              f"got speaker={sp2!r} tags={tags2} text={txt2!r}")

    print("\n=== full SRT/JSONL file roundtrip ===")
    sample = [
        NormalizedEntry(1, 26.02, 27.9, "Yachiyo", [], "今は昔", [0]),
        NormalizedEntry(2, 60.123, 63.456, "Iroha", ["MULTI"], "うぅ~", [410]),
        NormalizedEntry(3, 60.123, 63.456, "Kaguya", ["MULTI"],
                        "だって\nつまんないんだもん", [410]),
        NormalizedEntry(4, 100.0, 105.0, "Kaguya", ["MULTI", "MERGED"],
                        "first / second", [411, 412]),
        NormalizedEntry(5, 200.5, 201.0, "?", [], "ふぁ... あ...", []),
        NormalizedEntry(6, 300.0, 302.5, "NONSPEECH", [], "(琵琶の音)", [800]),
    ]

    import tempfile
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        srt_path = td_path / "test.srt"
        jsonl_path = td_path / "test.jsonl"

        write_srt(sample, srt_path)
        parsed_srt = parse_srt(srt_path)
        check("SRT roundtrip (ignore source_entries)",
              _entries_equal_ignore_source(sample, parsed_srt),
              f"len {len(sample)} -> {len(parsed_srt)}")

        write_jsonl(sample, jsonl_path)
        parsed_jsonl = parse_jsonl(jsonl_path)
        full_eq = (
            len(sample) == len(parsed_jsonl)
            and all(
                a.idx == b.idx
                and abs(a.start - b.start) < 1e-3
                and abs(a.end - b.end) < 1e-3
                and a.speaker == b.speaker
                and a.tags == b.tags
                and a.text == b.text
                and a.source_entries == b.source_entries
                for a, b in zip(sample, parsed_jsonl)
            )
        )
        check("JSONL roundtrip (full)", full_eq)

        # 双向幂等：写一次 → 读 → 再写 → 内容字节一致
        write_srt(parsed_srt, srt_path)
        parsed_srt_2 = parse_srt(srt_path)
        check("SRT idempotent (parse->write->parse)",
              _entries_equal_ignore_source(parsed_srt, parsed_srt_2))

    print(f"\n{'=' * 40}")
    print(f"FAILS: {fails}" if fails else "ALL PASS")
    return fails


if __name__ == "__main__":
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(_selftest())
