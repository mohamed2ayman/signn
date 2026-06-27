"""Unit tests for the accuracy scorer — NO API calls (runs in CI)."""
from __future__ import annotations

from tests.accuracy.scorer import (
    fidelity_ratio,
    normalize_ar,
    parse_section_number,
    score_clause_extraction,
)

SOURCE = (
    "مادة (1) : تعريفات\n"
    "الهيئة هي الطرف الأول والمقاول هو الطرف الثاني في هذا العقد.\n"
    "مادة (2) : الدفع\n"
    "يلتزم المقاول بتقديم التأمين النهائي وفقا لشروط العقد.\n"
    "مادة (3) : التسليم\n"
    "يتم التسليم النهائي بعد انتهاء فترة الضمان والصيانة.\n"
)

GOLDEN = [
    {"section_number": "1", "title_ar": "تعريفات", "clause_type": "general"},
    {"section_number": "2", "title_ar": "الدفع", "clause_type": "payment"},
    {"section_number": "3", "title_ar": "التسليم", "clause_type": "time"},
]


def _perfect_predicted() -> list[dict]:
    return [
        {"section_number": "1", "clause_type": "general",
         "content": "الهيئة هي الطرف الأول والمقاول هو الطرف الثاني في هذا العقد."},
        {"section_number": "2", "clause_type": "payment",
         "content": "يلتزم المقاول بتقديم التأمين النهائي وفقا لشروط العقد."},
        {"section_number": "3", "clause_type": "time",
         "content": "يتم التسليم النهائي بعد انتهاء فترة الضمان والصيانة."},
    ]


# ── helpers ──────────────────────────────────────────────────────────────────

def test_parse_section_number_variants():
    assert parse_section_number("1") == "1"
    assert parse_section_number("مادة (12)") == "12"
    assert parse_section_number("12.3") == "12"
    assert parse_section_number("١٢") == "12"  # Arabic-Indic digits
    assert parse_section_number(None) is None
    assert parse_section_number("مادة") is None


def test_normalize_ar_strips_diacritics_tatweel_and_whitespace():
    # tatweel (ـ) + harakat removed, whitespace collapsed
    assert normalize_ar("الـعـقـد") == "العقد"
    assert normalize_ar("العَقْدُ") == "العقد"
    assert normalize_ar("  a   b \n c ") == "a b c"


def test_fidelity_ratio_bounds():
    assert fidelity_ratio("الهيئة هي الطرف الأول", SOURCE) > 0.95   # verbatim slice
    assert fidelity_ratio("", SOURCE) == 1.0                         # empty -> nothing to contradict
    assert fidelity_ratio("نص أجنبي تماما زققضكفمبشئ", SOURCE) < 0.5  # not in source


# ── scoring ─────────────────────────────────────────────────────────────────

def test_perfect_extraction():
    rep = score_clause_extraction(_perfect_predicted(), GOLDEN, SOURCE)
    assert rep.golden_count == 3
    assert rep.predicted_count == 3
    assert rep.matched == 3
    assert rep.missing == []
    assert rep.spurious == []
    assert rep.duplicates == 0
    assert rep.boundary_precision == 1.0
    assert rep.boundary_recall == 1.0
    assert rep.boundary_f1 == 1.0
    assert rep.type_accuracy == 1.0
    assert rep.mean_fidelity > 0.9
    assert rep.low_fidelity == []


def test_missing_article_lowers_recall():
    pred = [p for p in _perfect_predicted() if p["section_number"] != "2"]
    rep = score_clause_extraction(pred, GOLDEN, SOURCE)
    assert rep.matched == 2
    assert rep.missing == ["2"]
    assert rep.boundary_recall == round(2 / 3, 4)


def test_spurious_article_lowers_precision():
    pred = _perfect_predicted() + [
        {"section_number": "99", "clause_type": "other", "content": "بند غير موجود"}
    ]
    rep = score_clause_extraction(pred, GOLDEN, SOURCE)
    assert "99" in rep.spurious
    assert rep.matched == 3
    assert rep.predicted_count == 4
    assert rep.boundary_precision == round(3 / 4, 4)


def test_toc_duplicate_is_counted_and_penalizes_precision():
    # The model emits article 2 twice (a TOC stub it failed to skip).
    pred = _perfect_predicted() + [
        {"section_number": "2", "clause_type": "payment", "content": "مادة (2)"}
    ]
    rep = score_clause_extraction(pred, GOLDEN, SOURCE)
    assert rep.duplicates == 1
    assert rep.matched == 3                       # still only 3 distinct articles
    assert rep.predicted_count == 4
    assert rep.boundary_precision == round(3 / 4, 4)


def test_clause_type_mismatch_lowers_type_accuracy():
    pred = _perfect_predicted()
    pred[0]["clause_type"] = "payment"            # wrong (golden says "general")
    rep = score_clause_extraction(pred, GOLDEN, SOURCE)
    assert rep.type_accuracy == round(2 / 3, 4)


def test_paraphrased_content_flagged_low_fidelity():
    pred = _perfect_predicted()
    pred[2]["content"] = "هذا كلام مختلف تماما لا علاقة له بالمصدر زقضكفمب"
    rep = score_clause_extraction(pred, GOLDEN, SOURCE)
    assert "3" in rep.low_fidelity
    assert rep.mean_fidelity < 1.0
