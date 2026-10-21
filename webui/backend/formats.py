"""Explicit subtitle exchange boundary; never infer a format from body text."""
import re
import json
import math
import hashlib
from pathlib import Path

from .errors import Problem
from .models import Entry, Source, Speaker
from .speaker_colors import next_color, SPECIAL_COLORS


STAMP = r"([0-9]{1,3}):([0-5][0-9]):([0-5][0-9]),([0-9]{3})"
TIMING = re.compile(rf"^{STAMP}[ \t]*-->[ \t]*{STAMP}$")


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


def validate_sources(entries, sources):
    ids = set()
    for source in sources:
        if not source.id.strip() or source.id in ids or not source.path.strip():
            raise Problem("来源身份须非空且唯一，路径不能为空", field="subtitle_sources")
        ids.add(source.id)
    by_id = {s.id: s for s in sources}
    for position, entry in enumerate(entries, 1):
        for source in entry.sources:
            if source.subtitle_id not in ids:
                raise Problem("字幕引用了不存在的来源", entry=position, field="sources")
            format = by_id[source.subtitle_id].format
            if source.index is not None and source.index < 0 or any(i < 0 for i in source.source_entries):
                raise Problem("来源索引不能为负数", entry=position, field="sources")
            if source.source_entries and format != "normalized-jsonl":
                raise Problem("原来源索引只能来自 normalized JSONL", entry=position, field="sources.source_entries")
            if source.moss_id is not None and (format != "moss-json" or not source.moss_id.strip()):
                raise Problem("MOSS 段 ID 须来自 MOSS JSON 且非空", entry=position, field="sources.moss_id")


def read_subtitles(path: Path, duration_ms: int, source_id: str, format: str, expected_fingerprint=None):
    raw = path.read_bytes()
    fingerprint = hashlib.sha256(f"{path}\n{format}\n{duration_ms}\n".encode("utf-8") + raw).hexdigest()
    if expected_fingerprint is not None and expected_fingerprint != fingerprint:
        raise Problem("字幕来源或解释方式已变化，请重新解析预览", status=409, code="source_changed", field="subtitle_path")
    try:
        text = raw.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    except UnicodeError as exc:
        raise Problem("字幕须为 UTF-8 编码", field="subtitle_path") from exc
    if not text.strip():
        raise Problem("字幕文件为空", entry=1, field="text")
    if format in {"normalized-jsonl", "moss-json"}:
        entries, speakers = read_structured(text, duration_ms, source_id, format)
        return entries, speakers, fingerprint
    # Only separator lines are removed; meaningful body whitespace/newlines survive.
    blocks = re.split(r"\n(?:[\t ]*\n)+", text.strip("\n"))
    entries = []
    labels = []
    for position, block in enumerate(blocks, 1):
        lines = block.split("\n")
        if not re.fullmatch(r"[0-9]+", lines[0].strip()):
            raise Problem("SRT 序号须为非负整数", entry=position, field="index")
        try:
            input_index = int(lines[0].strip())
        except ValueError as exc:
            raise Problem("SRT 序号超出整数解析范围", entry=position, field="index") from exc
        match = TIMING.fullmatch(lines[1].strip()) if len(lines) > 1 else None
        if not match:
            raise Problem("时间格式应为 HH:MM:SS,mmm --> HH:MM:SS,mmm", entry=position, field="time")
        body = "\n".join(lines[2:])
        label, tags = "?", []
        if format == "speaker-srt":
            head = re.match(r"^\[([^\]\n]+)\][ \t]*", body)
            if not head or not head[1].strip():
                raise Problem("须以 [说话人] 开头；普通正文请选普通 SRT", entry=position, field="speaker")
            label, body = head[1].strip(), body[head.end():]
            # Unknown braces and everything after them remain body, including known-looking tags.
            while tag := re.match(r"^\{(MULTI|MERGED)\}[ \t]*", body):
                tags.append(tag[1])
                body = body[tag.end():]
            body = body.removeprefix("\n")
        elif format == "moss-srt":
            head = re.match(r"^([^\n:]+): ", body)
            if not head or not head[1].strip():
                raise Problem("须以说话人和 ASCII 冒号空格开头（S00: 正文）", entry=position, field="speaker")
            label, body = head[1].strip(), body[head.end():]
        labels.append(label)
        entries.append(Entry(
            start_ms=milliseconds(match.groups()[:4]),
            end_ms=milliseconds(match.groups()[4:]),
            text=body, speaker_id=label, tags=tags,
            sources=[Source(subtitle_id=source_id, index=input_index)],
        ))
    speakers = build_speakers(entries, labels)
    validate_entries(entries, duration_ms, {s.id for s in speakers})
    return entries, speakers, fingerprint


def build_speakers(entries, labels):
    names = list(dict.fromkeys(label for label in labels if label not in {"?", "NONSPEECH"})) + ["?", "NONSPEECH"]
    speakers = []
    for index, label in enumerate(names):
        color = SPECIAL_COLORS[label] if label in SPECIAL_COLORS else next_color(s.color for s in speakers)
        speakers.append(Speaker(label=label, color=color, order=index))
    by_label = {s.label: s.id for s in speakers}
    for entry, label in zip(entries, labels):
        entry.speaker_id = by_label[label]
    return speakers


