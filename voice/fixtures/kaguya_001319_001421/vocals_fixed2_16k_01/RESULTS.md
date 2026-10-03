# Fixed Two-Speaker 16 kHz Input Experiment

Original vocal file preserved. Independent derived input: `../scene_audio_track1_vocals_16k.wav`, verified 16000 Hz, stereo, float32 PCM, exactly 62 seconds. No silence removal, tempo change or source separation performed.

Preparation command from repository root:

```powershell
& "env/Library/bin/ffmpeg.exe" -hide_banner -loglevel warning -nostdin -n -i "voice/fixtures/kaguya_001319_001421/scene_audio_track1_vocals.wav" -map 0:a:0 -ar 16000 -c:a pcm_f32le "voice/fixtures/kaguya_001319_001421/scene_audio_track1_vocals_16k.wav"
```

Both methods use --speakers 2; long minimum 3 seconds, cosine threshold 0.5 and all other inference defaults unchanged. No installed-package or production-code changes. This bypasses the installed WeSpeaker bug that resamples non-16-kHz input but passes the original sample rate to Kaldi fbank.

| Input / method | Long purity | Short accuracy | Short UNKNOWN |
|---|---:|---:|---:|
| 44.1 kHz one-stage | 3/3 = 100% | 13/22 = 59.09% | 0/22 = 0% |
| 44.1 kHz two-stage | 3/3 = 100% | 7/22 = 31.82% | 8/22 = 36.36% |
| 16 kHz one-stage | 3/3 = 100% | 18/22 = 81.82% | 0/22 = 0% |
| 16 kHz two-stage | 3/3 = 100% | 8/22 = 36.36% | 14/22 = 63.64% |

Two-stage runtime 11.737 seconds; one-stage 11.124 seconds. Gold source bytes verified unchanged. Commands and hashes are in experiment.json. No Gold exclusions.

All eight accepted two-stage short VAD predictions are correct at the evaluator's duration-majority level; fourteen UNKNOWNs account for every remaining short error. This is not an 100% overall short accuracy claim: UNKNOWNs remain in the denominator. Fixed-count two-stage short accuracy trails its 16-kHz baseline by 45.45 percentage points. Only the long-purity acceptance gate passes, on merely three long VADs.

Comparison caveat: resampling also slightly affects VAD. Local long interval 29.3..33.4 becomes 29.3..33.2, and short interval 48.2..49.6 becomes 48.2..49.5. Sample counts remain 3 long / 22 short; long windows change from 18 to 17, short windows stay 32. This end-to-end comparison supports a material input-frontend effect but is not an isolated embedding-only causal experiment.

Next diagnostic: examine both-centroid short scores and rejection/coverage before proposing a threshold change. The 0.5 threshold was experimental, not calibrated; any tuning on this clip needs separate validation. No further threshold runs performed here.
