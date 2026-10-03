# Voice Evaluation

| Method | Long purity | Short accuracy | Short UNKNOWN |
|---|---:|---:|---:|
| one-stage | 100.00% | 59.09% | 0.00% |
| two-stage | 100.00% | 31.82% | 36.36% |

Acceptance passed: False

Same VAD samples for both methods. UNKNOWN counts as incorrect. Mapping uses long evidence only.

## one-stage

Excluded: {"no_gold_overlap": 0, "ambiguous_speaker": 0}
Long: 3/3; short: 13/22

| Cluster | Gold | Samples | Purity |
|---|---|---:|---:|
| SPEAKER_00 | Kaguya | 1 | 100.00% |
| SPEAKER_01 | Iroha | 2 | 100.00% |

## two-stage

Excluded: {"no_gold_overlap": 0, "ambiguous_speaker": 0}
Long: 3/3; short: 7/22

| Cluster | Gold | Samples | Purity |
|---|---|---:|---:|
| SPEAKER_00 | Iroha | 2 | 100.00% |
| SPEAKER_01 | Kaguya | 1 | 100.00% |
