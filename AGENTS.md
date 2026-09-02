# AGENTS.md

## Project Purpose

This repository is a subtitle-driven multimodal speaker-labeling toolkit for the `Cosmic Princess Kaguya` project. It is not a general Whisper/NeMo diarization project.

Primary goals:

- Normalize SDH subtitles.
- Generate editable semantic scene timelines with DeepSeek-style text LLMs.
- Use Gemini-style multimodal models to assign one speaker per subtitle entry.
- Evaluate model output against a structurally edited Gold Set.
- Export clean speaker-labeled SRT files and role-specific media clips.

## Stable Baseline

Read these before changing production behavior:

- `docs/CURRENT.md` - short current-state contract and next work item.
- `docs/workflow.md` - operational commands.
- `docs/design/scene_segmentation.md` - DeepSeek scene behavior.
- `docs/design/prompt.md` - Gemini prompt contract.
- `docs/reference/evaluation.md` - Gold alignment and metrics.

Do not change production defaults from a single local result. Run the representative regression set first, then Gold evaluation. Record experimental flags explicitly instead of silently changing defaults.

## Protected Paths

Do not delete, rename, or bulk-modify these without explicit user approval:

- `env/` - local Python environment.
- `sub/input/` - source media, source subtitles, aliases, role descriptions, references.
- `sub/intermediate/` - normalized subtitles, Gold Set, scene timelines, model results.
- `sub/llm/config.json`, `sub/llm/gemini_config.json`, `sub/llm/.env` - private local configuration.

Generated output under `sub/output/` can be regenerated, but ask before deleting large exports.

## Production Modules

- `sub/normalize/normalize_sdh.py` - source SDH subtitle to `normalized.srt` / JSONL.
- `sub/normalize/normalize_mkv.py` - inspect, extract, and policy-filter MKV text subtitle tracks into candidate normalized files.
- `sub/llm/scene_segmenter.py` - DeepSeek semantic scene generation and refine.
- `sub/llm/scene_srt_to_json.py` - edited scene SRT to strict scene JSON.
- `sub/llm/gemini_segment_diarize.py` - scene-level multimodal speaker labeling.
- `sub/llm/evaluate_gemini_gold.py` - structure-aware Gold evaluation.
- `sub/extract_simple.py` - role-specific media export.
- `sub/_srt_io.py`, `sub/project_io.py` - shared subtitle and project I/O.
- `voice/` - optional isolated acoustic diarization backend; not part of the production label path yet.

## Supporting And Experimental Modules

- `sub/llm/diarize_llm.py` - older text-LLM workflow plus shared config/role helpers.
- `sub/llm/gemini_video_verify.py` - targeted multimodal verification experiment.
- `sub/llm/target_verify_ab.py` - target verification A/B experiment.
- `sub/llm/gemini_multimodal_diarize.py` - older multimodal workflow, not the production entry point.
- `scripts/ocr_batch.py` - auxiliary OCR utility.
- `voice/diarize_example.py` - PyPI `diarize` smoke/example wrapper.

Experimental modules must not change production defaults or write into production result directories unless explicitly requested.

The optional voice backend currently uses the main environment's CPU Torch 2.8.x stack because legacy GPU/NeMo consumers were removed. If a future component needs another Torch range, isolate that component rather than changing this environment casually. Voice anonymous clusters are auxiliary evidence, not canonical speaker labels.

The optional voice backend must use an isolated environment because its pinned Torch range conflicts with the main environment. Its anonymous clusters are auxiliary evidence, not canonical speaker labels.

## Current Behavioral Contracts

- Production Gemini input defaults to `normalized.srt`; `llm_corrected.srt` is fallback only.
- DeepSeek owns semantic scene boundaries. Python does not mechanically split production scenes by entry count.
- Gemini outputs one speaker per subtitle entry. New output must not use `OVERLAP`.
- `OTHER` writes `speaker_raw` to final SRT; `NONSPEECH` and `?` are preserved as model decisions.
- Prompt anchors and output locks default to `none`. Use `canonical` or `all` only for audited source labels.
- Final SRT is clean `[Speaker] text` unless `--keep-tags` is explicitly requested.
- Scene titles are editing metadata, not speaker evidence.

## Development Discipline

- One writable task at a time in the main worktree.
- Other concurrent conversations should be read-only reviews or data analysis.
- Use a Git worktree and separate branch for truly parallel implementation, after a stable baseline commit exists.
- One task should modify one subsystem: normalization, scenes, Gemini, evaluation, or extraction.
- Do not combine algorithm changes, default changes, directory cleanup, and documentation restructuring in one task.
- API experiments must use a unique output directory and record model, prompt options, scene JSON, input SRT, and baseline commit.
- Do not delete old experiment results unless the user explicitly approves the exact directories.

## Validation

For Python changes, at minimum run:

```powershell
env\python.exe -m py_compile <changed-python-files>
```

For scene changes, run without API calls first:

```powershell
env\python.exe sub\llm\scene_segmenter.py "Cosmic Princess Kaguya" --llm-plan-only
```

For Gemini changes, run a request plan first:

```powershell
env\python.exe sub\llm\gemini_segment_diarize.py "Cosmic Princess Kaguya" --segments-json "sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.json" --compact-video --plan-only --max-segments 0 --output-dir "sub/intermediate/Cosmic Princess Kaguya/gemini_plan_check"
```

Use `--prepare-only` before paid API calls when media construction changed. Use `evaluate_gemini_gold.py` for any claimed accuracy change.
