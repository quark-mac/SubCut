"""Plain SRT boundary: no speaker guessing, no silent repair or dropped blocks."""
import re
from pathlib import Path

from .errors import Problem
from .models import Entry, Source


STAMP = r"(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})"
TIMING = re.compile(rf"^{STAMP} --> {STAMP}$")


def milliseconds(parts):
    h, m, s, ms = map(int, parts)
    return ((h * 60 + m) * 60 + s) * 1000 + ms


def validate_entries(entries, duration_ms, speaker_ids):
    ids = set()
    for position, entry in enumerate(entries, 1):
        if not entry.id or entry.id in ids:
            raise Problem("字幕身份为空或重复", entry=position, field="id")
        ids.add(entry.id)
        if not entry.text.strip():
            raise Problem("字幕正文不能为空", entry=position, field="text")
        if not 0 <= entry.start_ms < entry.end_ms <= duration_ms:
            raise Problem("时间须满足 0 ≤ 开始 < 结束 ≤ 原片时长", entry=position, field="time")
        if entry.speaker_id not in speaker_ids:
            raise Problem("字幕引用了不存在的说话人", entry=position, field="speaker_id")


def read_plain_srt(path: Path, duration_ms: int, source_id: str, speaker_id: str):
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeError as exc:
        raise Problem("字幕须为 UTF-8 编码", field="subtitle_path") from exc
    if not text.strip():
        raise Problem("字幕文件为空", entry=1, field="text")
    # Only separator lines are removed; meaningful body whitespace/newlines survive.
    blocks = re.split(r"\n(?:[\t ]*\n)+", text.strip("\n"))
    entries = []
    for position, block in enumerate(blocks, 1):
        lines = block.split("\n")
        if not lines[0].strip().isdigit():
            raise Problem("SRT 序号须为非负整数", entry=position, field="index")
        match = TIMING.fullmatch(lines[1].strip()) if len(lines) > 1 else None
        if not match:
            raise Problem("时间格式应为 HH:MM:SS,mmm --> HH:MM:SS,mmm", entry=position, field="time")
        entries.append(Entry(
            start_ms=milliseconds(match.groups()[:4]),
            end_ms=milliseconds(match.groups()[4:]),
            text="\n".join(lines[2:]), speaker_id=speaker_id,
            sources=[Source(subtitle_id=source_id, index=int(lines[0].strip()))],
        ))
    validate_entries(entries, duration_ms, {speaker_id})
    return entries


def timestamp(ms: int) -> str:
    seconds, fraction = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02},{fraction:03}"


def write_plain_srt(entries) -> str:
    ordered = sorted(entries, key=lambda entry: (entry.start_ms, entry.end_ms))
    return "\n\n".join(
        f"{index}\n{timestamp(entry.start_ms)} --> {timestamp(entry.end_ms)}\n{entry.text}"
        for index, entry in enumerate(ordered, 1)
    ) + ("\n" if ordered else "")
