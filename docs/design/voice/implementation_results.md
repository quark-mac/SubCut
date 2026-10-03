# Implementation Results

## Scope And Environment

- Baseline HEAD: `c43643fc8920fa04ae26dc9573db48ca8d1aeec7`.
- Existing documentation changes were preserved. Implementation edits are confined to voice and its documentation/tests.
- Python 3.10.19; diarize 0.1.2; Torch/Torchaudio 2.8.0+cpu; pip check passed.
- No external LLM/Gemini calls, source audio changes, Gold changes, or full-film inference.

## Short Smoke

- Input: `sub/input/Cosmic Princess Kaguya/SPKS/Iroha/Iroha_vocals.wav`.
- Duration: 26.076009 seconds; 44100 Hz; stereo.
- Final run: `voice/smoke_c43643f_20260906_final/`, 6.714 seconds wall time.
- Initial run: `voice/smoke_c43643f_20260906/`, 7.894 seconds including initial ~25 MB embedding model download.
- Original high-level baseline: `voice/smoke_c43643f_20260906/one_stage.json`, 6.601 seconds.
- Defaults: long minimum 3 seconds, short cosine threshold 0.5, auto speakers 1..20, merge gap 0.05, smoothing 0.1 seconds. Backend-facing settings are recorded in JSON.
- Stage 1: one long VAD, seven windows, one cluster. Stage 2: twelve short VADs, 27 windows.
- Torchaudio emitted deprecation warnings; no environment change was needed.

## Accuracy Status

| Method | Long purity | Short accuracy | Short UNKNOWN |
|---|---:|---:|---:|
| one-stage smoke | Not evaluated | Not evaluated | 0/12 = 0% |
| two-stage smoke | Not evaluated | Not evaluated | 6/12 = 50% |

The reference vocal WAV has no verified movie-time Gold mapping. No canonical role label or guessed offset was used as ground truth. Purity, accuracy and the +5 percentage-point gate remain unverified. The smoke UNKNOWN rate exceeds the 30% target. This smoke is not a representative accuracy benchmark; no threshold tuning or production integration is justified by it.

Fixture reports verify calculation only, not model quality. The mixed-cluster fixture gives two-stage purity 66.67%, short accuracy 50%, UNKNOWN 80%; baseline short accuracy 100%. UNKNOWN is included in the accuracy denominator, excluded Gold samples remain in the UNKNOWN-rate denominator.

## Tests And Next Gate

`env\python.exe -m unittest discover -s voice/tests -v`: seven deterministic tests passed; one opt-in real-model test skipped by default. Both new commands and tests pass py_compile; pip check passes.

Next: obtain a verified same-timebase short multi-speaker audio/Gold fixture for the independent evaluator. Full-film evaluation requires explicit approval and is required before claiming production effectiveness. Keep all four acceptance gates unchanged.