def read_structured(text, duration_ms, source_id, format):
    def decode(raw, position):
        try:
            return json.loads(raw)
        except (ValueError, RecursionError) as exc:
            raise Problem(f"JSON 语法无效：{exc}", entry=position, field="json") from exc

    if format == "normalized-jsonl":
        rows = [(line, decode(raw, line)) for line, raw in enumerate(text.splitlines(), 1) if raw.strip()]
    else:
        values = decode(text, None)
        if not isinstance(values, list):
            raise Problem("MOSS JSON 须为顶层字幕数组", field="json")
        rows = list(enumerate(values, 1))
    if not rows:
        raise Problem("字幕文件为空", entry=1, field="text")
    entries, labels = [], []
    for position, row in rows:
        def fail(field, message):
            raise Problem(message, entry=position, field=field)

        if not isinstance(row, dict):
            fail("json", "条目须为 JSON 对象")
        for field in ("speaker", "text"):
            if not isinstance(row.get(field), str) or not row[field].strip():
                fail(field, "须为非空字符串")
        if row["speaker"] != row["speaker"].strip():
            fail("speaker", "人物标签不能含首尾空白")
        for field in ("start", "end"):
            value = row.get(field)
            try:
                finite = type(value) in (int, float) and math.isfinite(value)
            except OverflowError:
                finite = False
            if not finite:
                fail(field, "时间须为有限的秒制数字")
        if not 0 <= row["start"] < row["end"] <= duration_ms / 1000:
            fail("time", "秒制时间须满足 0 ≤ 开始 < 结束 ≤ 原片时长")
        start, end = round(row["start"] * 1000), round(row["end"] * 1000)
        if start >= end:
            fail("time", "换算为整数毫秒后时长为零")
        source = Source(subtitle_id=source_id)
        tags = []
        if format == "normalized-jsonl":
            if type(row.get("idx")) is not int or row["idx"] < 1:
                fail("idx", "字幕输入序号须为正整数")
            tags, indices = row.get("tags", []), row.get("source_entries", [])
            if not isinstance(tags, list) or any(not isinstance(tag, str) or not tag.strip() for tag in tags):
                fail("tags", "元标签须为非空字符串数组")
            if not isinstance(indices, list) or any(type(index) is not int or index < 0 for index in indices):
                fail("source_entries", "原来源索引须为非负整数数组")
            source.index, source.source_entries = row["idx"], indices
        else:
            if not isinstance(row.get("id"), str) or not row["id"].strip():
                fail("id", "MOSS 段 ID 须为非空字符串")
            source.moss_id = row["id"]
        entries.append(Entry(start_ms=start, end_ms=end, text=row["text"], speaker_id=row["speaker"], tags=tags, sources=[source]))
        labels.append(row["speaker"])
    speakers = build_speakers(entries, labels)
    validate_entries(entries, duration_ms, {s.id for s in speakers})
    return entries, speakers


def timestamp(ms: int) -> str:
    seconds, fraction = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02},{fraction:03}"


EXPORT_TYPES = {
    "plain-srt": ("srt", "application/x-subrip"),
    "speaker-srt": ("srt", "application/x-subrip"),
    "normalized-jsonl": ("jsonl", "application/x-ndjson"),
    "moss-json": ("json", "application/json"),
}


def write_subtitles(project, format, keep_tags=False) -> str:
    visible = {s.id for s in project.speakers if s.visible}
    ordered = sorted((entry for entry in project.entries if entry.speaker_id in visible), key=lambda entry: (entry.start_ms, entry.end_ms))
    labels = {s.id: s.label for s in project.speakers}
    rows = []
    for index, entry in enumerate(ordered, 1):
        label = labels[entry.speaker_id]
        if format == "moss-json":
            rows.append(dict(id=entry.id, start=entry.start_ms / 1000, end=entry.end_ms / 1000, speaker=label, text=entry.text))
        elif format == "normalized-jsonl":
            row = dict(idx=index, start=entry.start_ms / 1000, end=entry.end_ms / 1000, speaker=label,
                       tags=entry.tags, text=entry.text, source_entries=[i for source in entry.sources for i in source.source_entries])
            rows.append(json.dumps(row, ensure_ascii=False))
        else:
            # Blank/whitespace-only lines delimit SRT cues (including after CR/LF
            # normalization). Inspect without rewriting the project's real body.
            # Edge blank lines also disappear or become cue separators on import.
            lines = entry.text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
            if any(not line.strip() for line in lines):
                raise Problem("正文含空白行（包括首尾空行），SRT 会将其视为条目分隔或丢失换行；请使用 JSONL 保留完整正文",
                              entry=index, field="text")
            if format == "speaker-srt" and any(c in label for c in "]\r\n"):
                raise Problem("此人物标签含 SRT 前缀无法表达的字符，请使用 JSONL 或 MOSS JSON", entry=index, field="speaker")
            prefix = f"[{label}] " if format == "speaker-srt" else ""
            if keep_tags:
                if any(any(c in tag for c in "{}\r\n") for tag in entry.tags):
                    raise Problem("元标签含 SRT 无法表达的字符，请使用 JSONL", entry=index, field="tags")
                prefix += "".join(f"{{{tag}}} " for tag in entry.tags)
            rows.append(f"{index}\n{timestamp(entry.start_ms)} --> {timestamp(entry.end_ms)}\n{prefix}{entry.text}")
    if format == "moss-json":
        return json.dumps(rows, ensure_ascii=False, indent=2) + "\n"
    return ("\n" if format == "normalized-jsonl" else "\n\n").join(rows) + ("\n" if rows else "")
