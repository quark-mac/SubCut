import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from voice.diarize_audio import diarize_audio
from voice.workflow import run_workflow


class InferenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.audio = self.root / 'audio.wav'
        self.audio.touch()
        self.output = self.root / 'inference.json'
        self.srt = self.root / 'source.srt'
        self.srt.write_text('42\n00:00:00,000 --> 00:00:01,000\n[Old] hello\n\n')
        self.backend = Mock(return_value=SimpleNamespace(
            audio_path=self.audio, audio_duration=10.0, num_speakers=1,
            speakers=['SPEAKER_00'], segments=[SimpleNamespace(
                start=0.0, end=1.0, duration=1.0, speaker='SPEAKER_00')]))
        self.patch = patch.dict('sys.modules', {'diarize': SimpleNamespace(diarize=self.backend)})
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_public_api_default_fixed_count_and_legacy_shape(self):
        data = diarize_audio(self.audio, output=self.output)
        self.backend.assert_called_once_with(str(self.audio))
        self.assertEqual(data['audio'], str(self.audio))
        self.assertEqual(data['duration'], 10)
        self.assertEqual(json.loads(self.output.read_text()), data)
        diarize_audio(self.audio, speakers=2, output=self.output, overwrite=True)
        self.backend.assert_called_with(str(self.audio), num_speakers=2)

    def test_preflight_before_inference(self):
        self.output.touch()
        with self.assertRaises(FileExistsError):
            diarize_audio(self.audio, output=self.output)
        for speakers in (0, -1, True, 1.5):
            with self.assertRaises(ValueError):
                diarize_audio(self.audio, speakers=speakers)
        with self.assertRaises(ValueError):
            diarize_audio(self.audio, output=self.audio, overwrite=True)
        self.backend.assert_not_called()

    def test_workflow_runs_both_and_preserves_mapping(self):
        out = self.root / 'run'
        report = run_workflow(self.audio, self.srt, out, speakers=2)
        self.assertEqual(report['cues'][0]['chosen'], 'SPK1')
        self.assertTrue((out / 'diarization.json').exists())
        self.assertIn('[SPK1] hello', (out / 'speakers.srt').read_text())
        (out / 'speakers.ini').write_text('[speakers]\nSPK1 = Kaguya\n')
        report = run_workflow(self.audio, self.srt, out, overwrite=True)
        self.assertEqual(report['cues'][0]['chosen'], 'Kaguya')

    def test_workflow_preflights_export_before_inference(self):
        out = self.root / 'run'
        out.mkdir()
        (out / 'speakers.srt').touch()
        with self.assertRaises(FileExistsError):
            run_workflow(self.audio, self.srt, out)
        with self.assertRaises(ValueError):
            run_workflow(self.audio, self.srt, self.root / 'invalid', offset=float('nan'))
        self.backend.assert_not_called()


if __name__ == '__main__':
    unittest.main()
