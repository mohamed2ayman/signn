"""CI-safe unit tests for the gold-backed extraction scorer + adapter seam (Step 5 Phase 0).

No GOLD_DIR, no network, no model, no billing — a small SYNTHETIC gold is embedded. A gated test
runs self-consistency against the REAL gold only when GOLD_DIR is set (skips in CI, mirrors
run_accuracy's gating).
"""
from __future__ import annotations

import os

import pytest

from tests.accuracy.model_compare.extraction_gold import (
    classify_language,
    predicted_from_gold,
    score_gold_extraction,
    score_group,
    section_key,
    self_consistency,
)
from tests.accuracy.model_compare.extraction_runner import (
    GoldEchoExtractionModel,
    OpenAICompatExtractionModel,
    is_truncated,
    parse_clause_array,
)

# Long-enough text so char-trigram fidelity is meaningful (short strings trivially score 1.0).
_AR1 = "تعريفات وتفسيرات تكون للكلمات والمصطلحات الواردة في هذا العقد المعاني المبينة قرين كل منها"
_AR2 = "التزامات المقاول ينفذ المقاول الأعمال طبقا للمواصفات والشروط المرفقة بهذا العقد وبالجودة المطلوبة"
_AR3 = "الدفعات يستحق المقاول قيمة الأعمال المنفذة بعد اعتماد المستخلصات من قبل ممثل صاحب العمل"
_EN1 = "Definitions and Interpretation In this Contract the following words shall have the meanings assigned"
_EN2 = "Payment Terms The Employer shall pay the Contractor within thirty days of certification of works"


def _clause(contract, document, section_number, clause_type, text):
    return {
        "contract": contract, "document": document, "section_number": section_number,
        "clause_type": clause_type, "title": f"clause {section_number}", "text": text,
    }


def _synthetic_gold():
    """2 Arabic docs (one combined GC+PC with '5' AND 'بند 5', plus an unnumbered clause) + 1 English."""
    return [
        _clause("ArA", "GC.docx", "1", "general", _AR1),
        _clause("ArA", "GC.docx", "2", "scope_of_work", _AR2),
        _clause("ArA", "GC.docx", "5", "payment", _AR3),
        _clause("ArA", "GC.docx", "بند 5", "liability", _AR2),          # combined-conditions twin of '5'
        _clause("ArA", "GC.docx", None, "general", _AR1),                # unnumbered → coverage only
        _clause("EnB", "MC.docx", "1", "general", _EN1),
        _clause("EnB", "MC.docx", "2", "payment", _EN2),
    ]


# ---- language + key normalization ------------------------------------------------------

def test_classify_language_majority_script():
    assert classify_language(_AR1) == "ar"
    assert classify_language(_EN1) == "en"
    assert classify_language("العقد المبرم بين الطرفين — contract") == "ar"   # Arabic-majority mixed
    assert classify_language("") == "en"


def test_section_key_normalizes_and_distinguishes():
    assert section_key("5") == "5"
    assert section_key("بند (5)") == "بند5"
    assert section_key("5") != section_key("بند 5")               # combined-conditions stay DISTINCT
    assert section_key("مادة ١٢") == "مادة12"                     # Arabic-Indic digits → ASCII
    assert section_key("14.3") == "14.3"
    assert section_key("Definitions") is None                    # no digit → unnumbered
    assert section_key(None) is None


# ---- scoring a known output ------------------------------------------------------------

def test_score_group_known_output():
    gold = [
        _clause("C", "D", "1", "general", _AR1),
        _clause("C", "D", "2", "payment", _AR2),
    ]
    predicted = [
        {"section_number": "1", "content": _AR1, "clause_type": "general"},   # correct
        {"section_number": "3", "content": _AR3, "clause_type": "other"},     # spurious
    ]
    r = score_group(predicted, gold, contract="C", document="D")
    assert r.matched == 1
    assert r.missing == ["2"]
    assert r.spurious == ["3"]
    assert r.gold_numbered == 2 and r.predicted_numbered == 2
    assert r.boundary_precision == 0.5 and r.boundary_recall == 0.5 and r.boundary_f1 == 0.5
    assert r.type_accuracy == 1.0                       # the one matched clause's type agrees
    assert r.mean_fidelity == 1.0                       # matched content == gold text


def test_duplicates_are_counted():
    gold = [_clause("C", "D", "1", "general", _AR1)]
    predicted = [
        {"section_number": "1", "content": _AR1, "clause_type": "general"},
        {"section_number": "1", "content": _AR1, "clause_type": "general"},   # duplicate key
    ]
    r = score_group(predicted, gold, contract="C", document="D")
    assert r.matched == 1 and r.duplicates == 1


def test_unnumbered_is_coverage_not_a_false_positive():
    gold = [_clause("C", "D", "1", "general", _AR1)]
    predicted = [
        {"section_number": "1", "content": _AR1, "clause_type": "general"},
        {"section_number": None, "content": _AR2, "clause_type": "general"},  # unnumbered
    ]
    r = score_group(predicted, gold, contract="C", document="D")
    assert r.pred_unnumbered == 1
    assert r.predicted_numbered == 1                    # unnumbered EXCLUDED from the P/R denominator
    assert r.boundary_precision == 1.0                 # so precision is NOT dragged to 0.5


