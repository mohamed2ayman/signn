"""Pure scorer for single-label clause-TYPE classification (Step 2, Stage 1).

Stage 1 is a FEASIBILITY SCREEN: it scores a model's predicted clause_type against
the YARDSTICK label = Claude's stored clause_type in the 8.3 gold. That measures
**agreement-with-Claude**, NOT correctness — there is no human-verified clause-type
ground truth yet (only ~7 of 468 clauses were ever human-edited, type unrecoverable;
see docs/step2-clause-classification-benchmark-investigation.md §1.3). A high score
means "a cheap local classifier can reproduce Claude's labels from text" — a
necessary (not sufficient) condition for replacing Claude on this task.

Reports per-class precision/recall/F1, macro/micro F1, a confusion matrix, and
PER-LANGUAGE slices. stdlib only (no model imports, no numpy) so the identical
scorer judges every model.
"""
from __future__ import annotations

from typing import Any

# The canonical 17 clause-type keys (mirror clause_extractor.py:71-75 /
# ClauseReviewCard.tsx CLAUSE_TYPE_LABELS / scorer.py ALLOWED_CLAUSE_TYPES).
LABELS_17 = [
    "general", "payment", "liability", "termination", "indemnification",
    "force_majeure", "dispute_resolution", "confidentiality", "compliance",
    "insurance", "warranty", "intellectual_property", "scope_of_work",
    "variations", "defects", "time", "other",
]
_OFF = "__off_label__"  # bucket for a prediction outside the 17


def _join(preds: list[dict], gold: list[dict]) -> tuple[list[tuple[str, str, dict]], int]:
    """Inner-join preds([{clause_id, y_pred}]) to gold([{clause_id, y_true, lang,
    was_corrected}]) on clause_id. Returns (matched=[(y_true, y_pred, gold_row)],
    n_pred_no_gold)."""
    gold_by = {str(g["clause_id"]): g for g in gold}
    pred_by = {str(p["clause_id"]): p.get("y_pred") for p in preds}
    matched = [(str(g["y_true"]), str(pred_by[cid]), g)
               for cid, g in gold_by.items() if cid in pred_by]
    n_pred_no_gold = sum(1 for cid in pred_by if cid not in gold_by)
    return matched, n_pred_no_gold


def per_class_prf(pairs: list[tuple[str, str]], labels: list[str] = LABELS_17) -> dict[str, dict]:
    """{label: {precision, recall, f1, support, tp, fp, fn}} for every label."""
    out: dict[str, dict] = {}
    for lab in labels:
        tp = sum(1 for t, p in pairs if t == lab and p == lab)
        fp = sum(1 for t, p in pairs if t != lab and p == lab)
        fn = sum(1 for t, p in pairs if t == lab and p != lab)
        support = sum(1 for t, p in pairs if t == lab)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        out[lab] = {"precision": round(prec, 4), "recall": round(rec, 4),
                    "f1": round(f1, 4), "support": support, "tp": tp, "fp": fp, "fn": fn}
    return out


def confusion(pairs: list[tuple[str, str]], labels: list[str] = LABELS_17) -> dict[str, dict[str, int]]:
    """17x17 nested dict confusion[true][pred] = count; off-label preds -> _OFF column."""
    known = set(labels)
    conf = {t: {p: 0 for p in list(labels) + [_OFF]} for t in labels}
    for t, p in pairs:
        if t not in conf:  # a gold label outside the 17 should not occur; skip if it does
            continue
        conf[t][p if p in known else _OFF] += 1
    return conf


def _score_pairs(pairs: list[tuple[str, str]], labels: list[str] = LABELS_17) -> dict[str, Any]:
    """Accuracy + macro-F1 (two conventions) for one slice. For single-label
    multiclass, MICRO-F1 == accuracy (reported as micro_f1, stated honestly)."""
    n = len(pairs)
    correct = sum(1 for t, p in pairs if t == p)
    acc = correct / n if n else 0.0
    pc = per_class_prf(pairs, labels)
    present = [lab for lab in labels if pc[lab]["support"] > 0]
    macro_all = sum(pc[lab]["f1"] for lab in labels) / len(labels) if labels else 0.0
    macro_present = sum(pc[lab]["f1"] for lab in present) / len(present) if present else 0.0
    # Majority-class floor: the trivial "always predict the most common label"
    # baseline. Surfacing it IN the artifact (not just the doc) makes `accuracy`
    # self-interpreting — on the general-dominated slices a model must clear this
    # floor to mean anything (e.g. AR general≈31% → beating 0.31 is the real bar).
    maj_lab, maj_support = None, 0
    for lab in present:
        if pc[lab]["support"] > maj_support:
            maj_lab, maj_support = lab, pc[lab]["support"]
    return {
        "n": n,
        "accuracy": round(acc, 4),
        "correct": correct,
        "micro_f1": round(acc, 4),                 # == accuracy for single-label multiclass
        "macro_f1_all17": round(macro_all, 4),     # absent classes count as F1=0 (harsh, comparable)
        "macro_f1_present": round(macro_present, 4),  # mean over classes actually present (fairer read)
        "present_classes": len(present),
        "majority_class": maj_lab,
        "majority_baseline_accuracy": round(maj_support / n, 4) if n else 0.0,
        "low_support_present": [lab for lab in present if pc[lab]["support"] < 5],  # per-slice thin classes
    }


def score_classification(preds: list[dict], gold: list[dict],
                         labels: list[str] = LABELS_17) -> dict[str, Any]:
    """Score model preds against the yardstick gold labels. Returns overall metrics,
    per-class PRF, confusion, and per-language / per-was_corrected slices."""
    matched, n_pred_no_gold = _join(preds, gold)
    pairs_all = [(t, p) for t, p, _ in matched]
    overall = _score_pairs(pairs_all, labels)
    pc = per_class_prf(pairs_all, labels)
    conf = confusion(pairs_all, labels)
    by_language = {lg: _score_pairs([(t, p) for t, p, r in matched if str(r.get("lang")) == lg], labels)
                   for lg in ("ar", "en")}
    by_corrected = {key: _score_pairs([(t, p) for t, p, r in matched
                                       if bool(r.get("was_corrected")) is want], labels)
                    for key, want in (("edited", True), ("approved", False))}
    return {
        "overall": overall,
        "macro_f1": overall["macro_f1_present"],   # headline = macro over present classes
        "micro_f1": overall["micro_f1"],
        "per_class": pc,
        "confusion": conf,
        "by_language": by_language,
        "by_corrected": by_corrected,              # 'edited' slice is tiny (~7) — not meaningful
        "n_scored": len(matched),
        "n_pred_no_gold": n_pred_no_gold,
        "low_support_classes": [lab for lab in labels if pc[lab]["support"] < 5],
    }
