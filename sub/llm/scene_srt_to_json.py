"""Convert an edited scene timeline SRT back to scene_segments.json."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sub._srt_io import NormalizedEntry, parse_srt
from sub.llm.diarize_llm import INTERMEDIATE_ROOT


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="把人工编辑后的 scene SRT 映射回 scene_segments.json",
    )
    parser.add_argument("project", help="项目名，对应 sub/intermediate/<project>/")
    parser.add_argument("scene_srt", type=Path, help="人工编辑后的 scene_segments.srt")
    parser.add_argument("--srt", type=Path, default=None, help="原始字幕，默认 normalized.srt，缺失时回退 llm_corrected.srt")
    parser.add_argument("--output", type=Path, default=None, help="输出 JSON，默认写到 scene SRT 同目录")
    parser.add_argument("--allow-partial", action="store_true", help="允许 scene SRT 只覆盖部分目标字幕")
    return parser.parse_args()


def _resolve_source_srt(project: str, explicit: Path | None) -> Path:
    if explicit is not None:
        if not explicit.exists():
            raise FileNotFoundError(f"找不到输入 SRT: {explicit}")
        return explicit
    intermediate = INTERMEDIATE_ROOT / project
    for name in ("normalized.srt", "llm_corrected.srt"):
        path = intermediate / name
        if path.exists():
            return path
    raise FileNotFoundError(f"找不到 normalized.srt 或 llm_corrected.srt: {intermediate}")


def _srt_time_to_seconds(value: str) -> float:
    hours, minutes, rest = value.strip().split(":")
    seconds, millis = rest.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def _read_scene_srt(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"找不到 scene SRT: {path}")
    text = path.read_text(encoding="utf-8-sig")
    blocks = [block.strip() for block in text.replace("\r\n", "\n").split("\n\n") if block.strip()]
    scenes: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for block_no, block in enumerate(blocks, start=1):
        lines = block.splitlines()
        if len(lines) < 2 or "-->" not in lines[1]:
            raise ValueError(f"scene SRT 第 {block_no} 块格式无效")
        try:
            scene_id = int(lines[0].strip())
        except ValueError as exc:
            raise ValueError(f"scene SRT 第 {block_no} 块编号无效: {lines[0]!r}") from exc
        if scene_id in seen_ids:
            raise ValueError(f"scene_id 重复: {scene_id}")
        seen_ids.add(scene_id)
        start_text, end_text = [part.strip() for part in lines[1].split("-->", 1)]
        start = _srt_time_to_seconds(start_text)
        end = _srt_time_to_seconds(end_text)
        if end < start:
            raise ValueError(f"scene {scene_id} 结束时间早于开始时间")
        scenes.append({
            "scene_id": scene_id,
            "enabled": True,
            "name": " ".join(line.strip() for line in lines[2:] if line.strip()) or f"scene_{scene_id:04d}",
            "start": start,
            "end": end,
        })
    if not scenes:
        raise ValueError("scene SRT 中没有有效场景")
    for previous, current in zip(scenes, scenes[1:]):
        if current["start"] < previous["start"]:
            raise ValueError(
                f"scene 时间顺序错误: scene {previous['scene_id']} 后面是 scene {current['scene_id']}"
            )
    return scenes


def _select_target_entries(entries: list[NormalizedEntry]) -> list[NormalizedEntry]:
    return [entry for entry in entries if entry.speaker != "NONSPEECH" and "♪" not in entry.text]


def _map_scenes(
    scene_ranges: list[dict[str, Any]],
    entries: list[NormalizedEntry],
    allow_partial: bool,
) -> list[dict[str, Any]]:
    assignments: dict[int, list[NormalizedEntry]] = {
        int(scene["scene_id"]): [] for scene in scene_ranges
    }
    missing: list[int] = []
    duplicate_matches: list[tuple[int, list[int]]] = []

    for entry in entries:
        midpoint = (entry.start + entry.end) / 2
        matches = [
            scene for scene in scene_ranges
            if float(scene["start"]) <= midpoint <= float(scene["end"])
        ]
        if not matches:
            missing.append(entry.idx)
            continue
        if len(matches) > 1:
            duplicate_matches.append((entry.idx, [int(scene["scene_id"]) for scene in matches]))
            continue
        assignments[int(matches[0]["scene_id"])].append(entry)

    if duplicate_matches:
        details = ", ".join(
            f"idx {idx}->scenes {scene_ids}" for idx, scene_ids in duplicate_matches[:20]
        )
        raise ValueError(f"字幕 midpoint 被多个 scene 重复覆盖: {details}")
    if missing and not allow_partial:
        raise ValueError(
            f"有 {len(missing)} 条目标字幕未被任何 scene 覆盖: {missing[:30]}"
        )

    output: list[dict[str, Any]] = []
    empty_scenes: list[int] = []
    for scene in scene_ranges:
        scene_id = int(scene["scene_id"])
        covered = assignments[scene_id]
        if not covered:
            empty_scenes.append(scene_id)
            continue
        output.append({
            "scene_id": scene_id,
            "enabled": bool(scene.get("enabled", True)),
            "name": str(scene["name"]),
            "start_idx": covered[0].idx,
            "end_idx": covered[-1].idx,
            "start": round(float(scene["start"]), 3),
            "end": round(float(scene["end"]), 3),
        })
    if empty_scenes:
        raise ValueError(f"以下 scene 没有覆盖任何目标字幕: {empty_scenes}")
    if allow_partial and missing:
        print(f"[warn] partial mapping: {len(missing)} 条目标字幕未覆盖", file=sys.stderr)
    return output


def main() -> int:
    args = _parse_args()
    try:
        source_srt = _resolve_source_srt(args.project, args.srt)
        scene_ranges = _read_scene_srt(args.scene_srt)
        entries = _select_target_entries(parse_srt(source_srt))
        scenes = _map_scenes(scene_ranges, entries, args.allow_partial)
        output = args.output or (args.scene_srt.parent / "scene_segments.json")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(scenes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    print(f"原始字幕 : {source_srt}")
    print(f"Scene SRT: {args.scene_srt}")
    print(f"scenes   : {len(scenes)}")
    print(f"JSON     : {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
