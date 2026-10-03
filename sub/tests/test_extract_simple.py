"""Export CLI regression: labeled subtitles do not require a source sidecar."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import extract_simple as extract


class MediaOnlyExportTests(unittest.TestCase):
    def test_explicit_and_default_srt_without_source_subtitle(self):
        for explicit in (True, False):
            with self.subTest(explicit=explicit), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                project = root / "input" / "mkv_only"
                project.mkdir(parents=True)
                media = project / "video.mkv"
                media.touch()
                intermediate = root / "intermediate"
                srt = intermediate / "mkv_only" / "normalized.srt"
                srt.parent.mkdir(parents=True)
                srt.write_text(
                    "1\n00:00:01,000 --> 00:00:04,000\n[Iroha] hello\n",
                    encoding="utf-8",
                )
                argv = [
                    "extract_simple.py", "mkv_only", "--input", str(root / "input"),
                    "--output", str(root / "output"), "--output-type", "audio",
                    "--shape", "clips", "--speakers", "Iroha",
                ]
                if explicit:
                    argv.extend(["--srt", str(srt)])

                def encode(ffmpeg, source, kind, clip, output, **kwargs):
                    self.assertEqual(source, media.resolve())
                    self.assertEqual((clip.start, clip.end, clip.full_text), (1, 4, "hello"))
                    output.write_bytes(b"mock encoded audio")

                with (
                    patch.object(sys, "argv", argv),
                    patch.object(extract, "DEFAULT_INTERMEDIATE_ROOT", intermediate),
                    patch.object(extract, "find_ffmpeg", return_value=Path("ffmpeg")),
                    patch.object(extract, "cut_single_clip", side_effect=encode) as cut,
                ):
                    self.assertEqual(extract.main(), 0)
                cut.assert_called_once()
                output = root / "output" / "mkv_only"
                report = json.loads((output / "extract_report.json").read_text(encoding="utf-8"))
                self.assertIsNone(report["subtitle"])
                self.assertEqual(report["input_srt"], str(srt.resolve()))
                manifest = (output / "Iroha" / "filelist_audio.txt").read_text(encoding="utf-8")
                self.assertTrue(manifest.strip().endswith("|Iroha|hello"))


if __name__ == "__main__":
    unittest.main()
