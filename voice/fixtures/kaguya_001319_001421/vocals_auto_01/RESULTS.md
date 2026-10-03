# Vocal Clip Automatic-Count Experiment

Input: `../scene_audio_track1_vocals.wav`, 62.000 seconds, 44100 Hz stereo float PCM.
Movie interval: 00:13:19.000 to 00:14:21.000. Movie seconds = local seconds + 799.
Gold: read-only `final_gold_set.srt` cues 217..234; mechanically shifted copy in `gold_clip_derived.srt`.
Source Gold bytes were verified unchanged. Vocal processing preserved duration; internal separation delay was not independently measured.

No tuning: long minimum 3 seconds, cosine threshold 0.5, automatic speaker range 1..20.
Stage 1: 3 VAD segments / 18 windows. Stage 2: 22 VAD segments / 32 windows.

| Method | Clusters | Long purity | Short accuracy | Short UNKNOWN | Runtime |
|---|---:|---:|---:|---:|---:|
| Original one-stage | 1 | 2/3 = 66.67% | 12/22 = 54.55% | 0/22 = 0% | 8.376 s |
| Two-stage | 5 | 3/3 = 100% | 7/22 = 31.82% | 8/22 = 36.36% | 13.070 s |

No Gold samples were excluded. Short accuracy gain: -22.73 percentage points.
Only the long-purity gate passes on this small sample. Accuracy >=85%, UNKNOWN <=30%, and gain >=5 percentage points all fail.

Two-stage maps four clusters to Iroha and one to Kaguya. The 100% segment-count purity is based on only three long segments and does not penalize speaker fragmentation. Two clusters never dominate a full long segment.
Of fifteen short errors, eight are UNKNOWN and seven map Iroha-majority samples to Kaguya. For example, movie 00:13:39.700..00:13:41.200 covers parts of Iroha's ending reply but maps to Kaguya. The VAD at 00:13:45.100..00:13:46.500 straddles Kaguya's line and Iroha's laugh; Gold overlap assigns its majority to Iroha, while the prediction maps to Kaguya.

These observations do not establish a root cause. A natural next controlled experiment is fixed two-speaker mode for both methods with all other options unchanged. No full-film inference, production integration, or default change is justified.

See `experiment.json` for commands, input hashes and timings; `evaluation/voice_evaluation.json` includes every evaluated VAD sample.
