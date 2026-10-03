# Official Diarization Research

## Current Baseline

The supported voice path is `voice/diarize_example.py`, which directly calls `diarize.diarize()` from installed `diarize==0.1.2`. The removed two-stage adapter was materially worse on the controlled fixture and is not part of the workflow.

On the 62-second 16 kHz vocal fixture with `num_speakers=2`, official diarize reached 81.82% short assignment accuracy (18/22), versus 36.36% for the removed adapter. The fixture is too small to claim production quality.

## Findings

1. Always provide 16 kHz audio to avoid the installed `wespeakerruntime` frontend bug: it resamples non-16-kHz input but passes the original sample rate to Kaldi fbank. This is an environment/package defect; do not patch `site-packages` casually.
2. Fixed speaker count is preferable when a reliable count is known. On the fixture, fixed 2 improved official short accuracy from the automatic-count comparison's 16 kHz baseline only insofar as the official run was already fixed 2; automatic count needs a separate same-input measurement before changing defaults.
3. The official implementation includes temporal Viterbi smoothing, short label-island collapse, and fallback assignment for VAD segments without embeddings. These behaviors explain why it outperformed the removed frozen-centroid adapter and should not be reimplemented outside the package without a measured need.
4. The WeSpeaker model is selected with `lang='en'` by the installed `diarize` embedding wrapper even for Japanese speech. This is a research risk, not a demonstrated defect. Candidate Japanese/multilingual models should be evaluated only through a separate controlled experiment.
5. The package's default VAD, embedding windowing, clustering and smoothing parameters are not exposed by `diarize()` at the public API. Improving them requires either an upstream change or an isolated fork; modifying the installed package would make results non-reproducible.
6. The current wrapper output lacks backend version, input hash, VAD evidence, confidence and Gold evaluation metadata. This is an observability limitation, not an identification algorithm defect. A future wrapper can add metadata while preserving official inference.

## Recommended Order

1. Keep the official `diarize()` path as the only production voice algorithm.
2. Normalize all test audio to 16 kHz before inference and record the conversion.
3. Expand the verified same-timebase Gold fixture to several excerpts with both speakers and non-speech/overlap cases.
4. Measure official default versus fixed speaker count on those excerpts.
5. Investigate a Japanese or multilingual embedding backend only as an isolated experiment, with no production default change until representative Gold evaluation passes.

No threshold change or full-film run is justified by the current 62-second sample.
