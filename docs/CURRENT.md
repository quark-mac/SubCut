# Current Stable State

> Baseline candidate prepared 2026-07-20. This file is the short contract for new development conversations.

## Production Pipeline

```text
source ASS / SDH
  -> sub/normalize.py
  -> normalized.srt
  -> sub/llm/scene_segmenter.py
  -> scene_segments_llm/scene_segments.json
  -> sub/llm/gemini_segment_diarize.py
  -> results.jsonl + segment_labeled.srt
  -> sub/llm/evaluate_gemini_gold.py
  -> Gold metrics
```

Manual scene edits use `scene_srt_to_json.py`. Role clip export uses `extract_simple.py`.

## Stable Inputs And Results

```text
Production subtitle input:
sub/intermediate/Cosmic Princess Kaguya/normalized.srt

Gold Set:
sub/intermediate/Cosmic Princess Kaguya/gold_set.srt

Production scene JSON:
sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.json

Current single-scene evaluation:
sub/intermediate/Cosmic Princess Kaguya/gemini_single_scene_full/
```

Gold Set contains 2104 cues and includes manual timeline fixes, merges, and splits. `normalized.srt` contains 2106 entries. Evaluation must align by timestamp and normalized text; do not compare by shifted idx alone.

## Current Measured Baseline

Current full single-scene Gemini run:

```text
requests: 164
target/results entries: 2106 / 2106
missing/duplicate/parse errors: 0
forbidden OVERLAP outputs: 0
raw Gold accuracy: 1921/2104 = 91.30%
canonical accuracy: 91.57%
main-character accuracy: 92.03%
Mami/Roka: 77.66%
Koto: 100.00%
Otaku as OTHER: 95.08%
FUSHI semantic variants: 75.00%
```

The corrected final SRT has the same 91.30% Gold accuracy as raw results. The earlier writer bug that discarded `OTHER` decisions is fixed.

These numbers are model/project-specific evidence, not a general benchmark.

## Current Production Defaults

Gemini:

```text
input SRT: normalized.srt
scene input: --segments-json is required for labeling; report-only is exempt
existing clips: fail unless --overwrite-clips; prefer a clean output directory
partial runs: explicit clean output directory required; overwrite cannot bypass
OVERLAP: forbidden
explicit anchor: none
explicit output lock: none
final OTHER: speaker_raw identity
keep-tags: preserve input tags only; no MM_* status tags
code-default grouping: up to 2 scenes / 30 entries / 90 seconds
```

The best measured full run used explicit `1 scene/request` flags and reached 91.30%. That result has not yet been promoted to the CLI default because it also used the current prompt/output changes and was not a pure grouping-only A/B.

Scene generation:

```text
DeepSeek semantic boundaries
default refine max seconds: 75
entry-count budget refine: disabled
Python mechanical scene splitting: disabled
```

The 30-entry/90-second forced scene-refine experiment reduced Gold accuracy from 94.87% to 92.95% on the affected sample and is not the production default.

## Known Weak Areas

- Yachiyo narration can collapse into Kaguya within a scene.
- Mami/Roka still swap on short or visually ambiguous lines.
- FUSHI system/tutorial voice continuity remains inconsistent.
- NONSPEECH recall is weak when model-only output is used.
- Named multi-speaker Gold cues are difficult after removing `OVERLAP`.
- Normalization expands multi-speaker blocks with shared source timing; source-label errors, duplicate short fragments, and some source timeline errors remain.
- Normalization does not inherit unlabeled speaker identities; unlabeled dialogue remains `[?]` for Gemini.

See `docs/reference/current_issues.md` for details.

## Frozen Decisions

Do not change these without a dedicated Gold A/B task:

- Do not re-enable Gemini `OVERLAP`.
- Do not enable prompt anchors or output locks by default.
- Do not mechanically split DeepSeek scenes by entry count.
- Do not use `llm_corrected.srt` as the normal Gemini input.
- Do not claim accuracy from `human.srt`; use `gold_set.srt` and structural alignment.

## Next Recommended Work

Regenerate and structurally review the normalized baseline after the no-inheritance and mixed-speaker changes. Then regenerate the semantic scene timeline because normalized idx values have shifted. Do not modify Gemini behavior in the same task.

Before that task, establish a Git baseline commit for the current repository migration.

## New Conversation Checklist

Provide:

```text
baseline commit hash
single task statement
allowed files
forbidden files
API budget (usually zero initially)
validation command
Gold metric that must not regress
```

Only one conversation writes to the main worktree at a time.
