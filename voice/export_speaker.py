"""Assign anonymous acoustic clusters to intact source SRT cues (stdlib only)."""

from __future__ import annotations

import argparse
import configparser
import json
import math
from pathlib import Path
import re


def check_outputs(outputs, inputs=(), *, overwrite=False):
    """Reject aliases and existing outputs before doing work, even with overwrite."""
    paths = [Path(p).resolve() for p in outputs if p is not None]
    sources = [Path(p).resolve() for p in inputs if p is not None]
    if len(set(paths)) != len(paths) or set(paths) & set(sources):
        raise ValueError('Output paths must be distinct and must not replace inputs')
    for path in paths:
        if any(path in other.parents for other in paths + sources):
            raise ValueError('An output file cannot be a parent of another path')
        if any(parent.exists() and not parent.is_dir() for parent in path.parents):
            raise ValueError(f'Output parent is not a directory: {path}')
        if path.exists() and (not overwrite or not path.is_file()):
            raise FileExistsError(f'Output exists (use --overwrite): {path}')


def write_output(path, text, *, overwrite=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w' if overwrite else 'x', encoding='utf-8', newline='\n') as stream:
        stream.write(text)


def finite_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f'{name} must be a finite number')
    if not math.isfinite(value):
        raise ValueError(f'{name} must be a finite number')
    return float(value)


def read_diarization(path):
    data = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if not isinstance(data, dict):
        raise ValueError('Diarization JSON must be an object')
    audio = data.get('audio')
    duration = finite_number(audio.get('duration') if isinstance(audio, dict)
                             else data.get('duration', data.get('audio_duration')), 'audio duration')
    if duration <= 0:
        raise ValueError('Audio duration must be positive')
    if not isinstance(data.get('segments'), list):
        raise ValueError('segments must be a list')
    intervals = {}
    for segment in data['segments']:
        if not isinstance(segment, dict):
            raise ValueError('Each segment must be an object')
        start = finite_number(segment.get('start'), 'segment start')
        end = finite_number(segment.get('end'), 'segment end')
        if not 0 <= start < end <= duration:
            raise ValueError('Segment must satisfy 0 <= start < end <= audio duration')
        speaker = segment.get('speaker')
        if not isinstance(speaker, str) or not re.fullmatch(r'SPEAKER_[0-9]+', speaker):
            raise ValueError('Segment speaker must be SPEAKER_<number>')
        label = f'SPK{int(speaker[8:]) + 1}'
        intervals.setdefault(label, []).append((start, end))
    return duration, {key: union(value) for key, value in
                      sorted(intervals.items(), key=lambda item: int(item[0][3:]))}


def union(intervals):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def read_subtitles(path):
    text = Path(path).read_text(encoding='utf-8-sig')
    cues = []
    seen = set()
    timestamp = r'([0-9]{2,}):([0-5][0-9]):([0-5][0-9]),([0-9]{3})'
    for block in re.split(r'\n[ \t]*\n', text.strip('\n')):
        lines = block.split('\n')
        if len(lines) < 3 or not re.fullmatch(r'[0-9]+', lines[0]):
            raise ValueError('Each SRT block needs a cue number, timing and text')
        match = re.fullmatch(timestamp + r'[ \t]+-->[ \t]+' + timestamp, lines[1])
        if not match:
            raise ValueError(f'Invalid SRT timing at cue {lines[0]}')
        values = list(map(int, match.groups()))
        start, end = [h * 3600 + m * 60 + s + ms / 1000
                      for h, m, s, ms in (values[:4], values[4:])]
        idx = int(lines[0])
        if end <= start or idx in seen or not any(line.strip() for line in lines[2:]):
            raise ValueError(f'Invalid or duplicate SRT cue {lines[0]}')
        seen.add(idx)
        cues.append((lines[0], lines[1], start, end, '\n'.join(lines[2:])))
    return cues


