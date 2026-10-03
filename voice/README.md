# Voice Diarization Backend

This directory is an isolated acoustic diarization backend for the subtitle-driven pipeline. It uses the external [`FoxNoseTech/diarize`](https://github.com/FoxNoseTech/diarize) package.

## Status

`diarize==0.1.2` is installed in the repository's current `env`. It requires `torch<2.9` and `torchaudio<2.9`; pip resolved `torch==2.8.0+cpu` and `torchaudio==2.8.0+cpu`. The old NeMo/pyannote/Demucs stack was not used by this repository and was removed before installation. The current voice backend is CPU-only.

## Install

From the repository root:

```powershell
env\python.exe -m pip install -r voice\requirements.txt
```

If you need to keep a different Torch/CUDA stack for another project, use a separate Python environment instead. The package's upstream metadata currently resolves Torch 2.8.x on Windows.

## Commands

```powershell
env\python.exe voice\diarize_audio.py "path\to\audio.wav"
env\python.exe voice\diarize_audio.py "path\to\audio.wav" --speakers 4 --output "voice\runs\example\diarization.json"
```

The backend returns anonymous labels such as `SPEAKER_00`. It does not identify project characters and does not model overlapping speech. Do not write its output directly over Gemini labels.

## Official Pipeline

`diarize_audio.py` directly calls the installed `diarize` public `diarize()` pipeline. `diarize_example.py` remains a delegating compatibility entry point for existing callers, not a second implementation. The rejected two-stage adapter and its evaluator have been removed after the controlled fixture comparison. Until upstream resolves issue #9, `voice/requirements.txt` pins the `quark-mac` fork at commit `e4639e5`.

Approved design documents:

```text
docs/design/voice/official_pipeline_research.md
```

```powershell
env\python.exe voice\diarize_example.py "path\to\audio.wav" --speakers 2 --output "voice\runs\official.json"
```

`--speakers 2` passes `num_speakers=2` to the official API. Omitting it enables official automatic estimation. The package owns VAD, embedding extraction, clustering and temporal smoothing.

The wrapper writes anonymous segments as JSON. Use `DiarizeResult.to_rttm()` in a small project-specific adapter when RTTM is needed. Gold evaluation must use a verified same-timebase Gold file; do not guess offsets.

## Subtitle Export

Export without inference or model dependencies:

```powershell
env\python.exe voice\export_speaker.py "voice\runs\example\diarization.json" "path\to\source.srt" --output "voice\runs\example\speakers.srt" --diagnostics "voice\runs\example\diagnostics.json" --mapping "voice\runs\example\speakers.ini" --offset 0
```

Run both steps through public Python functions (no subprocess orchestration):

```powershell
env\python.exe voice\workflow.py "path\to\audio.wav" "path\to\source.srt" --speakers 2 --offset 0 --output-dir "voice\runs\new_run"
```

The workflow writes `diarization.json`, `speakers.srt`, `diagnostics.json`, and an absent-only `speakers.ini` template. All three scripts support direct execution and `python -m voice.<module>`. Public functions are `diarize_audio(...)`, `export_speaker(...)`, and `run_workflow(...)`.

- `--offset` means `subtitle_seconds = audio_seconds + offset`. Use `799` for the existing 00:13:19-00:14:21 fixture against movie subtitles, or `0` for local-time subtitles. No offset is inferred.
- Audio metadata duration defines coverage, including silence after the last speech segment. Only cues with positive intersection with that coverage are emitted. Boundary-crossing cues keep their full source timestamps.
- Source numbering, timing strings, dialogue text, multiline layout, and inline annotations are retained. One initial `[speaker]` prefix is replaced; it is never identity evidence. Explicit `[NONSPEECH]` is preserved. Newline encoding is normalized to LF and output is UTF-8.
- Same-speaker intervals are unioned before summing cue intersections. The unique maximum wins, even below 50% speech coverage. Ties (within 1e-9 seconds) and no intersection yield `?`.
- Numeric IDs are not renumbered by appearance: `SPEAKER_00` becomes `SPK1`, and `SPEAKER_09` becomes `SPK10`.
- `--mapping` is optional for standalone export. If provided but absent, it is created as a blank template. Existing mappings are never changed, even with `--overwrite`.

Example mapping:

```ini
[speakers]
SPK1 = Kaguya
SPK2 =
```

A blank or missing value retains the anonymous SPK label. Mapping keys are case-sensitive. Interpolation is disabled, so `%` is literal; multiline/control characters, brackets, and HTML delimiters in labels are rejected. Mappings belong to one inference run, not to stable canonical identities across runs. Edit the mapping, then rerun **export only** with `--overwrite`; inference need not be repeated.

Generated SRT, diagnostics JSON, and inference JSON refuse replacement without `--overwrite`. Input/output aliases and invalid output parents are rejected before work. Files are not a multi-file transaction: disk failures can leave partial artifacts; use unique run directories and inspect failures before retrying.

The exporter accepts the legacy wrapper `audio` string plus `duration`, the preserved official fixture's `audio: {path, duration, ...}`, and raw public-result `audio_path`/`audio_duration` metadata. Segments must have finite times within audio duration and `SPEAKER_<number>` labels. Missing/invalid durations, malformed cues, and duplicate cue numbers fail rather than silently dropping data. Standard numbered SRT timestamps are required; extended positioning fields are not supported.

### Diagnostics

`diagnostics.json` records source paths, explicit offset, audio coverage interval, applied mapping, and every source cue, including excluded cues (`emitted: false`). Each cue includes:

- `overlaps`: unioned intersection seconds by anonymous SPK label.
- `candidates` and `candidate`: maximum-overlap contenders and the unique winner or `?`, before mapping/NONSPEECH preservation.
- `chosen`: final mapped or preserved label.
- `coverage`: union of all speech intersections divided by full cue duration; `coverage_low` is strictly below 0.5 and never rejects a winner.
- `audio_coverage_fraction`: fraction within the source audio's duration, independent of speech coverage.
- `boundary_crossing`, `explicit_nonspeech`, and `emitted` flags.

## Validation

```powershell
env\python.exe -m unittest discover -s voice/tests -v
env\python.exe -m py_compile voice\diarize_audio.py voice\diarize_example.py voice\export_speaker.py voice\workflow.py voice\tests\test_diarize_audio.py voice\tests\test_export_speaker.py
env\python.exe -m pip check
```

Default tests mock upstream inference and do not download models. The local export-only fixture test skips when its read-only inputs are unavailable. The short real workflow smoke and commands are recorded in `docs/design/voice/subtitle_export_results.md`. Model download is local inference infrastructure, not an LLM API call.

See `docs/design/voice/official_pipeline_research.md` and the preserved fixture results for current limitations. Full-film execution still requires confirmation.

## Output Contract

The example writes:

```json
{
  "audio": "input.wav",
  "duration": 324.5,
  "num_speakers": 3,
  "speakers": ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"],
  "segments": [
    {
      "start": 0.5,
      "end": 4.2,
      "duration": 3.7,
      "speaker": "SPEAKER_00"
    }
  ]
}
```

Keep the source audio timebase unchanged. The standalone exporter aligns this output with source subtitle entries without changing the production Gemini path.

## License

The upstream package is Apache-2.0 licensed. If vendoring or redistributing its source, retain its license and attribution notices. The current integration uses the PyPI package and does not vendor upstream source.
