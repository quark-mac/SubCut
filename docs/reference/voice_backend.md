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

1. Install and import the pinned package in `env`.
2. Run it on a short known single-speaker WAV.
3. Run it on the full extracted movie audio without changing its timebase.
4. Save a project-specific JSON contract with model/package version and input hash.
5. Align acoustic segments to subtitle idx by time overlap.
6. Measure whether acoustic continuity predicts Gemini errors on Gold Set.

Do not build automatic cluster-to-character mapping until these checks show stable project-specific value.
