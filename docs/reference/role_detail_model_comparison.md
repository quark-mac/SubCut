# Role Detail A/B: Gemini 3.6 vs 3.7

## Controlled Setup

- Gold window: `final_gold_set.srt` idx `912-931`, 20 entries.
- Input: same blank speaker SRT; all speaker labels are `[?]` and tags are empty.
- Same compact video, scene JSON, role list and media parameters.
- Three requests per role-detail variant.
- Only role-detail variant changes within a model.
- Parse-invalid responses are excluded from accuracy, not counted as speaker errors.

## Gemini 3.6

| Variant | Run accuracies | Mean | Majority |
|---|---|---:|---:|
| `baseline` | 65%, 70%, 65% | 66.7% | 65% |
| `selected` (age/gender) | 70%, 70%, 70% | 70.0% | 65% |
| `full` | 70%, 60%, 60% | 63.3% | 60% |

Earlier 3.6 component tests used more repetitions and additional windows; across five windows age/gender was only mildly positive with high variance, while full remained experiment-only.

## Gemini 3.7

| Variant | Run accuracies | Mean | Majority |
|---|---|---:|---:|
| `baseline` | 65%, 65%, 75% | 68.3% | 75% |
| `selected` (age/gender) | 65%, 70%, 75% | 70.0% | 65% |
| `full` | 85%, 75%, 70% | **76.7%** | 75% |

No parse failures occurred in the three 3.7 variants. The full prompt improved the mean over baseline by **+8.3 percentage points** on this window.

## Interpretation

- Prompt-detail effects are model-version dependent.
- `gemini-3.6-flash`: full role context was not beneficial on this window.
- `gemini-3.7-flash`: full role context was best on this window.
- `selected` age/gender was a small positive in both sets, but not the best 3.7 variant.
- Majority voting is diagnostic only; production uses one request, so run means are the primary comparison here.
- This is still one 20-entry window and three calls per arm. It does not justify changing production defaults.

Artifacts:

```text
sub/intermediate/Cosmic Princess Kaguya/role_detail_ab_gemini37_flash/
  role_detail_ab_summary.json
```

Production default remains `--role-detail baseline` until Gemini 3.7 is tested on the broader five-window suite.

## Gemini 3.7 Five-Window Regression

The same three variants were then tested three times on each of five preselected, non-overlapping 20-entry Gold windows (100 distinct entries total):

| Gold window | Baseline | Selected | Full | Selected delta | Full delta |
|---|---:|---:|---:|---:|---:|
| 912-931 | 68.3% | 70.0% | 76.7% | +1.7 pp | +8.3 pp |
| 1163-1182 | 68.3% | 71.7% | 63.3% | +3.3 pp | -5.0 pp |
| 1287-1306 | 66.7% | 78.3% | 75.0% | +11.7 pp | +8.3 pp |
| 1682-1701 | 78.3% | 75.0% | 55.0% | -3.3 pp | -23.3 pp |
| 2040-2059 | 78.3% | 75.0% | 75.0% | -3.3 pp | -3.3 pp |
| **All 15 runs** | **72.0%** | **74.0%** | **69.0%** | **+2.0 pp** | **-3.0 pp** |

All 45 requests returned complete, parseable predictions.

### Decision

- `full` is not suitable as a Gemini 3.7 production default. Its single-window gain did not generalize and it produced the largest regression in window `1682-1701`.
- `selected` has a small aggregate gain (+2.0 points) but regresses in two of five windows. It remains an experiment mode rather than a default.
- The configured production model is currently Gemini 3.6, so these Gemini 3.7 measurements must not silently alter its baseline prompt.
- Promote any role-detail mode only after a representative full Gold evaluation using the intended production model.

Machine-readable result:

```text
sub/intermediate/Cosmic Princess Kaguya/role_detail_ab_gemini37_flash/five_window_role_detail_summary.json
```
