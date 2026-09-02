# Role Description Component A/B

## Setup

- Model: `gemini-3.6-flash`
- Input: `final_gold_set.srt` converted to `[?]` with empty tags
- Primary component window: Gold idx `912-931`, 20 difficult entries
- Repetitions: 5 per component
- Components were added independently to the old selected prompt
- Parse-invalid responses were excluded as failed requests, not scored as 0%

Experiment output:

```text
sub/intermediate/Cosmic Princess Kaguya/role_component_ab/
```

## Single Components

| Variant | Valid run accuracy | Mean | Majority |
|---|---|---:|---:|
| Old baseline | 65%, 70%, 65%, 60% | 65% | 13/20 |
| Story context | 50%, 70%, 60%, 70%, 75% | 65% | 13/20 |
| Age + gender | 75%, 70%, 70%, 80%, 65% | **72%** | **14/20** |
| Full visual cues | 70%, 70%, 70%, 60%, 65% | 67% | 13/20 |
| Forms | 60%, 80%, 75%, 70%, 65% | 70% | 14/20 |

One baseline request returned malformed JSON and was excluded.

## Combination Check

| Variant | Five-run mean | Majority |
|---|---:|---:|
| Age/gender + forms | 70% | 14/20 |
| Age/gender + forms + visual cues | 70% | 15/20 |

Adding forms or visual cues to demographics did not improve mean accuracy. Majority voting is not a production behavior, so the higher 15/20 majority does not justify retaining full visual cues.

## Cross-Window Regression

Age/gender was retested on two additional ensemble windows, three runs per arm:

| Gold window | Baseline mean | Age/gender mean | Delta |
|---|---:|---:|---:|
| 912-931 | 65.0% | 72.0% | +7.0 pp |
| 1682-1701 | 48.3% | 56.7% | +8.3 pp |
| 2040-2059 | 46.7% | 53.3% | +6.7 pp |

Across all valid runs, age/gender improved the run-level mean from 54.5% to 62.7% (+8.23 pp).

## Additional Windows

To test whether the demographics gain generalized, two additional non-overlapping windows were selected before inference using cast diversity, mixed gender, short utterances, and duration criteria:

| Gold window | Baseline mean | Age/gender mean | Delta |
|---|---:|---:|---:|
| 1163-1182 | 70.0% | 70.0% | 0.0 pp |
| 1287-1306 | 76.7% | 66.7% | **-10.0 pp** |

Across all five windows:

- Positive windows: 3
- Neutral windows: 1
- Negative windows: 1
- Five-window macro baseline: 61.3%
- Five-window macro age/gender: 63.7%
- Macro delta: +2.4 percentage points
- All valid run decisions: 61.56% -> 64.71% (+3.14 points)

The negative window included regressions where Koto was changed to `OTHER`, Mikado's short laugh was assigned to Yachiyo, and short reactions shifted toward Kaguya. The effect is therefore not stable enough for a production-default change.

Machine-readable expanded results:

```text
sub/intermediate/Cosmic Princess Kaguya/role_component_ab/five_window_demographics.json
```

## Decision

- Keep the old baseline role prompt as the production default.
- Keep `age` and `gender` available through `--role-detail selected` or `--role-extra demographics` for experiments.
- Do not include full story context by default.
- Do not include the full `visual_cues` arrays by default.
- Do not include `forms` by default; its single-component gain did not survive combination testing.
- Keep all components available through `--role-extra` and retain `--role-detail full` for experiments.
- Preserve the old prompt as `--role-detail baseline` for future regression tests.

This is a targeted 100-entry, five-window repeated regression, not a full-film evaluation. A full representative Gold regression is required before promoting any role component to the production default.
