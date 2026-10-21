"""Real import boundary regressions for persistent speaker colors."""
import json
from pathlib import Path
import tempfile
import unittest

from webui.backend.formats import read_subtitles
from webui.backend.speaker_colors import next_color, SPECIAL_COLORS, oklab, linear_rgb


class SpeakerColorTests(unittest.TestCase):
    def test_all_import_formats_and_extension(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'colors.txt'
            for count in (5, 26, 90):
                rows = [dict(idx=i + 1, id=str(i), start=0, end=1, speaker=f'S{i}', text='line') for i in range(count)]
                for format in ('speaker-srt', 'moss-srt', 'normalized-jsonl', 'moss-json', 'plain-srt'):
                    with self.subTest(count=count, format=format):
                        if format == 'moss-json':
                            text = json.dumps(rows)
                        elif format == 'normalized-jsonl':
                            text = '\n'.join(json.dumps(row) for row in rows)
                        else:
                            text = '\n\n'.join(f'{i + 1}\n00:00:00,000 --> 00:00:01,000\n' +
                                               (f'[S{i}] line' if format == 'speaker-srt' else f'S{i}: line') for i in range(count))
                        source.write_text(text, encoding='utf-8')
                        _, speakers, _ = read_subtitles(source, 2000, 'source', format)
                        self.assertEqual(len({s.color for s in speakers}), len(speakers))
                        for speaker in speakers:
                            luminance = sum(v * weight for v, weight in zip(linear_rgb(speaker.color), (.2126, .7152, .0722)))
                            self.assertGreater((luminance + .05) / (.025 + .05), 4.5)
                        self.assertEqual({s.label: s.color for s in speakers[-2:]}, SPECIAL_COLORS)
                        if format == 'plain-srt':
                            self.assertEqual(len(speakers), 2)

    def test_occupied_colors_case_and_initial_perceptual_separation(self):
        colors = []
        for _ in range(8):
            color = next_color(c.upper() for c in colors)
            self.assertNotIn(color, colors)
            colors.append(color)
        labs = [oklab(c) for c in colors]
        minimum = min(sum((x - y) ** 2 for x, y in zip(a, b)) ** .5
                      for i, a in enumerate(labs) for b in labs[i + 1:])
        self.assertGreater(minimum, .08)

    def test_five_speakers_do_not_repeat(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'five.jsonl'
            source.write_text('\n'.join(json.dumps(dict(idx=i + 1, start=0, end=1,
                                                        speaker=f'S{i}', text='line')) for i in range(5)), encoding='utf-8')
            _, speakers, _ = read_subtitles(source, 2000, 'source', 'normalized-jsonl')
            ordinary = speakers[:-2]
            self.assertEqual(len({s.color.lower() for s in ordinary}), 5, [s.color for s in ordinary])
