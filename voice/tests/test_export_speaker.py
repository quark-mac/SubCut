import json
from pathlib import Path
import tempfile
import unittest
import re

from voice.export_speaker import export_speaker


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / 'diarize.json'
        self.srt = self.root / 'source.srt'
        self.output = self.root / 'labeled.srt'
        self.diagnostics = self.root / 'diagnostics.json'
        self.mapping = self.root / 'speakers.ini'

    def run_export(self, segments, text, **kwargs):
        self.data.write_text(json.dumps({'audio': 'clip.wav', 'duration': 10,
                                         'segments': segments}), encoding='utf-8')
        self.srt.write_text(text, encoding='utf-8')
        return export_speaker(self.data, self.srt, self.output, self.diagnostics,
                              mapping=self.mapping, **kwargs)

    def test_union_max_overlap_preserves_source_and_nonspeech(self):
        report = self.run_export([
            {'start': 0, 'end': 2, 'speaker': 'SPEAKER_00'},
            {'start': 0, 'end': 2, 'speaker': 'SPEAKER_00'},
            {'start': 1, 'end': 4, 'speaker': 'SPEAKER_09'},
        ], '007\n00:00:00,000 --> 00:00:04,000\n[Old] Hello\nsecond line  \n\n'
           '19\n00:00:01,000 --> 00:00:02,000\n[NONSPEECH] music\n\n')
        self.assertEqual(self.output.read_text(encoding='utf-8'),
                         '007\n00:00:00,000 --> 00:00:04,000\n[SPK10] Hello\nsecond line  \n\n'
                         '19\n00:00:01,000 --> 00:00:02,000\n[NONSPEECH] music\n\n')
        self.assertEqual(report['cues'][0]['overlaps'], {'SPK1': 2, 'SPK10': 3})
        self.assertEqual(report['cues'][0]['candidate'], 'SPK10')
        self.assertEqual(report['cues'][1]['chosen'], 'NONSPEECH')
        self.assertIn('SPK10 =', self.mapping.read_text())
        self.assertEqual(json.loads(self.diagnostics.read_text()), report)

    def test_offset_boundaries_ties_silence_and_low_coverage(self):
        report = self.run_export([
            {'start': 0, 'end': 0.25, 'speaker': 'SPEAKER_00'},
            {'start': 2, 'end': 3, 'speaker': 'SPEAKER_00'},
            {'start': 3, 'end': 4, 'speaker': 'SPEAKER_01'},
        ], '1\n00:00:08,000 --> 00:00:10,000\nexcluded\n\n'
           '2\n00:00:09,000 --> 00:00:11,000\n[Wrong] boundary\n\n'
           '3\n00:00:12,000 --> 00:00:14,000\ntie\n\n'
           '4\n00:00:18,000 --> 00:00:21,000\nsilent tail\n\n'
           '5\n00:00:20,000 --> 00:00:21,000\nexcluded\n\n', offset=10)
        a, b, c, d, e = report['cues']
        self.assertFalse(a['emitted'])
        self.assertFalse(e['emitted'])
        self.assertTrue(b['boundary_crossing'])
        self.assertTrue(b['coverage_low'])
        self.assertEqual(b['coverage'], 0.125)
        self.assertEqual(b['chosen'], 'SPK1')
        self.assertEqual(c['candidate'], '?')
        self.assertEqual(c['candidates'], ['SPK1', 'SPK2'])
        self.assertEqual(d['chosen'], '?')
        self.assertTrue(d['emitted'])
        self.assertTrue(d['boundary_crossing'])
        self.assertIn('00:00:18,000 --> 00:00:21,000', self.output.read_text())

    def test_mapping_is_literal_blank_falls_back_and_never_overwritten(self):
        contents = '[speakers]\nSPK1 = Kaguya 100%\nSPK2 =\n'
        self.mapping.write_text(contents)
        report = self.run_export([
            {'start': 0, 'end': 1, 'speaker': 'SPEAKER_00'},
            {'start': 1, 'end': 2, 'speaker': 'SPEAKER_01'},
        ], '1\n00:00:00,000 --> 00:00:01,000\na\n\n'
           '2\n00:00:01,000 --> 00:00:02,000\nb\n\n')
        self.assertEqual([c['chosen'] for c in report['cues']], ['Kaguya 100%', 'SPK2'])
        export_speaker(self.data, self.srt, self.output, self.diagnostics,
                       mapping=self.mapping, overwrite=True)
        self.assertEqual(self.mapping.read_text(), contents)

    def test_shipped_audio_metadata_shapes(self):
        self.srt.write_text('1\n00:00:08,000 --> 00:00:09,000\nsilence\n\n')
        for metadata in ({'audio': 'a.wav', 'duration': 10},
                         {'audio': {'path': 'a.wav', 'duration': 10}},
                         {'audio_path': 'a.wav', 'audio_duration': 10}):
            with self.subTest(metadata=metadata):
                self.data.write_text(json.dumps(dict(metadata, segments=[])))
                report = export_speaker(self.data, self.srt, self.output,
                                         self.diagnostics, overwrite=True)
                self.assertTrue(report['cues'][0]['emitted'])

    def test_malformed_input_and_unsafe_mapping_fail_before_writing(self):
        valid = {'audio': 'a.wav', 'duration': 10, 'segments': []}
        self.srt.write_text('1\n00:00:00,000 --> 00:00:01,000\na\n\n')
        bad = [[], {}, dict(valid, duration=float('nan')), dict(valid, duration=-1),
               dict(valid, segments={}), dict(valid, segments=[None]),
               dict(valid, segments=[{'start': 0, 'end': float('inf'), 'speaker': 'SPEAKER_00'}]),
               dict(valid, segments=[{'start': -1, 'end': 1, 'speaker': 'SPEAKER_00'}]),
               dict(valid, segments=[{'start': 0, 'end': 11, 'speaker': 'SPEAKER_00'}]),
               dict(valid, segments=[{'start': 0, 'end': 1, 'speaker': '[injection]'}])]
        for data in bad:
            with self.subTest(data=data):
                self.data.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    export_speaker(self.data, self.srt, self.output, self.diagnostics)
                self.assertFalse(self.output.exists())
        self.data.write_text(json.dumps(valid))
        for value in ('[bad]', '<b>bad</b>', 'first\n second'):
            self.mapping.write_text('[speakers]\nSPK1 = ' + value)
            with self.assertRaises(ValueError):
                export_speaker(self.data, self.srt, self.output, self.diagnostics, mapping=self.mapping)
        with self.assertRaises(ValueError):
            export_speaker(self.data, self.srt, self.output, self.diagnostics, offset=float('inf'))
        for text in ('garbage', '1\n00:99:00,000 --> 00:00:01,000\na',
                     '1\n00:00:02,000 --> 00:00:01,000\na'):
            self.srt.write_text(text)
            with self.assertRaises(ValueError):
                export_speaker(self.data, self.srt, self.output, self.diagnostics)

    def test_outputs_cannot_alias_inputs_and_require_overwrite(self):
        self.run_export([], '1\n00:00:00,000 --> 00:00:01,000\na\n\n')
        with self.assertRaises(FileExistsError):
            export_speaker(self.data, self.srt, self.output, self.diagnostics)
        for output, diagnostics, mapping in ((self.srt, self.diagnostics, None),
                                             (self.output, self.output, None),
                                             (self.output, self.diagnostics, self.srt)):
            with self.assertRaises(ValueError):
                export_speaker(self.data, self.srt, output, diagnostics,
                               mapping=mapping, overwrite=True)

    def test_invalid_output_parent_fails_before_any_output(self):
        self.data.write_text(json.dumps({'duration': 10, 'segments': []}))
        self.srt.write_text('1\n00:00:00,000 --> 00:00:01,000\na\n\n')
        blocker = self.root / 'not_a_directory'
        blocker.touch()
        with self.assertRaises((ValueError, OSError)):
            export_speaker(self.data, self.srt, self.output, blocker / 'report.json',
                           mapping=self.mapping)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.mapping.exists())

    def test_existing_62_second_fixture_export_preserves_source_cues(self):
        root = Path(__file__).resolve().parents[2]
        fixture = root / 'voice/fixtures/kaguya_001319_001421'
        source = root / 'sub/intermediate/Cosmic Princess Kaguya/normalized.srt'
        inference = fixture / 'vocals_official_16k_01/official_diarize.json'
        audio = fixture / 'scene_audio_track1_vocals_16k.wav'
        if not all(p.exists() for p in (source, inference, audio)):
            self.skipTest('Local read-only fixture is not available')
        before = source.read_bytes()
        metadata = json.loads(inference.read_text())['audio']
        self.assertEqual(metadata['sample_rate'], 16000)
        self.assertEqual(metadata['duration'], 62)
        report = export_speaker(inference, source, self.output, self.diagnostics, offset=799)
        self.assertEqual(report['audio_coverage'], [799, 861])
        self.assertEqual(sum(c['emitted'] for c in report['cues']), 18)
        original = {block.split('\n')[0]: block.split('\n')
                    for block in source.read_text(encoding='utf-8-sig').strip('\n').split('\n\n')}
        for block in self.output.read_text(encoding='utf-8').strip('\n').split('\n\n'):
            lines = block.split('\n')
            expected = original[lines[0]]
            self.assertEqual(lines[:2], expected[:2])
            strip_label = lambda value: re.sub(r'^\[[^\]\n]+\][ \t]?', '', value)
            self.assertEqual(strip_label('\n'.join(lines[2:])),
                             strip_label('\n'.join(expected[2:])))
        self.assertEqual(source.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
