"""Run official audio diarization, then export source SRT cues with speaker labels."""

from __future__ import annotations

import argparse
import configparser
from pathlib import Path

if __package__:
    from .diarize_audio import diarize_audio
    from .export_speaker import check_outputs, export_speaker, finite_number, read_mapping, read_subtitles
else:
    from diarize_audio import diarize_audio
    from export_speaker import check_outputs, export_speaker, finite_number, read_mapping, read_subtitles


def run_workflow(audio, subtitles, output_dir, *, speakers=None, mapping=None,
                 offset=0.0, overwrite=False):
    """Preflight all outputs, then call the two public module functions directly."""
    output_dir = Path(output_dir)
    inference = output_dir / 'diarization.json'
    output = output_dir / 'speakers.srt'
    diagnostics = output_dir / 'diagnostics.json'
    mapping = Path(mapping) if mapping is not None else output_dir / 'speakers.ini'
    check_outputs([inference, output, diagnostics], [audio, subtitles, mapping], overwrite=overwrite)
    check_outputs([mapping], [audio, subtitles, inference, output, diagnostics], overwrite=True)
    finite_number(offset, 'offset')
    read_subtitles(subtitles)
    read_mapping(mapping)
    diarize_audio(audio, speakers=speakers, output=inference, overwrite=overwrite)
    return export_speaker(inference, subtitles, output, diagnostics,
                          mapping=mapping, offset=offset, overwrite=overwrite)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio', type=Path)
    parser.add_argument('subtitles', type=Path)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--speakers', type=int)
    parser.add_argument('--mapping', type=Path, help='Default: output-dir/speakers.ini')
    parser.add_argument('--offset', type=float, default=0, help='subtitle_seconds = audio_seconds + offset')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args(argv)
    try:
        report = run_workflow(**vars(args))
    except (ValueError, OSError, ImportError, configparser.Error) as exc:
        parser.error(str(exc))
    print(f"Exported {sum(cue['emitted'] for cue in report['cues'])} cues to {args.output_dir}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
