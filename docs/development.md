# Development Workflow

This project uses one writable implementation task at a time.

## Conversation Roles

```text
Main implementation conversation:
  may edit the main worktree

Review conversation:
  read-only code and diff review

Data-analysis conversation:
  read-only Gold/result analysis
```

Do not let multiple conversations edit the same main worktree concurrently.

After a stable baseline commit exists, truly parallel implementation may use separate Git worktrees and branches. Each worktree must own a different subsystem and use different experiment output directories.

## Task Boundary

Each writable task must define:

```text
baseline commit
one subsystem
allowed files
forbidden files
API budget
validation commands
Gold metric that must not regress
```

Subsystems:

- normalization
- scene generation
- Gemini inference
- Gold evaluation
- extraction
- documentation/baseline maintenance

Do not combine algorithm changes, default changes, cleanup, and documentation restructuring in one task.

## Experiment Rules

Experiments must not overwrite production results.

Use a unique directory such as:

```text
sub/intermediate/<project>/experiments/2026-07-20_anchor-ab/
```

Record at least:

```json
{
  "baseline_commit": "<hash>",
  "model": "gemini-3.5-flash",
  "input_srt": "normalized.srt",
  "scene_json": "scene_segments.json",
  "prompt_flags": {},
  "batching_flags": {},
  "purpose": "short description"
}
```

Generated result directories are local and ignored by Git. Keep the final report for each meaningful A/B until its conclusion is documented.

## Change Gate

For Gemini behavior changes:

1. Compile and inspect dumped prompt.
2. Run `--plan-only`.
3. Run the representative regression scenes.
4. Evaluate against Gold.
5. Run full-film evaluation only if representative subsets do not regress materially.
6. Change a production default in a separate small task after the experiment is accepted.

For scene changes:

1. Run `scene_segmenter.py --llm-plan-only`.
2. Use a unique output directory.
3. Verify full idx coverage.
4. Compare downstream Gemini accuracy, not only scene aesthetics.

For normalization changes:

1. Do not modify Gemini or scene code in the same task.
2. Compare normalized entries structurally.
3. Preserve Gold/manual timeline corrections.
4. Re-run downstream plan checks before paid API calls.

## Commit Strategy

Create small commits after the migration baseline:

```text
baseline migration
normalization fix
scene fix
Gemini fix
evaluation fix
```

Do not mix unrelated generated files or private project media into commits.
