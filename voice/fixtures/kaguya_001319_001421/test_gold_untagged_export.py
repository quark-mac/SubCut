"""Export the existing fixture against a label-free copy of the complete Gold SRT."""
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from voice.export_speaker import export_speaker, read_subtitles


def main():
    gold = ROOT / 'sub/intermediate/Cosmic Princess Kaguya/final_gold_set.srt'
    inference = ROOT / 'voice/runs/workflow_20260909_01/diarization.json'
    out = ROOT / 'voice/runs/gold_untagged_export_02'
    original = gold.read_bytes()
    text = original.decode('utf-8-sig')
    # Only strip a bracketed prefix on the first text line after a cue timestamp.
    pattern = r'(^[^\r\n]*-->[^\r\n]*\r?\n)\[[^\]\r\n]+\][ \t]?'
    stripped, count = re.subn(pattern, r'\1', text, flags=re.MULTILINE)
    out.mkdir(parents=True, exist_ok=False)
    source = out / 'final_gold_set_untagged.srt'
    source.write_bytes(stripped.encode('utf-8'))
    blocks = re.split(r'\n\s*\n', stripped.replace('\r\n', '\n').strip())
    selected = [block for block in blocks if 217 <= int(block.splitlines()[0]) <= 234]
    clip = out / 'clip_gold_untagged.srt'
    clip.write_text('\n\n'.join(selected) + '\n', encoding='utf-8')
    after = read_subtitles(clip)
    assert len(after) == 18
    report = export_speaker(inference, clip, out / 'speakers.srt',
                            out / 'diagnostics.json', mapping=out / 'speakers.ini', offset=799)
    assert gold.read_bytes() == original, 'Original Gold changed'
    emitted = [cue for cue in report['cues'] if cue['emitted']]
    record = dict(source_gold=str(gold), gold_sha256=hashlib.sha256(original).hexdigest(),
                  original_gold_unchanged=True, removed_prefixes=count,
                  source_cues=len(blocks), clip_cues=len(after), emitted_cues=len(emitted),
                  offset_seconds=799, inference=str(inference),
                  note='All leading labels removed, including NONSPEECH; no labels used as inference evidence.')
    (out / 'preparation.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
