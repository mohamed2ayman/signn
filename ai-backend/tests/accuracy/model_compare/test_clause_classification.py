"""Harness plumbing: gold-record shaping, language slicing, fold splitters, and
the CV wrapper returning a label per clause — all with an INJECTED fake embedder
+ the pure NearestCentroid, so no torch/transformers/sklearn is needed."""
from __future__ import annotations

from tests.accuracy.model_compare.classification_scorer import score_classification
from tests.accuracy.model_compare.clause_classification import (
    NearestCentroid, classification_records, crossval_predict, group_folds,
    loo_folds, slice_language)

# Raw gold_clauses.jsonl-shaped rows (2 EN, 2 AR).
ROWS = [
    {"contract_clause_id": "a1", "text": "The Contractor shall pay within 30 days.",
     "clause_type": "payment", "section_number": "5", "document_label": "GC",
     "was_corrected": False, "contract": "P1"},
    {"contract_clause_id": "a2", "text": "General definitions and interpretation.",
     "clause_type": "general", "section_number": "1", "document": "agr.docx",
     "was_corrected": True, "contract": "P1"},
    {"contract_clause_id": "a3", "text": "يلتزم المقاول بإنجاز الأعمال في المدة المحددة.",
     "clause_type": "time", "section_number": "8", "document_label": "PC",
     "was_corrected": False, "contract": "P2"},
    {"contract_clause_id": "a4", "text": "تدفع المستحقات خلال ثلاثين يوماً.",
     "clause_type": "payment", "section_number": "9", "document_label": "PC",
     "was_corrected": False, "contract": "P2"},
]


def test_classification_records_shapes_and_language():
    recs = classification_records(ROWS)
    assert [r["clause_id"] for r in recs] == ["a1", "a2", "a3", "a4"]
    assert [r["lang"] for r in recs] == ["en", "en", "ar", "ar"]   # Arabic-script detection
    assert [r["y_true"] for r in recs] == ["payment", "general", "time", "payment"]
    assert recs[1]["was_corrected"] is True and recs[0]["was_corrected"] is False
    assert recs[1]["document_label"] == "agr.docx"                 # falls back to `document`
    assert slice_language(recs, "en") == [recs[0], recs[1]]
    assert len(slice_language(recs, "ar")) == 2


def test_loo_folds_cover_every_index_once():
    folds = loo_folds(4)
    assert len(folds) == 4
    assert [t for _, t in folds] == [[0], [1], [2], [3]]
    for train, test in folds:
        assert sorted(train + test) == [0, 1, 2, 3]               # partition


def test_group_folds_no_contract_straddles():
    groups = ["A", "A", "B", "B", "C"]
    folds = group_folds(groups, k=3)
    assert folds, "expected non-empty folds"
    for train, test in folds:
        train_c = {groups[i] for i in train}
        test_c = {groups[i] for i in test}
        assert train_c.isdisjoint(test_c)                        # leakage-controlled


# --- fake embedder: text "label|i" -> a one-hot over 3 labels (perfectly separable) ---
_LAB = {"payment": 0, "general": 1, "time": 2}


def _fake_embed(texts):
    return [[1.0 if _LAB[t.split("|")[0]] == k else 0.0 for k in range(3)] for t in texts]


def _records(spec):
    return [{"clause_id": f"{lab}{i}", "text": f"{lab}|{i}", "y_true": lab,
             "lang": "ar", "was_corrected": False, "contract": f"C{i}"}
            for lab, n in spec for i in range(n)]


def test_crossval_predict_returns_a_label_per_clause():
    recs = _records([("payment", 3), ("general", 3), ("time", 3)])   # 9 records, 3 per class
    preds = crossval_predict(recs, _fake_embed, protocol="loo",
                             classifier_factory=NearestCentroid)
    assert len(preds) == len(recs)                                # a prediction per clause
    assert all(p["y_pred"] in _LAB for p in preds)               # each is a valid label
    # separable one-hot embeddings -> LOO nearest-centroid reproduces every label
    s = score_classification(preds, recs)
    assert s["overall"]["accuracy"] == 1.0


def test_crossval_predict_reuses_precomputed_embeddings():
    recs = _records([("payment", 2), ("time", 2)])
    X = _fake_embed([r["text"] for r in recs])
    preds = crossval_predict(recs, embeddings=X, protocol="loo",
                             classifier_factory=NearestCentroid)
    assert len(preds) == 4 and {p["clause_id"] for p in preds} == {"payment0", "payment1", "time0", "time1"}