def read_mapping(path):
    if path is None or not Path(path).exists():
        return {}
    config = configparser.ConfigParser(interpolation=None)
    config.optionxform = str
    config.read_string(Path(path).read_text(encoding='utf-8-sig'))
    if config.defaults() or config.sections() != ['speakers']:
        raise ValueError('Mapping must contain only [speakers], without defaults')
    mapping = dict(config['speakers'])
    for key, value in mapping.items():
        if not re.fullmatch(r'SPK[1-9][0-9]*', key):
            raise ValueError(f'Invalid mapping key: {key}')
        if any(not c.isprintable() or c in '[]<>' for c in value):
            raise ValueError(f'Unsafe speaker label for {key}')
    return mapping


def export_speaker(diarization, subtitles, output, diagnostics, *, mapping=None,
                   offset=0.0, overwrite=False):
    """Export cues intersecting [offset, offset + source audio duration)."""
    check_outputs([output, diagnostics], [diarization, subtitles, mapping], overwrite=overwrite)
    if mapping is not None:
        check_outputs([mapping], [diarization, subtitles, output, diagnostics], overwrite=True)
    offset = finite_number(offset, 'offset')
    duration, intervals = read_diarization(diarization)
    coverage_end = finite_number(offset + duration, 'coverage end')
    cues = read_subtitles(subtitles)
    labels = read_mapping(mapping)
    report = {'diarization': str(diarization), 'subtitles': str(subtitles),
              'offset': offset, 'audio_coverage': [offset, coverage_end],
              'mapping': labels, 'cues': []}
    rendered = []
    for number, timing, start, end, text in cues:
        audio_overlap = max(0.0, min(end, coverage_end) - max(start, offset))
        overlaps = {speaker: sum(max(0.0, min(end, b + offset) - max(start, a + offset))
                                 for a, b in spans) for speaker, spans in intervals.items()}
        maximum = max(overlaps.values(), default=0.0)
        candidates = [key for key, value in overlaps.items()
                      if maximum > 0 and math.isclose(value, maximum, rel_tol=0, abs_tol=1e-9)]
        candidate = candidates[0] if len(candidates) == 1 else '?'
        # Union across clusters too, so overlapping speakers cannot inflate coverage.
        speech = union([(max(start, a + offset), min(end, b + offset))
                        for spans in intervals.values() for a, b in spans
                        if min(end, b + offset) > max(start, a + offset)])
        coverage = sum(b - a for a, b in speech) / (end - start)
        leading = re.match(r'^[ \t]*\[([^\]\n]+)\][ \t]?', text)
        nonspeech = leading is not None and leading[1] == 'NONSPEECH'
        chosen = 'NONSPEECH' if nonspeech else labels.get(candidate) or candidate
        emitted = audio_overlap > 0
        report['cues'].append({'number': number, 'start': start, 'end': end,
                              'overlaps': overlaps, 'candidates': candidates,
                              'candidate': candidate, 'chosen': chosen,
                              'coverage': coverage, 'coverage_low': coverage < 0.5,
                              'audio_coverage_fraction': audio_overlap / (end - start),
                              'boundary_crossing': emitted and (start < offset or end > coverage_end),
                              'emitted': emitted, 'explicit_nonspeech': nonspeech})
        if emitted:
            body = text[leading.end():] if leading else text
            rendered.append(f'{number}\n{timing}\n[{chosen}] {body}\n\n')
    if mapping is not None and not Path(mapping).exists():
        write_output(mapping, '[speakers]\n' + ''.join(f'{key} =\n' for key in intervals))
    write_output(output, ''.join(rendered), overwrite=overwrite)
    write_output(diagnostics, json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n',
                 overwrite=overwrite)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('diarization', type=Path)
    parser.add_argument('subtitles', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--diagnostics', type=Path, required=True)
    parser.add_argument('--mapping', type=Path)
    parser.add_argument('--offset', type=float, default=0, help='subtitle_seconds = audio_seconds + offset')
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args(argv)
    try:
        report = export_speaker(**vars(args))
    except (ValueError, OSError, configparser.Error) as exc:
        parser.error(str(exc))
    print(f"Exported {sum(cue['emitted'] for cue in report['cues'])} cues to {args.output}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