def test_fidelity_catches_paraphrase():
    gold = [_clause("C", "D", "1", "general", _AR1)]
    predicted = [{"section_number": "1", "content": _EN2, "clause_type": "general"}]  # wrong text
    r = score_group(predicted, gold, contract="C", document="D")
    assert r.mean_fidelity < 0.5
    assert r.low_fidelity == ["1"]


# ---- language slicing ------------------------------------------------------------------

def test_language_slicing():
    report = self_consistency(_synthetic_gold())
    assert set(report.per_language) == {"ar", "en"}
    assert report.per_language["ar"].n_contracts == 1
    assert report.per_language["en"].n_contracts == 1
    assert report.per_language["en"].gold_numbered == 2      # EnB has 2 numbered clauses
    # ArA: 4 numbered ('1','2','5','بند 5') + 1 unnumbered coverage
    assert report.per_language["ar"].gold_numbered == 4
    assert report.per_language["ar"].gold_unnumbered == 1


# ---- self-consistency (the FREE proof) -------------------------------------------------

def test_self_consistency_is_perfect():
    report = self_consistency(_synthetic_gold())
    ov = report.overall
    assert ov.micro_f1 == 1.0                # every numbered clause round-trips, incl. '5' vs 'بند 5'
    assert ov.micro_precision == 1.0 and ov.micro_recall == 1.0
    assert ov.mean_fidelity == 1.0           # predicted content == gold text
    assert ov.type_accuracy == 1.0
    for g in report.per_group:
        assert g.missing == [] and g.spurious == [] and g.duplicates == 0
    # Arabic (the decision metric) is perfect too:
    assert report.per_language["ar"].micro_f1 == 1.0


def test_predicted_from_gold_maps_text_to_content():
    gold = [_clause("C", "D", "1", "general", _AR1)]
    pred = predicted_from_gold(gold)
    assert pred[0]["content"] == _AR1 and pred[0]["section_number"] == "1"
    assert "text" not in pred[0]


# ---- the model-adapter seam (no network, no billing) -----------------------------------

def test_seam_build_payload_shape():
    m = OpenAICompatExtractionModel(base_url="https://x/v1", api_key="k", model_id="qwen3", max_output_tokens=16384)
    payload = m.build_payload("مادة (1) ...", max_tokens=56000, document_label="General Conditions")
    assert payload["model"] == "qwen3"
    assert payload["temperature"] == 0
    assert payload["max_tokens"] == 16384                          # clamped to the provider ceiling
    assert payload["messages"][0]["role"] == "system" and payload["messages"][0]["content"]
    assert "General Conditions" in payload["messages"][1]["content"]


def test_seam_extract_is_disabled_no_billing():
    m = OpenAICompatExtractionModel(base_url="https://x/v1", api_key="k", model_id="qwen3")  # enabled defaults False
    with pytest.raises(RuntimeError, match="DISABLED"):
        m.extract("some source text")


def test_is_truncated_maps_finish_reason():
    assert is_truncated("length") is True                          # OpenAI length == Anthropic max_tokens
    assert is_truncated("stop") is False
    assert is_truncated(None) is False


def test_parse_clause_array_tolerates_fences_prose_and_truncation():
    assert parse_clause_array('[{"section_number":"1"}]') == [{"section_number": "1"}]
    assert parse_clause_array('```json\n[{"a":1}]\n```') == [{"a": 1}]
    assert parse_clause_array('Here are the clauses: [{"a":1}] done') == [{"a": 1}]
    # truncated array → salvage the complete leading object(s)
    assert parse_clause_array('[{"a":1},{"b":2') == [{"a": 1}]
    assert parse_clause_array("") == []


def test_gold_echo_model_round_trips_through_the_scorer():
    gold = _synthetic_gold()
    model = GoldEchoExtractionModel(gold)
    report = score_gold_extraction(gold, lambda label, group: model.extract("", label))
    assert report.overall.micro_f1 == 1.0


# ---- gated: real gold self-consistency (skips in CI; runs locally when GOLD_DIR is set) --

@pytest.mark.skipif(not os.getenv("GOLD_DIR"), reason="GOLD_DIR unset — real gold is not committed")
def test_real_gold_self_consistency():
    from tests.accuracy.model_compare import gold_loader
    gold = gold_loader.load_gold()
    report = self_consistency(gold["clauses"])
    ar = report.per_language["ar"]
    # Arabic is the decision metric. The strong self-consistency invariant: EVERY numbered gold
    # clause round-trips (recall) with perfect verbatim fidelity + type. F1 is near-perfect but
    # NOT exactly 1.0 — a few contracts (Project5/7/12) are combined GC+PC in one file with BARE
    # restarting numbers, so two clauses share a section number the scorer cannot tell apart
    # (lesson #199) → precision < 1.0. That is real gold data, honestly surfaced, not a scorer bug.
    assert ar.micro_recall == 1.0
    assert ar.mean_fidelity >= 0.999
    assert ar.type_accuracy == 1.0
    assert ar.micro_f1 >= 0.95
    assert report.overall.micro_recall == 1.0
    assert report.overall.mean_fidelity >= 0.999
