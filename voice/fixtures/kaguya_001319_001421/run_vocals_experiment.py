"""Run this specific 62-second fixture without modifying movie-time Gold."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = Path(__file__).resolve().parent


def main():
    import soundfile as sf

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--speakers', type=int, choices=[2])
    parser.add_argument('--audio', type=Path, default=FIXTURE / 'scene_audio_track1_vocals.wav')
    parser.add_argument('--output-name', default=None)
    args = parser.parse_args()
    OUT = FIXTURE / (args.output_name or ('vocals_fixed2_01' if args.speakers else 'vocals_auto_01'))
    audio = args.audio
    gold = ROOT / 'sub/intermediate/Cosmic Princess Kaguya/final_gold_set.srt'
    original = gold.read_bytes()
    info = sf.info(str(audio))
    if abs(info.duration - 62) > .001:
        raise ValueError('Expected original 62-second clip timebase')
    OUT.mkdir(exist_ok=False)
    selected = []
    ids = []
    def shift(match):
        h, m, s, ms = map(int, match.groups())
        value = ((h * 60 + m) * 60 + s) * 1000 + ms - 799000
        if not 0 <= value <= 62000:
            raise ValueError('Gold timestamp outside selected interval')
        return f'{value // 3600000:02d}:{value // 60000 % 60:02d}:{value // 1000 % 60:02d},{value % 1000:03d}'
    for block in re.split(r'\n\s*\n', original.decode('utf-8-sig').strip()):
        lines = block.splitlines()
        idx = int(lines[0])
        if 217 <= idx <= 234:
            ids.append(idx)
            lines[1] = re.sub(r'(\d{2}):(\d{2}):(\d{2}),(\d{3})', shift, lines[1])
            selected.append('\n'.join(lines))
    assert ids == list(range(217, 235))
    derived = OUT / 'gold_clip_derived.srt'
    derived.write_text('\n\n'.join(selected) + '\n', encoding='utf-8')
    record = dict(source_gold=str(gold), source_gold_sha256=hashlib.sha256(original).hexdigest(),
                  source_audio=str(audio), source_audio_sha256=hashlib.sha256(audio.read_bytes()).hexdigest(),
                  duration=info.duration, sample_rate=info.samplerate, channels=info.channels,
                  movie_offset_seconds=799, gold_cue_ids=ids,
                  timebase_assumption='User vocal separation preserves timing; duration verified, internal delay not independently measured',
                  baseline_commit=subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                  working_tree='uncommitted voice implementation', runs=[])
    commands = [
        [sys.executable, 'voice/diarize_example.py', str(audio), '--output', str(OUT / 'one_stage.json')],
    ]
    if args.speakers:
        for command in commands:
            command.extend(['--speakers', str(args.speakers)])
    try:
        for command in commands:
            start = time.perf_counter()
            result = subprocess.run(command, cwd=ROOT)
            record['runs'].append(dict(command=command, seconds=time.perf_counter() - start, returncode=result.returncode))
            result.check_returncode()
    finally:
        record['gold_unchanged'] = gold.read_bytes() == original
        (OUT / 'experiment.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    assert record['gold_unchanged']


if __name__ == '__main__':
    main()
