# Voice Evaluation

| Method | Long purity | Short accuracy | Short UNKNOWN |
|---|---:|---:|---:|
| one-stage | 100.00% | 81.82% | 0.00% |
| two-stage | 100.00% | 36.36% | 63.64% |

Acceptance passed: False

Same VAD samples for both methods. UNKNOWN counts as incorrect. Mapping uses long evidence only.

## one-stage

Excluded: {"no_gold_overlap": 0, "ambiguous_speaker": 0}
Long: 3/3; short: 18/22

| Cluster | Gold | Samples | Purity |
|---|---|---:|---:|
| SPEAKER_00 | Iroha | 2 | 100.00% |
| SPEAKER_01 | Kaguya | 1 | 100.00% |

## two-stage

Excluded: {"no_gold_overlap": 0, "ambiguous_speaker": 0}
Long: 3/3; short: 8/22

| Cluster | Gold | Samples | Purity |
|---|---|---:|---:|
| SPEAKER_00 | Iroha | 2 | 100.00% |
| SPEAKER_01 | Kaguya | 1 | 100.00% |
