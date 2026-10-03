# Voice Backend

## External Package

The optional acoustic backend is [`FoxNoseTech/diarize`](https://github.com/FoxNoseTech/diarize), currently pinned as:

```text
diarize==0.1.2
```

It uses Silero VAD, WeSpeaker embeddings, speaker-count estimation, and spectral clustering. It is CPU-only, Apache-2.0 licensed, and returns anonymous `SPEAKER_XX` segments.

## Environment

The package is currently installed in the main `env` because the repository no longer uses its former NeMo/pyannote/Demucs stack. Its package metadata requires:

```text
torch>=1.13,<2.9
torchaudio>=0.13,<2.9
```

Installation replaced the previous CUDA Torch 2.9.1 installation with CPU Torch/Torchaudio 2.8.0. `diarize` is CPU-only. If GPU Torch is needed for a future unrelated component, move the voice backend to a separate environment rather than adding another Torch version to this environment.

## Role In The Current Workflow

```text
normalized.srt
  ├─> DeepSeek scenes
  │     └─> Gemini character labels
  └─> voice/diarize_example.py
        └─> anonymous acoustic timeline
```

The voice backend is independent evidence. It must not directly replace Gemini labels, assign anonymous clusters to characters without validation, or change normalized subtitles.

## First Integration Milestones

1. Implement the two-stage anonymous clustering adapter specified in `docs/design/voice/two_stage_diarization.md`.
2. Validate it on a short audio fixture before any full-film run.
3. Implement the simplified Gold evaluation in `docs/design/voice/evaluation.md`.
4. Compare the two-stage result with the original one-stage `diarize()` baseline.
5. Consider subtitle alignment only after the two-stage acceptance gates pass.

Do not build automatic cluster-to-character mapping until these checks show stable project-specific value.

The implementation task is packaged for another session in `docs/design/voice/implementation_handoff.md`.
