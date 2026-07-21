"""Stage-2 labeling: stratified sampling, row shaping, label validation (pure),
plus an XLSX round-trip guarded by openpyxl availability."""
from __future__ import annotations

import collections

import pytest

from tests.accuracy.model_compare.classification_scorer import LABELS_17
from tests.accuracy.model_compare.stage2_labeling import (
    build_label_rows, read_filled_xlsx, stratified_allocation, stratified_sample,
    validate_human_labels, write_labeling_xlsx)

# Mirror the real AR distribution shape (imbalanced, with rare classes).
AR_COUNTS = {
    "general": 126, "compliance": 41, "time": 41, "payment": 40, "scope_of_work": 34,
    "defects": 23, "dispute_resolution": 19, "variations": 17, "termination": 14,
    "confidentiality": 10, "insurance": 9, "force_majeure": 8, "warranty": 8,
    "intellectual_property": 7, "liability": 4, "indemnification": 2, "other": 1,
}


def _ar_records():
    recs = []
    for lab, n in AR_COUNTS.items():
        for i in range(n):
            recs.append({"clause_id": f"{lab}-{i}", "text": f"نص {lab} {i}",
                         "y_true": lab, "lang": "ar", "contract": f"C{i % 12}"})
    return recs


def test_stratified_allocation_hits_exactly_150_and_represents_every_class():
    alloc = stratified_allocation(AR_COUNTS, 150, floor=6)
    assert sum(alloc.values()) == 150
    # every class present (>=1), never more than its support, rare classes fully included
    for lab, sup in AR_COUNTS.items():
        assert 1 <= alloc[lab] <= sup
    assert alloc["other"] == 1 and alloc["indemnification"] == 2 and alloc["liability"] == 4
    # not "150 general": general is capped well below its 126 (floor+proportional share)
    assert alloc["general"] < 60


def test_stratified_allocation_caps_at_total_and_trims_when_floor_exceeds_n():
    # n smaller than sum of floors -> still valid, every class >=1, sums to n
    small = stratified_allocation(AR_COUNTS, 20, floor=6)
    assert sum(small.values()) == 20 and all(v >= 1 for v in small.values())
    # n larger than total support -> capped at total
    capped = stratified_allocation({"a": 3, "b": 2}, 100, floor=6)
    assert sum(capped.values()) == 5 and capped == {"a": 3, "b": 2}


def test_stratified_sample_is_deterministic_and_balanced():
    recs = _ar_records()
    s1, a1 = stratified_sample(recs, n_total=150, seed=0)
    s2, a2 = stratified_sample(recs, n_total=150, seed=0)
    assert len(s1) == 150 and a1 == a2
    assert [r["clause_id"] for r in s1] == [r["clause_id"] for r in s2]   # reproducible
    got = collections.Counter(r["y_true"] for r in s1)
    assert set(got) == set(AR_COUNTS)                                     # every type drawn
    assert all(got[lab] == a1[lab] for lab in got)


def test_build_label_rows_64_en_plus_150_ar_shape():
    en = [{"clause_id": f"e{i}", "text": f"eng {i}", "y_true": "payment", "lang": "en",
           "contract": "P1"} for i in range(64)]
    ar, _ = stratified_sample(_ar_records(), n_total=150)
    rows = build_label_rows(en, ar)
    assert len(rows) == 214                                              # 64 + 150
    assert [r["language"] for r in rows[:64]] == ["en"] * 64
    r0 = rows[0]
    assert r0["row_id"] == "R0001" and r0["claude_label"] == "payment"   # Claude label shown
    assert r0["human_label"] == "" and r0["notes"] == ""                 # empty for the human
    assert "clause_id" in r0                                             # carried for hidden map


def test_validate_human_labels_accepts_17_rejects_others():
    filled = [
        {"row_id": "R1", "human_label": "Payment"},      # valid (case-insensitive)
        {"row_id": "R2", "human_label": "time"},         # valid
        {"row_id": "R3", "human_label": ""},             # blank
        {"row_id": "R4", "human_label": "banana"},       # invalid
    ]
    labeled, unlabeled, invalid = validate_human_labels(filled)
    assert [r["human_label"] for r in labeled] == ["payment", "time"]    # normalized lowercase
    assert [r["row_id"] for r in unlabeled] == ["R3"]
    assert [r["row_id"] for r in invalid] == ["R4"]
    assert all(r["human_label"] in LABELS_17 for r in labeled)


def test_xlsx_round_trip(tmp_path):
    pytest.importorskip("openpyxl")
    en = [{"clause_id": "e0", "text": "english clause", "y_true": "payment", "lang": "en",
           "contract": "P1"}]
    ar = [{"clause_id": "a0", "text": "نص عربي", "y_true": "time", "lang": "ar", "contract": "P2"}]
    rows = build_label_rows(en, ar)
    path = str(tmp_path / "sheet.xlsx")
    write_labeling_xlsx(rows, path)
    back = read_filled_xlsx(path)
    assert len(back) == 2
    assert back[0]["claude_label"] == "payment" and back[0]["clause_id"] == "e0"   # hidden map rejoined
    assert back[1]["language"] == "ar" and back[1]["clause_id"] == "a0"
    assert all(r["human_label"] == "" for r in back)                              # exported empty
