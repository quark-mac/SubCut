# Official `diarize()` Comparison

This run uses the package's public high-level API exactly:

```python
from diarize import diarize
result = diarize(audio_path, num_speakers=2)
```

It does not call the two-stage adapter's VAD, embedding, clustering, threshold, or timeline code. `--vad-reference` only copies the already-recorded same-input VAD intervals into the comparison artifact so the evaluator can partition long/short samples identically; it does not affect official inference.

Input: `../scene_audio_track1_vocals_16k.wav`, 16 kHz stereo, 62 seconds. Original Gold was unchanged. The official result contains 15 final segments and exactly 2 speakers.

| Method | Long purity | Short accuracy | Short UNKNOWN |
|---|---:|---:|---:|
| Official `diarize()` fixed 2 | **100% (3/3)** | **81.82% (18/22)** | **0% (0/22)** |
| Two-stage fixed 2 | 100% (3/3) | 36.36% (8/22) | 63.64% (14/22) |

Official short accuracy is 45.45 percentage points above two-stage and is just below the 85% target. Its result is consistent with the earlier 16 kHz one-stage baseline. The official pipeline has no native UNKNOWN output; skipped short VAD intervals are assigned by its own nearest/merged timeline behavior, so UNKNOWN is reported as zero per the evaluation contract.

This isolates the current regression to the two-stage behavior after the shared VAD/embedding path: the public pipeline's smoothing and short-segment fallback recover labels that the two-stage frozen-centroid threshold path rejects. It does not prove that all of the gap comes from one line; official inference also performs its own clustering and temporal smoothing.

Files:

- `official_diarize.json`: direct public API result in the common artifact shape.
- `official_diarize.rttm`: `DiarizeResult.to_rttm()` output.
- `evaluation/`: comparison using the existing two-stage output and derived clip Gold.
- `../vocals_fixed2_16k_01/two_stage/`: unchanged two-stage artifact used as the other method.

No threshold or production default was changed. No full-film inference was run.
