"""Extract and normalize reviewed text subtitle tracks from MKV files.

The command is intentionally staged:

    inspect   Probe the MKV, extract supported text tracks, and write a report.
    prepare   Apply a reviewed JSON policy to one extracted ASS track.
    normalize Convert prepared dialogue events to Gemini-compatible normalized files.

See docs/design/mkv_subtitle_editing.md for the editing contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sub._srt_io import (  # noqa: E402
    ALLOWED_TAGS,
    NormalizedEntry,
    parse_jsonl,
    parse_srt,
    write_jsonl,
    write_srt,
)


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


SCHEMA_VERSION = 1
TEXT_CODECS = {"ass": ".ass", "ssa": ".ssa", "subrip": ".srt"}
PREPARE_CODECS = {"ass", "ssa"}
POLICY_ACTIONS = {
    "keep_dialogue",
    "drop_translation",
    "drop_lyrics",
    "drop_screen",
    "drop_annotation",
    "drop_title",
    "drop_staff",
    "drop_comment",
    "review",
}
_ASS_OVERRIDE_RE = re.compile(r"\{[^}]*\}")
_ASS_DRAWING_RE = re.compile(r"\\p(?:bo)?[1-9]", re.IGNORECASE)
_ASS_POSITION_RE = re.compile(r"\\(?:pos|move)\(", re.IGNORECASE)
_ASS_KARAOKE_RE = re.compile(r"\\k[fo]?\d", re.IGNORECASE)
_ASS_TOP_RE = re.compile(r"\\an[789](?:\D|$)", re.IGNORECASE)


@dataclass
class AssEvent:
    source_event_index: int
    line_number: int
    event_type: str
    layer: str
    start_raw: str
    end_raw: str
    start: float
    end: float
    style: str
    name: str
    margin_l: str
    margin_r: str
    margin_v: str
    effect: str
    text_raw: str


def _json_dump(data: Any, path: Path) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _jsonl_dump(rows: list[dict[str, Any]], path: Path) -> None:
    text = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
    path.write_text(text + ("\n" if rows else ""), encoding="utf-8")


def _jsonl_load(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"JSONL line {line_number} is not an object: {path}")
        rows.append(value)
    return rows


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _require_new_directory(path: Path) -> Path:
    path = path.resolve()
    if path.exists() and any(path.iterdir()):
        raise FileExistsError(f"output directory is not empty: {path}")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _find_tool(name: str, explicit: Path | None) -> Path:
    if explicit is not None:
        path = explicit.resolve()
        if not path.is_file():
            raise FileNotFoundError(f"{name} not found: {path}")
        return path
    candidates = [
        _REPO_ROOT / "env" / "Library" / "bin" / f"{name}.exe",
        _REPO_ROOT / "env" / "ffmpeg-nvenc" / "bin" / f"{name}.exe",
    ]
    discovered = shutil.which(name)
    if discovered:
        candidates.append(Path(discovered))
    for path in candidates:
        if path.is_file():
            return path.resolve()
    raise FileNotFoundError(f"cannot find {name}; use --{name}")


def _run(command: list[str], *, capture: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        check=False,
        capture_output=capture,
        text=True,
        encoding="utf-8",
        errors="strict",
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() if result.stderr else ""
        raise RuntimeError(f"command failed ({result.returncode}): {' '.join(command)}\n{stderr}")
    return result


def _tool_version(path: Path) -> str:
    result = _run([str(path), "-version"])
    return result.stdout.splitlines()[0].strip() if result.stdout else "unknown"


def _probe_mkv(ffprobe: Path, mkv: Path) -> dict[str, Any]:
    result = _run(
        [str(ffprobe), "-v", "error", "-show_format", "-show_streams", "-of", "json", str(mkv)]
    )
    value = json.loads(result.stdout)
    if not isinstance(value, dict):
        raise ValueError("ffprobe output is not an object")
    return value


def _ass_time_to_seconds(value: str) -> float:
    hours, minutes, rest = value.strip().split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(rest)


def _parse_ass(path: Path) -> tuple[list[dict[str, str]], list[AssEvent]]:
    raw = path.read_text(encoding="utf-8-sig", errors="strict")
    if "\ufffd" in raw:
        raise ValueError(f"replacement character found in extracted subtitle: {path}")

    section = ""
    style_format: list[str] = []
    event_format: list[str] = []
    styles: list[dict[str, str]] = []
    events: list[AssEvent] = []
    source_event_index = 0

    for line_number, line in enumerate(raw.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped.casefold()
            continue
        if section in {"[v4+ styles]", "[v4 styles]"}:
            if line.startswith("Format:"):
                style_format = [part.strip() for part in line.split(":", 1)[1].split(",")]
            elif line.startswith("Style:") and style_format:
                values = [part.strip() for part in line.split(":", 1)[1].split(",")]
                if len(values) != len(style_format):
                    raise ValueError(f"invalid Style field count at {path}:{line_number}")
                styles.append(dict(zip(style_format, values)))
            continue
        if section != "[events]":
            continue
        if line.startswith("Format:"):
            event_format = [part.strip() for part in line.split(":", 1)[1].split(",")]
            continue
        match = re.match(r"^(Dialogue|Comment):\s*(.*)$", line)
        if not match:
            continue
        if not event_format:
            raise ValueError(f"event before Format at {path}:{line_number}")
        values = match.group(2).split(",", len(event_format) - 1)
        if len(values) != len(event_format):
            raise ValueError(f"invalid event field count at {path}:{line_number}")
        fields = {key.casefold(): value.strip() for key, value in zip(event_format, values)}
        try:
            start_raw = fields["start"]
            end_raw = fields["end"]
            start = _ass_time_to_seconds(start_raw)
            end = _ass_time_to_seconds(end_raw)
        except (KeyError, ValueError) as exc:
            raise ValueError(f"invalid event time at {path}:{line_number}") from exc
        events.append(
            AssEvent(
                source_event_index=source_event_index,
                line_number=line_number,
                event_type=match.group(1),
                layer=fields.get("layer", fields.get("marked", "")),
                start_raw=start_raw,
                end_raw=end_raw,
                start=start,
                end=end,
                style=fields.get("style", ""),
                name=fields.get("name", ""),
                margin_l=fields.get("marginl", ""),
                margin_r=fields.get("marginr", ""),
                margin_v=fields.get("marginv", ""),
                effect=fields.get("effect", ""),
                text_raw=fields.get("text", ""),
            )
        )
        source_event_index += 1
    return styles, events


def _visible_ass_text(text: str) -> str:
    visible = _ASS_OVERRIDE_RE.sub("", text)
    visible = visible.replace("\\N", "\n").replace("\\n", "\n")
    visible = visible.replace("\\h", " ")
    lines = [line.strip() for line in visible.splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _profile_ass(path: Path) -> dict[str, Any]:
    styles, events = _parse_ass(path)
    by_style: dict[str, list[AssEvent]] = {}
    for event in events:
        by_style.setdefault(event.style, []).append(event)
    profiles: dict[str, Any] = {}
    for style, items in sorted(by_style.items()):
        sample_indexes = sorted({0, len(items) // 2, len(items) - 1})
        profiles[style] = {
            "count": len(items),
            "event_types": dict(Counter(event.event_type for event in items)),
            "layers": dict(Counter(event.layer for event in items)),
            "names": dict(Counter(event.name for event in items if event.name)),
            "positioned": sum(bool(_ASS_POSITION_RE.search(event.text_raw)) for event in items),
            "drawings": sum(bool(_ASS_DRAWING_RE.search(event.text_raw)) for event in items),
            "karaoke": sum(bool(_ASS_KARAOKE_RE.search(event.text_raw)) for event in items),
            "top_override": sum(bool(_ASS_TOP_RE.search(event.text_raw)) for event in items),
            "samples": [
                {
                    "source_event_index": items[index].source_event_index,
                    "start": items[index].start_raw,
                    "text": _visible_ass_text(items[index].text_raw)[:240],
                }
                for index in sample_indexes
            ],
        }
    return {
        "styles_defined": styles,
        "event_count": len(events),
        "event_types": dict(Counter(event.event_type for event in events)),
        "styles": profiles,
    }


def _extract_stream(ffmpeg: Path, mkv: Path, stream_index: int, codec: str, output: Path) -> list[str]:
    command = [
        str(ffmpeg),
        "-v",
        "error",
        "-y",
        "-i",
        str(mkv),
        "-map",
        f"0:{stream_index}",
        "-c:s",
        "copy",
        str(output),
    ]
    _run(command)
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError(f"subtitle extraction produced no data: stream {stream_index}")
    if codec in PREPARE_CODECS:
        raw = output.read_text(encoding="utf-8-sig", errors="strict")
        if "\ufffd" in raw:
            raise ValueError(f"replacement character found in stream {stream_index}")
    return command


def _stream_record(stream: dict[str, Any], subtitle_index: int) -> dict[str, Any]:
    tags = stream.get("tags") if isinstance(stream.get("tags"), dict) else {}
    disposition = stream.get("disposition") if isinstance(stream.get("disposition"), dict) else {}
    return {
        "stream_index": int(stream["index"]),
        "subtitle_index": subtitle_index,
        "codec_name": str(stream.get("codec_name", "")),
        "codec_long_name": str(stream.get("codec_long_name", "")),
        "language": str(tags.get("language", "")),
        "title": str(tags.get("title", "")),
        "disposition": disposition,
        "start_time": stream.get("start_time"),
        "duration": stream.get("duration"),
    }


def _inspect_report(manifest: dict[str, Any]) -> str:
    lines = [
        "# MKV Subtitle Inspection",
        "",
        f"- Input: `{manifest['input']['path']}`",
        f"- SHA-256: `{manifest['input']['sha256']}`",
        f"- Subtitle streams: {len(manifest['subtitle_streams'])}",
        "",
        "| stream | subtitle | codec | language | title | default | extracted | events |",
        "|---:|---:|---|---|---|---:|---|---:|",
    ]
    for stream in manifest["subtitle_streams"]:
        extraction = stream.get("extraction") or {}
        analysis = stream.get("analysis") or {}
        lines.append(
            f"| {stream['stream_index']} | {stream['subtitle_index']} | {stream['codec_name']} | "
            f"{stream['language'] or '-'} | {stream['title'] or '-'} | "
            f"{int(bool(stream['disposition'].get('default')))} | "
            f"{extraction.get('path', '-')} | {analysis.get('event_count', '-')} |"
        )
    for stream in manifest["subtitle_streams"]:
        analysis = stream.get("analysis")
        if not analysis:
            continue
        lines.extend(["", f"## Stream {stream['stream_index']}: {stream['title'] or '(untitled)'}", ""])
        lines.extend(
            [
                "| style | count | positioned | drawings | karaoke | top override |",
                "|---|---:|---:|---:|---:|---:|",
            ]
        )
        for style, profile in analysis["styles"].items():
            lines.append(
                f"| {style or '(empty)'} | {profile['count']} | {profile['positioned']} | "
                f"{profile['drawings']} | {profile['karaoke']} | {profile['top_override']} |"
            )
        lines.extend(["", "Representative samples:", ""])
        for style, profile in analysis["styles"].items():
            lines.append(f"### `{style or '(empty)'}`")
            lines.append("")
            for sample in profile["samples"]:
                text = sample["text"].replace("\n", " / ")
                lines.append(f"- `{sample['start']}` source `{sample['source_event_index']}`: {text}")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def inspect_command(args: argparse.Namespace) -> int:
    mkv = args.input.resolve()
    if not mkv.is_file():
        raise FileNotFoundError(f"MKV not found: {mkv}")
    output_dir = _require_new_directory(args.output_dir)
    streams_dir = output_dir / "streams"
    streams_dir.mkdir()
    ffprobe = _find_tool("ffprobe", args.ffprobe)
    ffmpeg = _find_tool("ffmpeg", args.ffmpeg)
    probe = _probe_mkv(ffprobe, mkv)
    subtitle_streams = [s for s in probe.get("streams", []) if s.get("codec_type") == "subtitle"]

    records: list[dict[str, Any]] = []
    for subtitle_index, stream in enumerate(subtitle_streams):
        record = _stream_record(stream, subtitle_index)
        codec = record["codec_name"]
        extension = TEXT_CODECS.get(codec)
        if extension is None:
            record["support"] = "inspect_only"
            record["extraction"] = None
            record["analysis"] = None
            records.append(record)
            continue
        extracted = streams_dir / f"stream_{record['stream_index']:03d}_{record['title'] or 'untitled'}{extension}"
        command = _extract_stream(ffmpeg, mkv, record["stream_index"], codec, extracted)
        record["support"] = "prepare" if codec in PREPARE_CODECS else "extracted_only"
        record["extraction"] = {
            "path": str(extracted.relative_to(output_dir)).replace("\\", "/"),
            "size": extracted.stat().st_size,
            "sha256": _sha256(extracted),
            "command": command,
        }
        record["analysis"] = _profile_ass(extracted) if codec in PREPARE_CODECS else None
        records.append(record)

    format_info = probe.get("format") if isinstance(probe.get("format"), dict) else {}
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "stage": "inspect",
        "input": {
            "path": str(mkv),
            "size": mkv.stat().st_size,
            "sha256": _sha256(mkv),
        },
        "container": {
            "format_name": format_info.get("format_name"),
            "duration": format_info.get("duration"),
            "start_time": format_info.get("start_time"),
        },
        "tools": {
            "ffprobe": {"path": str(ffprobe), "version": _tool_version(ffprobe)},
            "ffmpeg": {"path": str(ffmpeg), "version": _tool_version(ffmpeg)},
        },
        "subtitle_streams": records,
    }
    _json_dump(manifest, output_dir / "manifest.json")
    (output_dir / "report.md").write_text(_inspect_report(manifest), encoding="utf-8")
    print(f"Inspected {len(records)} subtitle streams -> {output_dir}")
    for stream in records:
        count = (stream.get("analysis") or {}).get("event_count", "-")
        print(
            f"  stream={stream['stream_index']} codec={stream['codec_name']} "
            f"title={stream['title'] or '-'} support={stream['support']} events={count}"
        )
    return 0


def _load_manifest(path: Path) -> tuple[dict[str, Any], Path]:
    path = path.resolve()
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"unsupported manifest: {path}")
    return value, path.parent


def _load_policy(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"unsupported policy: {path}")
    styles = value.get("styles")
    if not isinstance(styles, dict) or not styles:
        raise ValueError("policy.styles must be a non-empty object")
    invalid = {str(action) for action in styles.values()} - POLICY_ACTIONS
    if invalid:
        raise ValueError(f"invalid policy actions: {sorted(invalid)}")
    if value.get("unknown_style") != "error":
        raise ValueError("unknown_style must be 'error' in production preparation")
    return value


def _selected_stream(manifest: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    source = policy.get("source")
    if not isinstance(source, dict):
        raise ValueError("policy.source must be an object")
    stream_index = int(source["stream_index"])
    matches = [s for s in manifest["subtitle_streams"] if s["stream_index"] == stream_index]
    if len(matches) != 1:
        raise ValueError(f"policy stream index not found exactly once: {stream_index}")
    stream = matches[0]
    for policy_key, stream_key in (("expected_codec", "codec_name"), ("expected_title", "title")):
        expected = source.get(policy_key)
        if expected is not None and str(expected) != str(stream.get(stream_key, "")):
            raise ValueError(
                f"stream {stream_key} mismatch: expected {expected!r}, got {stream.get(stream_key)!r}"
            )
    if stream["codec_name"] not in PREPARE_CODECS:
        raise ValueError(f"prepare does not support codec: {stream['codec_name']}")
    return stream


def prepare_command(args: argparse.Namespace) -> int:
    manifest, manifest_dir = _load_manifest(args.manifest)
    policy_path = args.policy.resolve()
    policy = _load_policy(policy_path)
    stream = _selected_stream(manifest, policy)
    output_dir = _require_new_directory(args.output_dir)
    mkv = Path(manifest["input"]["path"])
    if not mkv.is_file() or _sha256(mkv) != manifest["input"]["sha256"]:
        raise ValueError("input MKV is missing or its hash differs from the manifest")
    extraction = stream.get("extraction")
    if not isinstance(extraction, dict):
        raise ValueError("selected stream has no extraction record")
    extracted = manifest_dir / extraction["path"]
    if not extracted.is_file() or _sha256(extracted) != extraction["sha256"]:
        raise ValueError("extracted subtitle is missing or its hash differs from the manifest")

    _styles, events = _parse_ass(extracted)
    observed_styles = {event.style for event in events if event.event_type == "Dialogue"}
    policy_styles = set(policy["styles"])
    unknown_styles = sorted(observed_styles - policy_styles)
    stale_styles = sorted(policy_styles - observed_styles)
    if unknown_styles:
        raise ValueError(f"unknown styles require review: {unknown_styles}")
    if stale_styles:
        raise ValueError(f"policy contains styles not present in this track: {stale_styles}")

    event_type_policy = policy.get("event_types", {})
    prepared: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    action_counts: Counter[str] = Counter()
    review_count = 0
    for event in events:
        if event.event_type != "Dialogue":
            action = str(event_type_policy.get(event.event_type, "review"))
        else:
            action = str(policy["styles"][event.style])
        if action not in POLICY_ACTIONS:
            raise ValueError(f"invalid action {action!r} for source event {event.source_event_index}")
        action_counts[action] += 1
        if action == "review":
            review_count += 1
        visible_text = _visible_ass_text(event.text_raw)
        action_row = {
            "source_event_index": event.source_event_index,
            "line_number": event.line_number,
            "event_type": event.event_type,
            "style": event.style,
            "start": round(event.start, 3),
            "end": round(event.end, 3),
            "action": action,
            "text": visible_text,
        }
        actions.append(action_row)
        if action != "keep_dialogue":
            continue
        if _ASS_DRAWING_RE.search(event.text_raw):
            raise ValueError(f"kept event contains ASS drawing: {event.source_event_index}")
        if not visible_text:
            raise ValueError(f"kept event has empty visible text: {event.source_event_index}")
        if event.end < event.start or event.start < 0:
            raise ValueError(f"kept event has invalid time: {event.source_event_index}")
        prepared.append(
            {
                "source_event_index": event.source_event_index,
                "line_number": event.line_number,
                "start": round(event.start, 3),
                "end": round(event.end, 3),
                "style": event.style,
                "text": visible_text,
            }
        )

    expected = policy.get("expected") if isinstance(policy.get("expected"), dict) else {}
    expected_kept = expected.get("kept_events")
    expected_review = expected.get("review_events")
    if expected_kept is not None and len(prepared) != int(expected_kept):
        raise ValueError(f"kept event count mismatch: expected {expected_kept}, got {len(prepared)}")
    if expected_review is not None and review_count != int(expected_review):
        raise ValueError(f"review event count mismatch: expected {expected_review}, got {review_count}")
    if review_count:
        raise ValueError(f"review events must be resolved before preparation: {review_count}")

    prepared.sort(key=lambda item: (item["start"], item["end"], item["source_event_index"]))
    _jsonl_dump(prepared, output_dir / "prepared_events.jsonl")
    _jsonl_dump(actions, output_dir / "event_actions.jsonl")
    report = {
        "schema_version": SCHEMA_VERSION,
        "stage": "prepare",
        "manifest": {"path": str(args.manifest.resolve()), "sha256": _sha256(args.manifest.resolve())},
        "policy": {"path": str(policy_path), "sha256": _sha256(policy_path)},
        "input": manifest["input"],
        "selected_stream": {
            "stream_index": stream["stream_index"],
            "codec_name": stream["codec_name"],
            "language": stream["language"],
            "title": stream["title"],
            "extracted_path": str(extracted),
            "extracted_sha256": extraction["sha256"],
        },
        "source_event_count": len(events),
        "action_counts": dict(sorted(action_counts.items())),
        "prepared_event_count": len(prepared),
        "unknown_styles": unknown_styles,
        "review_event_count": review_count,
    }
    _json_dump(report, output_dir / "prepare_report.json")
    lines = [
        "# MKV Subtitle Preparation",
        "",
        f"- Stream: {stream['stream_index']} (`{stream['title']}` / `{stream['codec_name']}`)",
        f"- Source events: {len(events)}",
        f"- Prepared dialogue events: {len(prepared)}",
        f"- Review events: {review_count}",
        "",
        "| action | count |",
        "|---|---:|",
    ]
    lines.extend(f"| {action} | {count} |" for action, count in sorted(action_counts.items()))
    (output_dir / "prepare_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Prepared {len(prepared)} dialogue events -> {output_dir}")
    for action, count in sorted(action_counts.items()):
        print(f"  {action}: {count}")
    return 0


def _entries_equal(left: list[NormalizedEntry], right: list[NormalizedEntry], *, source: bool) -> bool:
    for a, b in zip(left, right):
        if (
            a.idx != b.idx
            or round(a.start, 3) != round(b.start, 3)
            or round(a.end, 3) != round(b.end, 3)
            or a.speaker != b.speaker
            or a.tags != b.tags
            or a.text != b.text
            or (source and a.source_entries != b.source_entries)
        ):
            return False
    return len(left) == len(right)


def normalize_command(args: argparse.Namespace) -> int:
    prepared_path = args.prepared.resolve()
    rows = _jsonl_load(prepared_path)
    output_dir = _require_new_directory(args.output_dir)
    entries: list[NormalizedEntry] = []
    for idx, row in enumerate(rows, 1):
        text = str(row.get("text", "")).strip()
        start = float(row["start"])
        end = float(row["end"])
        source_event_index = int(row["source_event_index"])
        if not text:
            raise ValueError(f"prepared event has empty text: {source_event_index}")
        if start < 0 or end < start:
            raise ValueError(f"prepared event has invalid time: {source_event_index}")
        if "\ufffd" in text or _ASS_OVERRIDE_RE.search(text):
            raise ValueError(f"prepared event has invalid text residue: {source_event_index}")
        entries.append(
            NormalizedEntry(
                idx=idx,
                start=start,
                end=end,
                speaker="?",
                tags=[],
                text=text,
                source_entries=[source_event_index],
            )
        )
    if not entries:
        raise ValueError("no prepared dialogue events")
    if any(tag not in ALLOWED_TAGS for entry in entries for tag in entry.tags):
        raise ValueError("normalized output contains unsupported tags")

    srt_path = output_dir / "normalized.srt"
    jsonl_path = output_dir / "normalized.jsonl"
    write_srt(entries, srt_path)
    write_jsonl(entries, jsonl_path)
    parsed_srt = parse_srt(srt_path)
    parsed_jsonl = parse_jsonl(jsonl_path)
    if not _entries_equal(entries, parsed_srt, source=False):
        raise ValueError("normalized SRT round-trip mismatch")
    if not _entries_equal(entries, parsed_jsonl, source=True):
        raise ValueError("normalized JSONL round-trip mismatch")

    prepare_report_path = prepared_path.parent / "prepare_report.json"
    prepare_report = (
        json.loads(prepare_report_path.read_text(encoding="utf-8"))
        if prepare_report_path.is_file()
        else None
    )
    report = {
        "schema_version": SCHEMA_VERSION,
        "stage": "normalize",
        "prepared": {"path": str(prepared_path), "sha256": _sha256(prepared_path)},
        "prepare_report": prepare_report,
        "output_entries_total": len(entries),
        "speaker_counts": {"?": len(entries)},
        "validation": {
            "idx_continuous": [entry.idx for entry in entries] == list(range(1, len(entries) + 1)),
            "empty_text": 0,
            "invalid_time": 0,
            "unsupported_tags": 0,
            "srt_round_trip": True,
            "jsonl_round_trip": True,
        },
        "outputs": {
            "normalized_srt": {"path": str(srt_path), "sha256": _sha256(srt_path)},
            "normalized_jsonl": {"path": str(jsonl_path), "sha256": _sha256(jsonl_path)},
        },
    }
    _json_dump(report, output_dir / "normalize_report.json")
    print(f"Normalized {len(entries)} entries -> {output_dir}")
    print(f"  {srt_path}")
    print(f"  {jsonl_path}")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser("inspect", help="probe and extract supported subtitle tracks")
    inspect_parser.add_argument("input", type=Path, help="input MKV path")
    inspect_parser.add_argument("--output-dir", type=Path, required=True, help="new inspection directory")
    inspect_parser.add_argument("--ffprobe", type=Path, default=None, help="explicit ffprobe executable")
    inspect_parser.add_argument("--ffmpeg", type=Path, default=None, help="explicit ffmpeg executable")
    inspect_parser.set_defaults(func=inspect_command)

    prepare_parser = subparsers.add_parser("prepare", help="apply a reviewed policy to an ASS stream")
    prepare_parser.add_argument("--manifest", type=Path, required=True, help="inspect manifest.json")
    prepare_parser.add_argument("--policy", type=Path, required=True, help="reviewed selection policy")
    prepare_parser.add_argument("--output-dir", type=Path, required=True, help="new preparation directory")
    prepare_parser.set_defaults(func=prepare_command)

    normalize_parser = subparsers.add_parser("normalize", help="write Gemini-compatible normalized files")
    normalize_parser.add_argument("--prepared", type=Path, required=True, help="prepared_events.jsonl")
    normalize_parser.add_argument("--output-dir", type=Path, required=True, help="new candidate directory")
    normalize_parser.set_defaults(func=normalize_command)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except (FileNotFoundError, FileExistsError, ValueError, RuntimeError, OSError) as exc:
        print(f"[!] {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
