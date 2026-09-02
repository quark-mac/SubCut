# Voice Diarization Backend

This directory is an isolated acoustic diarization backend for the subtitle-driven pipeline. It uses the external [`FoxNoseTech/diarize`](https://github.com/FoxNoseTech/diarize) package.

## Status

`diarize==0.1.2` is installed in the repository's current `env`. It requires `torch<2.9` and `torchaudio<2.9`; pip resolved `torch==2.8.0+cpu` and `torchaudio==2.8.0+cpu`. The old NeMo/pyannote/Demucs stack was not used by this repository and was removed before installation. The current voice backend is CPU-only.

## Install

From the repository root:

```powershell
env\python.exe -m pip install -r voice\requirements.txt
```

If you need to keep a different Torch/CUDA stack for another project, use a separate Python environment instead. The package's upstream metadata currently resolves Torch 2.8.x on Windows.

## Example

```powershell
env\python.exe voice\diarize_example.py "path\to\audio.wav"
env\python.exe voice\diarize_example.py "path\to\audio.wav" --speakers 4 --output "voice_segments.json"
```

The backend returns anonymous labels such as `SPEAKER_00`. It does not identify project characters and does not model overlapping speech. Do not write its output directly over Gemini labels.

## Output Contract

The example writes:

```json
{
  "audio": "input.wav",
  "duration": 324.5,
  "num_speakers": 3,
  "speakers": ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"],
  "segments": [
    {
      "start": 0.5,
      "end": 4.2,
      "duration": 3.7,
      "speaker": "SPEAKER_00"
    }
  ]
}
```

Keep the source audio timebase unchanged. The output is intended for later alignment with normalized subtitle entries and conflict reporting.

## License

The upstream package is Apache-2.0 licensed. If vendoring or redistributing its source, retain its license and attribution notices. The current integration uses the PyPI package and does not vendor upstream source.
