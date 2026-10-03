# Fixed Two-Speaker Comparison

Same 62-second vocal input, Gold cues 217..234, and +799-second movie offset as vocals_auto_01. Both methods used --speakers 2. All other options stayed unchanged (long minimum 3 seconds, short threshold 0.5). Audio and source Gold hashes match the previous run; original Gold bytes were verified unchanged.

| Method | Long purity | Short accuracy | Short UNKNOWN | Runtime |
|---|---:|---:|---:|---:|
| One-stage, auto | 2/3 = 66.67% | 12/22 = 54.55% | 0/22 = 0% | 8.38 s |
| Two-stage, auto | 3/3 = 100% | 7/22 = 31.82% | 8/22 = 36.36% | 13.07 s |
| One-stage, fixed 2 | 3/3 = 100% | 13/22 = 59.09% | 0/22 = 0% | 11.35 s |
| Two-stage, fixed 2 | 3/3 = 100% | 7/22 = 31.82% | 8/22 = 36.36% | 11.88 s |

Both fixed-count runs produced exactly two clusters. Two-stage maps SPEAKER_00 to Iroha and SPEAKER_01 to Kaguya; baseline numbering is reversed. No samples were excluded.

Two-stage short accuracy trails fixed-count baseline by 27.27 percentage points. Only long purity passes the four acceptance gates. This metric still rests on just three long VAD samples.

After mapping anonymous clusters to Gold roles, all 22 two-stage short predictions are unchanged from automatic mode, including eight UNKNOWN samples. Fixing the speaker count removes fragmentation but does not solve the observed short-assignment problem on this fixture. This does not establish the underlying cause; inspect short-window scores, VAD boundaries and audio/Gold timing before changing thresholds or algorithms.

Commands, hashes, timebase assumptions and runtimes: experiment.json. Per-VAD predictions: evaluation/voice_evaluation.json. No production defaults changed and no full-film inference was run.
