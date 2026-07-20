# Cosmic Princess Kaguya Speaker Labeling

Subtitle-driven multimodal speaker labeling toolkit for the `Cosmic Princess Kaguya` project.

This working tree no longer uses the original Whisper/NeMo diarization pipeline. The current flow starts from SDH subtitles, creates semantic scenes with a text LLM, labels speakers from video/audio with Gemini, and evaluates against a structurally edited Gold Set.

## Start Here

- [`docs/CURRENT.md`](docs/CURRENT.md) - current stable contract, measured baseline, frozen decisions, next task.
- [`docs/workflow.md`](docs/workflow.md) - operational PowerShell commands.
- [`docs/README.md`](docs/README.md) - full documentation index.

## Production Pipeline

```text
source subtitle
  -> sub/normalize.py
  -> normalized.srt
  -> sub/llm/scene_segmenter.py
  -> scene_segments.json
  -> sub/llm/gemini_segment_diarize.py
  -> results.jsonl + labeled SRT
  -> sub/llm/evaluate_gemini_gold.py
  -> Gold evaluation
```

Core scripts:

- `sub/normalize.py`
- `sub/llm/scene_segmenter.py`
- `sub/llm/scene_srt_to_json.py`
- `sub/llm/gemini_segment_diarize.py`
- `sub/llm/evaluate_gemini_gold.py`
- `sub/extract_simple.py`

## Quick Checks

Compile production scripts:

```powershell
env\python.exe -m py_compile `
  sub\normalize.py `
  sub\llm\scene_segmenter.py `
  sub\llm\scene_srt_to_json.py `
  sub\llm\gemini_segment_diarize.py `
  sub\llm\evaluate_gemini_gold.py `
  sub\extract_simple.py
```

Inspect DeepSeek request planning without API calls:

```powershell
env\python.exe sub\llm\scene_segmenter.py "Cosmic Princess Kaguya" --llm-plan-only
```

Inspect Gemini request planning without API calls:

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py `
  "Cosmic Princess Kaguya" `
  --segments-json "sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.json" `
  --compact-video `
  --plan-only `
  --max-segments 0 `
  --output-dir "sub/intermediate/Cosmic Princess Kaguya/gemini_plan_check"
```

## Local Data And Configuration

The following are local and ignored by Git:

- `env/`
- `sub/intermediate/`
- `sub/output/`
- source media and subtitle files under `sub/input/`
- `sub/llm/config.json`
- `sub/llm/gemini_config.json`
- `sub/llm/.env`

Use the sample configuration files under `sub/llm/`. Do not commit API keys.

## Development

Only one conversation should write to the main worktree at a time. Use read-only conversations for reviews and data analysis. Use a separate Git worktree and branch for parallel implementation only after a stable baseline commit exists.

See [`AGENTS.md`](AGENTS.md) for repository rules.
