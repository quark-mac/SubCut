# Current Stable State

> Input baseline confirmed 2026-10-03 against HEAD `c43643f` plus uncommitted work. This file is the short contract for new development conversations.

## Production Pipeline

```text
source ASS / SDH
  -> sub/normalize/normalize_sdh.py
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
sub/intermediate/Cosmic Princess Kaguya/final_gold_set.srt

Historical scene JSON (stale after normalized regeneration; rebuild before use):
sub/intermediate/Cosmic Princess Kaguya/scene_segments_llm/scene_segments.json

Historical single-scene evaluation (deferred):
sub/intermediate/Cosmic Princess Kaguya/gemini_single_scene_full/
```

The sole Gold Set, `final_gold_set.srt`, contains 2085 cues and includes manual timeline fixes, merges, and splits. Its contents were preserved. The obsolete `gold_set.srt` and `gold_set_dedup.srt` were deleted by user request.

Regenerated `normalized.srt` / JSONL contain 2101 entries, including 1270 unknown speakers and zero INHERITED tags. SRT/JSONL round-trip, nonempty text, positive durations, source references and continuous idx were checked. Input/code hashes and the structural changes are recorded locally in `sub/intermediate/Cosmic Princess Kaguya/baseline_confirmation.json`.

Evaluation must align by timestamp and normalized text; do not compare by shifted idx alone. Existing scenes and Gemini runs refer to the old 2106-entry input and are not the baseline for this revision.

The user's current goal is clear attribution of who said what, with clear speech boundaries. Detailed acceptance thresholds remain undecided.

## Historical Measured Baseline — Deferred

Historical full single-scene Gemini run, using the retired 2104-cue Gold:

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

These numbers are historical evidence only. Reproduction against current prompt defaults is deferred by user request; no new accuracy claim accompanies the input refresh.

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
role detail: baseline (old selected fields)
role detail selected/full and role-extra components: experiment-only
code-default grouping: up to 2 scenes / 30 entries / 90 seconds
```

The best measured full run used explicit `1 scene/request` flags and reached 91.30%. That result has not yet been promoted to the CLI default because it also used the current prompt/output changes and was not a pure grouping-only A/B.

Repeated role-component A/B initially showed gains from `age/gender`, but two additional preselected windows produced one tie and one -10 point regression. Across five windows the macro mean gain was only +2.4 points with high window variance, so it was not promoted to the production default. All extra role components remain experiment-only; see `docs/reference/role_component_ab.md`.

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

## Optional Voice Backend

`voice/` contains an optional integration for `diarize==0.1.2`, currently installed in the main `env` after removing unused legacy Torch consumers. It uses CPU Torch/Torchaudio 2.8.0 and produces anonymous acoustic evidence only; it is not part of the production label path yet.

The next voice task is specified, not implemented: long VAD segments (default at least 3 seconds) establish frozen anonymous cluster centroids, then shorter VAD segments are assigned to those clusters or `UNKNOWN`. The output and three-metric evaluation contracts are under `docs/design/voice/`. Full-film inference and Gemini integration wait until those acceptance gates pass.

## Frozen Decisions

Do not change these without a dedicated Gold A/B task:

- Do not re-enable Gemini `OVERLAP`.
- Do not enable prompt anchors or output locks by default.
- Do not mechanically split DeepSeek scenes by entry count.
- Do not use `llm_corrected.srt` as the normal Gemini input.
- Use `final_gold_set.srt` and structural alignment for future evaluation; `human.srt` is historical reference only.

## Next Recommended Work

Regenerate the semantic scene timeline against the new 2101-entry normalized revision, then inspect the Gemini request plan. Scene generation requires a separately authorized API run; it was not performed during baseline confirmation.

Working-tree changes remain uncommitted. Confirm the intended WIP scope before creating a baseline commit.

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
