"""Scorer math on a tiny fixture (pure — no torch/sklearn/numpy)."""
from __future__ import annotations

from tests.accuracy.model_compare.classification_scorer import (
    LABELS_17, _OFF, score_classification)

# 4 clauses; model gets c1 & c3 right, c2 & c4 wrong (payment<->general swap).
GOLD = [
    {"clause_id": "c1", "y_true": "payment", "lang": "en", "was_corrected": False},
    {"clause_id": "c2", "y_true": "payment", "lang": "ar", "was_corrected": True},
    {"clause_id": "c3", "y_true": "general", "lang": "ar", "was_corrected": False},
    {"clause_id": "c4", "y_true": "general", "lang": "ar", "was_corrected": False},
]
PREDS = [
    {"clause_id": "c1", "y_pred": "payment"},   # correct
    {"clause_id": "c2", "y_pred": "general"},   # wrong
    {"clause_id": "c3", "y_pred": "general"},   # correct
    {"clause_id": "c4", "y_pred": "payment"},   # wrong
]


def test_overall_and_macro():
    s = score_classification(PREDS, GOLD, LABELS_17)
    ov = s["overall"]
    assert ov["n"] == 4 and ov["correct"] == 2
    assert ov["accuracy"] == 0.5 and ov["micro_f1"] == 0.5   # micro == accuracy
    assert ov["present_classes"] == 2
    # payment: P=R=F1=0.5 ; general: P=R=F1=0.5 -> macro over present = 0.5
    assert ov["macro_f1_present"] == 0.5 and s["macro_f1"] == 0.5
    # macro over all 17 (15 absent classes count as F1=0): 1.0/17
    assert ov["macro_f1_all17"] == round(1.0 / 17, 4) == 0.0588
    # majority-class floor surfaced in the artifact: general & payment tie at support 2;
    # first in LABELS_17 order (general) wins; baseline = 2/4
    assert ov["majority_class"] == "general" and ov["majority_baseline_accuracy"] == 0.5
    assert set(ov["low_support_present"]) == {"general", "payment"}   # both present, support<5
    assert s["n_scored"] == 4 and s["n_pred_no_gold"] == 0


def test_per_class_and_confusion():
    s = score_classification(PREDS, GOLD, LABELS_17)
    pay = s["per_class"]["payment"]
    assert pay == {"precision": 0.5, "recall": 0.5, "f1": 0.5,
                   "support": 2, "tp": 1, "fp": 1, "fn": 1}
    assert s["confusion"]["payment"]["payment"] == 1 and s["confusion"]["payment"]["general"] == 1
    assert s["confusion"]["general"]["general"] == 1 and s["confusion"]["general"]["payment"] == 1
    # every one of the 17 labels has <5 support here
    assert len(s["low_support_classes"]) == 17


def test_language_and_corrected_slices():
    s = score_classification(PREDS, GOLD, LABELS_17)
    assert s["by_language"]["en"]["n"] == 1 and s["by_language"]["en"]["accuracy"] == 1.0   # c1 only, correct
    assert s["by_language"]["ar"]["n"] == 3 and s["by_language"]["ar"]["accuracy"] == round(1 / 3, 4)
    assert s["by_corrected"]["edited"]["n"] == 1 and s["by_corrected"]["edited"]["accuracy"] == 0.0  # c2 wrong
    assert s["by_corrected"]["approved"]["n"] == 3 and s["by_corrected"]["approved"]["accuracy"] == round(2 / 3, 4)


def test_off_label_and_pred_without_gold():
    preds = [{"clause_id": "c1", "y_pred": "banana"}] + PREDS[1:] + [{"clause_id": "zzz", "y_pred": "payment"}]
    s = score_classification(preds, GOLD, LABELS_17)
    # off-label prediction ("banana") is bucketed, not silently dropped
    assert s["confusion"]["payment"][_OFF] == 1
    # a prediction for a clause not in gold is counted but never scored
    assert s["n_pred_no_gold"] == 1 and s["n_scored"] == 4
