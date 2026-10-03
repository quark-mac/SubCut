"""Run the installed diarize public pipeline without altering the audio timebase."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

if __package__:
    from .export_speaker import check_outputs, finite_number, write_output
else:
    from export_speaker import check_outputs, finite_number, write_output


def _result_to_dict(result: Any) -> dict[str, Any]:
    return {
        'audio': str(result.audio_path),
        'duration': result.audio_duration,
        'num_speakers': result.num_speakers,
        'speakers': result.speakers,
        'segments': [
            {'start': segment.start, 'end': segment.end,
             'duration': segment.duration, 'speaker': segment.speaker}
            for segment in result.segments
        ],
    }


def diarize_audio(audio, *, speakers=None, output=None, overwrite=False):
    """Call diarize.diarize; retain the shipped example's JSON schema."""
    audio = Path(audio)
    if not audio.is_file():
        raise ValueError(f'Input audio is not a file: {audio}')
    if speakers is not None and (type(speakers) is not int or speakers < 1):
        raise ValueError('speakers must be a positive integer')
    check_outputs([output], [audio], overwrite=overwrite)
    from diarize import diarize

    result = diarize(str(audio), **({'num_speakers': speakers} if speakers is not None else {}))
    data = _result_to_dict(result)
    if finite_number(data['duration'], 'audio duration') <= 0:
        raise ValueError('Backend returned non-positive audio duration')
    serialized = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if output is not None:
        write_output(output, serialized, overwrite=overwrite)
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio', type=Path)
    parser.add_argument('--speakers', type=int, help='Known count; omit for official automatic estimation')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args(argv)
    try:
        data = diarize_audio(**vars(args))
    except (ValueError, OSError, ImportError) as exc:
        parser.error(str(exc))
    print(f"Audio: {data['audio']}\nDuration: {data['duration']:.2f}s")
    print(f"Speakers: {data['num_speakers']} ({', '.join(data['speakers'])})")
    for segment in data['segments']:
        print(f"  [{segment['start']:.2f}s - {segment['end']:.2f}s] {segment['speaker']}")
    if args.output is not None:
        print(f'JSON: {args.output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
