"""Minimal example for FoxNoseTech/diarize.

Install the optional voice dependency in an isolated environment first:

    env_voice\\python.exe -m pip install -r voice\\requirements.txt

Run:

    env_voice\\python.exe voice\\diarize_example.py input.wav
    env_voice\\python.exe voice\\diarize_example.py input.wav --speakers 2 --output segments.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run FoxNoseTech/diarize and print anonymous speaker segments."
    )
    parser.add_argument("audio", type=Path, help="Input WAV/MP3/FLAC/OGG audio file")
    parser.add_argument(
        "--speakers",
        type=int,
        default=None,
        help="Known speaker count; omit to let diarize estimate it",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional JSON output path",
    )
    return parser.parse_args()


def _result_to_dict(result: Any) -> dict[str, Any]:
    return {
        "audio": str(result.audio_path),
        "duration": result.audio_duration,
        "num_speakers": result.num_speakers,
        "speakers": result.speakers,
        "segments": [
            {
                "start": segment.start,
                "end": segment.end,
                "duration": segment.duration,
                "speaker": segment.speaker,
            }
            for segment in result.segments
        ],
    }


def main() -> int:
    args = _parse_args()
    if not args.audio.exists():
        raise SystemExit(f"Input audio does not exist: {args.audio}")

    try:
        from diarize import diarize
    except ImportError as exc:
        raise SystemExit(
            "diarize is not installed. Install voice/requirements.txt in an isolated environment."
        ) from exc

    kwargs = {}
    if args.speakers is not None:
        if args.speakers < 1:
            raise SystemExit("--speakers must be at least 1")
        kwargs["num_speakers"] = args.speakers

    result = diarize(str(args.audio), **kwargs)
    data = _result_to_dict(result)
    print(f"Audio: {data['audio']}")
    print(f"Duration: {data['duration']:.2f}s")
    print(f"Speakers: {data['num_speakers']} ({', '.join(data['speakers'])})")
    for segment in data["segments"]:
        print(
            f"  [{segment['start']:.2f}s - {segment['end']:.2f}s] "
            f"{segment['speaker']}"
        )

    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"JSON: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
