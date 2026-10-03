# Subtitle Export Validation

## Scope

Implemented 2026-09-09 against baseline HEAD `c43643fc8920fa04ae26dc9573db48ca8d1aeec7`, preserving pre-existing dirty work. Changes are restricted to voice code, tests, and voice documentation. This is the approved standalone official inference / subtitle export workflow, not a revival of the rejected two-stage backend or a production Gemini integration.

## Validation

- 12 unittest cases passed, covering public inference calls, workflow preflight, legacy JSON compatibility, metadata shapes, interval union, ties, silent tails, offsets, boundary flags, low coverage, mapping preservation, unsafe inputs, output protection, and read-only fixture cue preservation.
- `py_compile` passed for all four Python entry points and both test files; `pip check` reported no broken requirements. Scoped `git diff --check` passed (Git reported only existing LF/CRLF conversion warnings). Direct compatibility CLI and module export CLI help checks passed.
- One official real inference completed on the existing 62-second 16 kHz stereo vocal fixture with `num_speakers=2`. Output: 15 segments, 2 anonymous speakers, 18 source cues exported.
- FFprobe independently confirmed 16000 Hz, 2 channels, 62.000000 seconds.
- The initial fixture test attempted Python 3.10 `wave`, which cannot read this WAV's extensible format (65534). The test now checks preserved fixture metadata; FFprobe verifies the actual media independently. No audio conversion was performed.
- Upstream TorchAudio emitted deprecation warnings; no dependency or Torch changes were made.
- No LLM/API calls, full-film inference, source-subtitle writes, or Gold reads/edits/evaluation. No accuracy claim follows from this smoke.

## Artifacts

Export-only run:

```text
voice/runs/export_20260909_01/speakers.srt
voice/runs/export_20260909_01/diagnostics.json
voice/runs/export_20260909_01/speakers.ini
```

End-to-end real official smoke:

```text
voice/runs/workflow_20260909_01/diarization.json
voice/runs/workflow_20260909_01/speakers.srt
voice/runs/workflow_20260909_01/diagnostics.json
voice/runs/workflow_20260909_01/speakers.ini
```

Both runs use `sub/intermediate/Cosmic Princess Kaguya/normalized.srt` read-only, offset `799`, and coverage `[799, 861)`. The 18 emitted source cue numbers are 218 through 235; timestamps and body text are preserved. INI templates are blank; no character identities were inferred from existing source tags.

Commands executed from repository root:

```powershell
env\python.exe voice\export_speaker.py "voice/fixtures/kaguya_001319_001421/vocals_official_16k_01/official_diarize.json" "sub/intermediate/Cosmic Princess Kaguya/normalized.srt" --offset 799 --output "voice/runs/export_20260909_01/speakers.srt" --diagnostics "voice/runs/export_20260909_01/diagnostics.json" --mapping "voice/runs/export_20260909_01/speakers.ini"
env\python.exe voice\workflow.py "voice/fixtures/kaguya_001319_001421/scene_audio_track1_vocals_16k.wav" "sub/intermediate/Cosmic Princess Kaguya/normalized.srt" --speakers 2 --offset 799 --output-dir "voice/runs/workflow_20260909_01"
env\python.exe -m unittest discover -s voice/tests -v
```

Use a new output directory for another inference. The installed fork pin in `voice/requirements.txt` and environment were retained unchanged. Anonymous IDs and human mapping are local to each inference. Source tags other than explicit NONSPEECH cannot protect a wrong acoustic assignment; inspect diagnostics and media before using labels downstream.
