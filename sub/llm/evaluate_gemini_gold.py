from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sub._srt_io import NormalizedEntry, parse_srt, seconds_to_srt_time
from sub.llm.diarize_llm import CANONICAL_SPEAKERS


MAIN_SPEAKERS = frozenset({"Iroha", "Kaguya", "Yachiyo", "FUSHI"})
CONFIDENCE_VALUE = {"high": 0.9, "mid": 0.6, "low": 0.3}
INTERJECTION_RE = re.compile(
    r"^(?:[ぁ-んァ-ンーっッ~～…\.・!！?？、, ]{1,12}|"
    r"(?:あ|え|お|う|ん|は|へ|ひ|ふ|ほ|わ|や|よ|む|ぐ|く|ハ|ヘ|ヒ|フ|ホ|"
    r"ア|エ|オ|ウ|ン|ワ|ヤ|ヨ|イェーイ|オッケー|マジ|えー|はーい)[ぁ-んァ-ンーっッ~～…\.・!！?？、, ]*)$"
)


@dataclass
class Prediction:
    idx: int
    start: float
    end: float
    text: str
    speaker: str
    speaker_raw: str
    confidence: str
    input_speaker: str
    tags: list[str]


@dataclass
class Match:
    gold: NormalizedEntry
    prediction: Prediction | None
    method: str
    candidates: list[Prediction]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate Gemini JSONL against a structurally edited Gold SRT.")
    parser.add_argument("results", type=Path)
    parser.add_argument("gold", type=Path)
    parser.add_argument("--final-srt", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--json-output", type=Path)
    parser.add_argument("--errors", type=int, default=40)
    return parser.parse_args()


def _normalized_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\\N", "").replace("\n", "")
    return re.sub(r"\s+", "", text)


def _one_line(text: str) -> str:
    return text.replace("\n", "\\N")


def _prediction_label(speaker: str) -> str:
    label = speaker.strip()
    if label.startswith("NONSPEECH"):
        return "NONSPEECH"
    if label == "DOGE" or label.startswith("FUSHI"):
        return "FUSHI"
    if label in CANONICAL_SPEAKERS or label in {"?", "OTHER"}:
        return label
    if "&" in label or label in {"2人", "3人"}:
        return label
    return "OTHER"


def _overlap_seconds(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def _overlap_ratio(gold: NormalizedEntry, pred: Prediction) -> float:
    overlap = _overlap_seconds(gold.start, gold.end, pred.start, pred.end)
    return overlap / max(0.001, min(gold.end - gold.start, pred.end - pred.start))


def _load_raw(path: Path) -> list[Prediction]:
    predictions: list[Prediction] = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        results = {
            int(result["idx"]): result
            for result in record.get("results", [])
            if isinstance(result, dict) and str(result.get("idx", "")).isdigit()
        }
        for entry in record.get("entries", []):
            idx = int(entry["idx"])
            result = results.get(idx, {})
            predictions.append(Prediction(
                idx=idx,
                start=float(entry["start"]),
                end=float(entry["end"]),
                text=str(entry.get("text", "")),
                speaker=_prediction_label(str(result.get("speaker", "?"))),
                speaker_raw=str(result.get("speaker_raw", result.get("speaker", "?"))),
                confidence=str(result.get("confidence", "unknown")).lower(),
                input_speaker=str(entry.get("speaker_in_srt", "?")),
                tags=list(entry.get("tags", [])),
            ))
    return predictions


def _load_srt_predictions(path: Path) -> list[Prediction]:
    return [
        Prediction(
            idx=entry.idx,
            start=entry.start,
            end=entry.end,
            text=entry.text,
            speaker=_prediction_label(entry.speaker),
            speaker_raw=entry.speaker,
            confidence="unknown",
            input_speaker=entry.speaker,
            tags=list(entry.tags),
        )
        for entry in parse_srt(path)
    ]


def _align(gold: list[NormalizedEntry], predictions: list[Prediction]) -> tuple[list[Match], list[Prediction]]:
    exact: dict[tuple[int, int, str], list[Prediction]] = defaultdict(list)
    for pred in predictions:
        exact[(round(pred.start * 1000), round(pred.end * 1000), _normalized_text(pred.text))].append(pred)

    matches: list[Match] = []
    used_prediction_ids: set[int] = set()
    unresolved: list[int] = []
    for gold_pos, entry in enumerate(gold):
        key = (round(entry.start * 1000), round(entry.end * 1000), _normalized_text(entry.text))
        candidates = exact.get(key, [])
        available = [pred for pred in candidates if id(pred) not in used_prediction_ids]
        if len(available) == 1:
            pred = available[0]
            used_prediction_ids.add(id(pred))
            matches.append(Match(entry, pred, "exact_timestamp_text", [pred]))
        else:
            matches.append(Match(entry, None, "unmatched", []))
            unresolved.append(gold_pos)

    # Unique normalized text plus real time overlap is the first fallback.
    remaining_by_text: dict[str, list[Prediction]] = defaultdict(list)
    unresolved_by_text: dict[str, list[int]] = defaultdict(list)
    for pred in predictions:
        if id(pred) not in used_prediction_ids:
            remaining_by_text[_normalized_text(pred.text)].append(pred)
    for pos in unresolved:
        unresolved_by_text[_normalized_text(gold[pos].text)].append(pos)
    for text, positions in unresolved_by_text.items():
        candidates = remaining_by_text.get(text, [])
        if len(positions) == 1 and len(candidates) == 1:
            pos = positions[0]
            pred = candidates[0]
            if _overlap_seconds(gold[pos].start, gold[pos].end, pred.start, pred.end) > 0:
                matches[pos] = Match(gold[pos], pred, "unique_text_time_overlap", [pred])
                used_prediction_ids.add(id(pred))

    # Structural edits may merge or split cue text. Reuse is allowed here and is reported.
    for pos in unresolved:
        if matches[pos].prediction is not None:
            continue
        entry = gold[pos]
        gold_text = _normalized_text(entry.text)
        candidates: list[Prediction] = []
        for pred in predictions:
            pred_text = _normalized_text(pred.text)
            if _overlap_seconds(entry.start, entry.end, pred.start, pred.end) <= 0:
                continue
            if gold_text == pred_text or (gold_text and gold_text in pred_text) or (pred_text and pred_text in gold_text):
                candidates.append(pred)
        if candidates:
            candidates.sort(key=lambda pred: (
                _overlap_ratio(entry, pred),
                -abs((entry.start + entry.end) - (pred.start + pred.end)),
                -abs(len(gold_text) - len(_normalized_text(pred.text))),
            ), reverse=True)
            best = candidates[0]
            method = "structural_text_containment_overlap"
            matches[pos] = Match(entry, best, method, candidates)
            used_prediction_ids.add(id(best))

    unmatched_predictions = [pred for pred in predictions if id(pred) not in used_prediction_ids]
    return matches, unmatched_predictions


def _gold_target(speaker: str) -> tuple[str, set[str], str]:
    label = speaker.strip()
    if label.startswith("NONSPEECH"):
        return "NONSPEECH", {"NONSPEECH"}, "nonspeech"
    if label == "DOGE" or label.startswith("FUSHI"):
        return "FUSHI", {"FUSHI"}, "canonical"
    if label in CANONICAL_SPEAKERS:
        return label, {label}, "canonical"
    if "&" in label:
        participants = {part.strip() for part in label.split("&") if part.strip()}
        accepted = {part for part in participants if part in CANONICAL_SPEAKERS}
        accepted.add(label)
        accepted.add("&".join(reversed(label.split("&"))))
        return label, accepted or {"OTHER"}, "combination"
    if label in {"2人", "3人"}:
        return label, {"OTHER", label}, "combination"
    return "OTHER", {"OTHER"}, "other"


def _is_correct(match: Match) -> bool:
    if match.prediction is None:
        return False
    _, accepted, _ = _gold_target(match.gold.speaker)
    return match.prediction.speaker in accepted


def _label_is_correct(gold: NormalizedEntry, predicted: str) -> bool:
    _, accepted, _ = _gold_target(gold.speaker)
    return predicted in accepted


def _ratio(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _metric(numerator: int, denominator: int) -> dict[str, Any]:
    return {"correct": numerator, "total": denominator, "accuracy": _ratio(numerator, denominator)}


def _short_text(text: str) -> bool:
    return len(_normalized_text(text)) <= 5


def _interjection(text: str) -> bool:
    normalized = unicodedata.normalize("NFKC", text).replace("\\N", "").replace("\n", "").strip()
    return bool(INTERJECTION_RE.fullmatch(normalized)) or (_short_text(text) and not re.search(r"[一-龯A-Za-z0-9]", normalized))


def _speaker_metrics(matches: list[Match]) -> dict[str, dict[str, Any]]:
    labels = sorted(CANONICAL_SPEAKERS | {"OTHER", "NONSPEECH"})
    output: dict[str, dict[str, Any]] = {}
    for label in labels:
        support = 0
        tp = 0
        fp = 0
        for match in matches:
            target, accepted, kind = _gold_target(match.gold.speaker)
            pred = match.prediction.speaker if match.prediction else "UNMATCHED"
            is_target = target == label and kind != "combination"
            if is_target:
                support += 1
            if is_target and pred in accepted:
                tp += 1
            elif pred == label and not (label in accepted):
                fp += 1
        output[label] = {
            "precision": _ratio(tp, tp + fp),
            "recall": _ratio(tp, support),
            "support": support,
            "true_positive": tp,
            "false_positive": fp,
        }
    return output


def _calibration(matches: list[Match]) -> dict[str, Any]:
    bins: dict[str, dict[str, Any]] = {}
    total = 0
    weighted_gap = 0.0
    brier_sum = 0.0
    for confidence in ("high", "mid", "low", "unknown"):
        subset = [match for match in matches if match.prediction and match.prediction.confidence == confidence]
        correct = sum(_is_correct(match) for match in subset)
        empirical = _ratio(correct, len(subset))
        nominal = CONFIDENCE_VALUE.get(confidence)
        bins[confidence] = {"count": len(subset), "correct": correct, "accuracy": empirical, "nominal": nominal}
        if nominal is not None:
            total += len(subset)
            weighted_gap += len(subset) * abs((empirical or 0.0) - nominal)
            brier_sum += sum((nominal - float(_is_correct(match))) ** 2 for match in subset)
    return {
        "bins": bins,
        "ece_assuming_high_0.9_mid_0.6_low_0.3": weighted_gap / total if total else None,
        "brier_assuming_high_0.9_mid_0.6_low_0.3": brier_sum / total if total else None,
    }


def _representative_errors(matches: list[Match], limit: int) -> list[dict[str, Any]]:
    errors = [match for match in matches if not _is_correct(match)]
    buckets: dict[str, list[Match]] = defaultdict(list)
    for match in errors:
        target, _, kind = _gold_target(match.gold.speaker)
        pred = match.prediction.speaker if match.prediction else "UNMATCHED"
        if {target, pred} == {"Mami", "Roka"}:
            bucket = "Mami/Roka swap"
        elif target == "Koto" or match.gold.speaker == "オタ公":
            bucket = "Koto/Otaku"
        elif target == "FUSHI":
            bucket = "FUSHI"
        elif kind == "combination":
            bucket = "combination"
        elif target in MAIN_SPEAKERS:
            bucket = target
        elif target in {"OTHER", "NONSPEECH"}:
            bucket = target
        else:
            bucket = "canonical supporting"
        buckets[bucket].append(match)

    selected: list[Match] = []
    bucket_order = ["Mami/Roka swap", "Koto/Otaku", "FUSHI", "combination", "OTHER", "NONSPEECH", "Iroha", "Kaguya", "Yachiyo", "canonical supporting"]
    while len(selected) < limit:
        added = False
        for bucket in bucket_order:
            if buckets[bucket]:
                selected.append(buckets[bucket].pop(0))
                added = True
                if len(selected) == limit:
                    break
        if not added:
            break
    return [
        {
            "gold_idx": match.gold.idx,
            "time": f"{seconds_to_srt_time(match.gold.start)} --> {seconds_to_srt_time(match.gold.end)}",
            "gold": match.gold.speaker,
            "target": _gold_target(match.gold.speaker)[0],
            "predicted": match.prediction.speaker if match.prediction else "UNMATCHED",
            "speaker_raw": match.prediction.speaker_raw if match.prediction else "",
            "confidence": match.prediction.confidence if match.prediction else "",
            "method": match.method,
            "text": match.gold.text.replace("\n", "\\N"),
        }
        for match in selected
    ]


def _evaluate(matches: list[Match], unmatched_predictions: list[Prediction], error_limit: int) -> dict[str, Any]:
    total = len(matches)
    correct = sum(_is_correct(match) for match in matches)
    canonical = [match for match in matches if _gold_target(match.gold.speaker)[2] == "canonical"]
    main = [match for match in matches if _gold_target(match.gold.speaker)[0] in MAIN_SPEAKERS and _gold_target(match.gold.speaker)[2] == "canonical"]
    combinations = [match for match in matches if _gold_target(match.gold.speaker)[2] == "combination"]
    other = [match for match in matches if _gold_target(match.gold.speaker)[0] == "OTHER" and _gold_target(match.gold.speaker)[2] == "other"]
    nonspeech = [match for match in matches if _gold_target(match.gold.speaker)[0] == "NONSPEECH"]
    short = [match for match in matches if _short_text(match.gold.text)]
    interjections = [match for match in matches if _interjection(match.gold.text)]

    mami_roka = [match for match in matches if _gold_target(match.gold.speaker)[0] in {"Mami", "Roka"}]
    direct_swaps = sum(
        match.prediction is not None
        and {match.prediction.speaker, _gold_target(match.gold.speaker)[0]} == {"Mami", "Roka"}
        for match in mami_roka
    )
    koto = [match for match in matches if _gold_target(match.gold.speaker)[0] == "Koto"]
    otaku = [match for match in matches if match.gold.speaker == "オタ公"]
    fushi = [match for match in matches if _gold_target(match.gold.speaker)[0] == "FUSHI"]

    methods = Counter(match.method for match in matches)
    unmatched_gold = [match for match in matches if match.prediction is None]
    structural = [match for match in matches if match.prediction is not None and match.method != "exact_timestamp_text"]
    return {
        "overall": _metric(correct, total),
        "canonical": _metric(sum(_is_correct(match) for match in canonical), len(canonical)),
        "main_characters": _metric(sum(_is_correct(match) for match in main), len(main)),
        "per_speaker": _speaker_metrics(matches),
        "other": _metric(sum(_is_correct(match) for match in other), len(other)),
        "nonspeech": _metric(sum(_is_correct(match) for match in nonspeech), len(nonspeech)),
        "combinations": _metric(sum(_is_correct(match) for match in combinations), len(combinations)),
        "combination_detail": Counter(
            f"{match.gold.speaker} -> {match.prediction.speaker if match.prediction else 'UNMATCHED'}"
            for match in combinations
        ),
        "short_text_len_le_5": _metric(sum(_is_correct(match) for match in short), len(short)),
        "interjections": _metric(sum(_is_correct(match) for match in interjections), len(interjections)),
        "mami_roka": {
            "combined": _metric(sum(_is_correct(match) for match in mami_roka), len(mami_roka)),
            "direct_swaps": direct_swaps,
            "Mami_to_Roka": sum(match.prediction is not None and match.gold.speaker == "Mami" and match.prediction.speaker == "Roka" for match in matches),
            "Roka_to_Mami": sum(match.prediction is not None and match.gold.speaker == "Roka" and match.prediction.speaker == "Mami" for match in matches),
        },
        "koto_otaku": {
            "Koto": _metric(sum(_is_correct(match) for match in koto), len(koto)),
            "Otaku_as_OTHER": _metric(sum(_is_correct(match) for match in otaku), len(otaku)),
            "Koto_predicted_on_Otaku": sum(match.prediction is not None and match.prediction.speaker == "Koto" for match in otaku),
            "OTHER_predicted_on_Koto": sum(match.prediction is not None and match.prediction.speaker == "OTHER" for match in koto),
        },
        "fushi": _metric(sum(_is_correct(match) for match in fushi), len(fushi)),
        "confidence_calibration": _calibration(matches),
        "alignment": {
            "gold_entries": len(matches),
            "prediction_entries": len({id(match.prediction) for match in matches if match.prediction}) + len(unmatched_predictions),
            "methods": methods,
            "unmatched_gold_count": len(unmatched_gold),
            "unmatched_prediction_count": len(unmatched_predictions),
            "structural_match_count": len(structural),
            "unmatched_gold": [
                {"idx": match.gold.idx, "start": match.gold.start, "end": match.gold.end, "speaker": match.gold.speaker, "text": match.gold.text}
                for match in unmatched_gold
            ],
            "unmatched_predictions": [
                {"idx": pred.idx, "start": pred.start, "end": pred.end, "speaker": pred.speaker, "text": pred.text}
                for pred in unmatched_predictions
            ],
            "structural_matches": [
                {
                    "gold_idx": match.gold.idx,
                    "prediction_idx": match.prediction.idx if match.prediction else None,
                    "method": match.method,
                    "gold_time": [match.gold.start, match.gold.end],
                    "prediction_time": [match.prediction.start, match.prediction.end] if match.prediction else None,
                    "gold_text": match.gold.text,
                    "prediction_text": match.prediction.text if match.prediction else None,
                }
                for match in structural
            ],
        },
        "representative_errors": _representative_errors(matches, error_limit),
    }


def _policy_comparison(raw_matches: list[Match], final_matches: list[Match]) -> dict[str, Any]:
    locked_correct = 0
    locked_changed = 0
    locked_fixed = 0
    locked_broken = 0
    final_changed = 0
    final_fixed = 0
    final_broken = 0
    for raw_match, final_match in zip(raw_matches, final_matches):
        raw_pred = raw_match.prediction
        final_pred = final_match.prediction
        raw_label = raw_pred.speaker if raw_pred else "UNMATCHED"
        final_label = final_pred.speaker if final_pred else "UNMATCHED"
        raw_ok = _label_is_correct(raw_match.gold, raw_label)
        final_ok = _label_is_correct(raw_match.gold, final_label)

        locked_label = raw_label
        if raw_pred and raw_pred.input_speaker not in {"?", "NONSPEECH", ""} and not raw_pred.tags:
            locked_label = _prediction_label(raw_pred.input_speaker)
        locked_ok = _label_is_correct(raw_match.gold, locked_label)
        locked_correct += locked_ok
        if locked_label != raw_label:
            locked_changed += 1
            locked_fixed += not raw_ok and locked_ok
            locked_broken += raw_ok and not locked_ok

        if final_label != raw_label:
            final_changed += 1
            final_fixed += not raw_ok and final_ok
            final_broken += raw_ok and not final_ok
    return {
        "locked_anchor_only": _metric(locked_correct, len(raw_matches)),
        "locked_anchor_changed": locked_changed,
        "locked_anchor_fixed": locked_fixed,
        "locked_anchor_broken": locked_broken,
        "actual_final_changed": final_changed,
        "actual_final_fixed": final_fixed,
        "actual_final_broken": final_broken,
    }


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.6f}%"


def _metric_text(metric: dict[str, Any]) -> str:
    return f"{metric['correct']}/{metric['total']} ({_percent(metric['accuracy'])})"


def _markdown(
    raw: dict[str, Any],
    final: dict[str, Any] | None,
    policy: dict[str, Any] | None,
    results_path: Path,
    gold_path: Path,
) -> str:
    lines = [
        "# Gemini Gold Evaluation",
        "",
        f"- Raw results: `{results_path}`",
        f"- Gold: `{gold_path}`",
        "- Overall denominator: one decision per Gold cue.",
        "- Alignment: exact millisecond timestamp + NFKC/whitespace-normalized text, then unique text with time overlap, then timestamp-overlapping text containment for documented structural merges/splits. No index fallback.",
        "- Gold canonical labels are literal except `DOGE` and semantic `FUSHI*` variants map to `FUSHI`. Specific noncanonical speakers and generic groups map to `OTHER`; `NONSPEECH:*` maps to `NONSPEECH`.",
        "- Combination labels accept any named canonical participant; `2人` and `3人` require `OTHER` because the model cannot output overlap/group combinations.",
        "- Short means normalized text length <= 5. Interjection means a short kana/punctuation-only utterance or a small explicit interjection vocabulary.",
        "",
        "## Summary",
        "",
        f"- Overall: **{_metric_text(raw['overall'])}**",
        f"- Canonical: **{_metric_text(raw['canonical'])}**",
        f"- Main characters: **{_metric_text(raw['main_characters'])}**",
        f"- OTHER: **{_metric_text(raw['other'])}**",
        f"- NONSPEECH: **{_metric_text(raw['nonspeech'])}**",
        f"- Combination labels: **{_metric_text(raw['combinations'])}**",
        f"- Short text: **{_metric_text(raw['short_text_len_le_5'])}**",
        f"- Interjections: **{_metric_text(raw['interjections'])}**",
    ]
    if final:
        delta = final["overall"]["accuracy"] - raw["overall"]["accuracy"]
        lines.extend([
            f"- Locked-anchor-only hypothetical: **{_metric_text(policy['locked_anchor_only'])}**",
            f"- Locked-anchor changes: {policy['locked_anchor_changed']} ({policy['locked_anchor_fixed']} fixes, {policy['locked_anchor_broken']} regressions)",
            f"- Final SRT: **{_metric_text(final['overall'])}**",
            f"- Final minus raw: **{delta * 100:+.6f} percentage points**",
            f"- All final-policy changes: {policy['actual_final_changed']} ({policy['actual_final_fixed']} fixes, {policy['actual_final_broken']} regressions)",
        ])

    lines.extend(["", "## Per Speaker", "", "| Speaker | Precision | Recall | Support | TP | FP |", "|---|---:|---:|---:|---:|---:|"])
    for speaker, metric in raw["per_speaker"].items():
        lines.append(f"| {speaker} | {_percent(metric['precision'])} | {_percent(metric['recall'])} | {metric['support']} | {metric['true_positive']} | {metric['false_positive']} |")

    lines.extend([
        "",
        "## Targeted Metrics",
        "",
        f"- Mami/Roka combined: {_metric_text(raw['mami_roka']['combined'])}",
        f"- Direct Mami/Roka swaps: {raw['mami_roka']['direct_swaps']} (Mami->Roka {raw['mami_roka']['Mami_to_Roka']}, Roka->Mami {raw['mami_roka']['Roka_to_Mami']})",
        f"- Koto: {_metric_text(raw['koto_otaku']['Koto'])}",
        f"- Otaku as OTHER: {_metric_text(raw['koto_otaku']['Otaku_as_OTHER'])}",
        f"- Koto predicted on Otaku: {raw['koto_otaku']['Koto_predicted_on_Otaku']}",
        f"- OTHER predicted on Koto: {raw['koto_otaku']['OTHER_predicted_on_Koto']}",
        f"- FUSHI (including Gold DOGE/FUSHI variants): {_metric_text(raw['fushi'])}",
        "",
        "### Combination Detail",
        "",
    ])
    for label, count in sorted(raw["combination_detail"].items()):
        lines.append(f"- `{label}`: {count}")

    lines.extend(["", "## Confidence Calibration", "", "| Confidence | Count | Correct | Empirical accuracy | Nominal |", "|---|---:|---:|---:|---:|"])
    for confidence, values in raw["confidence_calibration"]["bins"].items():
        lines.append(f"| {confidence} | {values['count']} | {values['correct']} | {_percent(values['accuracy'])} | {_percent(values['nominal'])} |")
    lines.extend([
        "",
        f"- ECE with high/mid/low mapped to 0.9/0.6/0.3: {raw['confidence_calibration']['ece_assuming_high_0.9_mid_0.6_low_0.3']:.6f}",
        f"- Brier score with the same mapping: {raw['confidence_calibration']['brier_assuming_high_0.9_mid_0.6_low_0.3']:.6f}",
        "",
        "## Alignment",
        "",
        f"- Gold entries: {raw['alignment']['gold_entries']}",
        f"- Prediction entries: {raw['alignment']['prediction_entries']}",
        f"- Match methods: {dict(raw['alignment']['methods'])}",
        f"- Non-exact structural/time fallback matches: {raw['alignment']['structural_match_count']}",
        f"- Unmatched Gold: {raw['alignment']['unmatched_gold_count']}",
        f"- Unmatched predictions: {raw['alignment']['unmatched_prediction_count']}",
        "",
        "### Unmatched Gold",
        "",
    ])
    if raw["alignment"]["unmatched_gold"]:
        for item in raw["alignment"]["unmatched_gold"]:
            lines.append(f"- Gold {item['idx']} {item['start']:.3f}-{item['end']:.3f} [{item['speaker']}] {_one_line(item['text'])}")
    else:
        lines.append("- None")
    lines.extend(["", "### Unmatched Predictions", ""])
    if raw["alignment"]["unmatched_predictions"]:
        for item in raw["alignment"]["unmatched_predictions"]:
            lines.append(f"- Raw {item['idx']} {item['start']:.3f}-{item['end']:.3f} [{item['speaker']}] {_one_line(item['text'])}")
    else:
        lines.append("- None")

    lines.extend(["", "### Structural Matches", ""])
    for item in raw["alignment"]["structural_matches"]:
        lines.append(
            f"- `{item['method']}` Gold {item['gold_idx']} -> raw {item['prediction_idx']}: "
            f"{item['gold_time'][0]:.3f}-{item['gold_time'][1]:.3f} `{_one_line(item['gold_text'])}` "
            f"=> {item['prediction_time'][0]:.3f}-{item['prediction_time'][1]:.3f} `{_one_line(item['prediction_text'])}`"
        )

    lines.extend(["", "## Representative Errors", "", "| # | Gold idx | Time | Gold | Target | Predicted | Raw identity | Conf | Match | Text |", "|---:|---:|---|---|---|---|---|---|---|---|"])
    for number, error in enumerate(raw["representative_errors"], start=1):
        text = error["text"].replace("|", "\\|")
        lines.append(f"| {number} | {error['gold_idx']} | {error['time']} | {error['gold']} | {error['target']} | {error['predicted']} | {error['speaker_raw']} | {error['confidence']} | {error['method']} | {text} |")
    return "\n".join(lines) + "\n"


def main() -> int:
    args = _parse_args()
    gold = parse_srt(args.gold)
    raw_predictions = _load_raw(args.results)
    raw_matches, raw_unmatched = _align(gold, raw_predictions)
    raw_report = _evaluate(raw_matches, raw_unmatched, args.errors)

    final_report = None
    policy_report = None
    if args.final_srt:
        final_predictions = _load_srt_predictions(args.final_srt)
        final_matches, final_unmatched = _align(gold, final_predictions)
        final_report = _evaluate(final_matches, final_unmatched, args.errors)
        policy_report = _policy_comparison(raw_matches, final_matches)

    report = _markdown(raw_report, final_report, policy_report, args.results, args.gold)
    if args.output:
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report)
    if args.json_output:
        args.json_output.write_text(json.dumps({"raw": raw_report, "final": final_report, "policy": policy_report}, ensure_ascii=False, indent=2, default=dict) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
