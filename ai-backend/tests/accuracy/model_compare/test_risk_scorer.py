"""Scorer math on a tiny SYNTHETIC fixture (no real gold, no API)."""
from __future__ import annotations

from tests.accuracy.model_compare.risk_scorer import head_to_head, norm_severity, score_risk

# 2 clauses: c1 Arabic, c2 English. Both carry a human-verified HIGH gold risk.
CLAUSES = [
    {"id": "c1", "text": "نص عربي طويل عن شروط الدفع والغرامات."},
    {"id": "c2", "text": "English clause about liability and indemnity."},
]
GOLD = [
    {"contract_clause_id": "c1", "severity": "HIGH", "verified": True, "visible": True,
     "human_verified": True, "final_category": "payment"},
    {"contract_clause_id": "c2", "severity": "HIGH", "verified": True, "visible": True,
     "human_verified": True, "final_category": "liability"},
]
# Model catches c1 (critical→HIGH, Arabic desc, payment) but under-rates c2 (medium).
MODEL = [
    {"clause_id": "c1", "severity": "critical", "risk_category": "Payment Terms",
     "description": "خطر يتعلق بشروط الدفع.", "suggestion": "أضف حداً زمنياً."},
    {"clause_id": "c2", "severity": "medium", "risk_category": "Termination",
     "description": "Risk about termination.", "suggestion": "Clarify."},
]


def test_norm_severity_folds_critical_into_high():
    assert norm_severity("critical") == "HIGH"
    assert norm_severity("HIGH") == "HIGH"
    assert norm_severity("medium") == "MEDIUM"
    assert norm_severity("low") == "LOW"
    assert norm_severity(None) == "?"


def test_score_risk_metrics():
    s = score_risk(MODEL, GOLD, CLAUSES)
    # c1 caught HIGH, c2 under-rated → recall 1/2
    assert s["verified_high_clauses"] == 2
    assert s["verified_high_recall"] == 0.5
    # both verified clauses were shown AND flagged
    assert s["verified_clauses_total"] == 2
    assert s["verified_clauses_flagged"] == 2
    assert s["verified_clauses_missed"] == 0
    assert s["verified_recall"] == 1.0
    # denominator = all verified clauses; c1 severity matches HIGH, c2 does not → 1/2
    assert s["severity_agreement"] == 0.5
    # c1 category payment matches; c2 termination != liability → 1/2
    assert s["category_agreement_approx"] == 0.5
    # only c1 is Arabic; its description IS Arabic → 1/1
    assert s["arabic_clause_risks"] == 1
    assert s["arabic_same_language_rate"] == 1.0


def test_missed_verified_clause_lowers_score_not_inflates():
    """Regression: a model that under-flags must NOT score artificially high.
    Gold = c1 HIGH + c2 MEDIUM (both verified+shown); model flags ONLY c1."""
    gold = [
        {"contract_clause_id": "c1", "severity": "HIGH", "verified": True, "visible": True,
         "human_verified": True, "final_category": "payment"},
        {"contract_clause_id": "c2", "severity": "MEDIUM", "verified": True, "visible": True,
         "human_verified": True, "final_category": "termination"},
    ]
    model = [{"clause_id": "c1", "severity": "high", "risk_category": "Payment Terms",
              "description": "خطر دفع."}]
    s = score_risk(model, gold, CLAUSES)
    # HIGH-only recall sees only c1 → matched → 1.0 (would hide the c2 miss alone)…
    assert s["verified_high_recall"] == 1.0
    # …but the all-severity view SURFACES the miss, and agreement is NOT inflated:
    assert s["verified_clauses_total"] == 2
    assert s["verified_clauses_flagged"] == 1
    assert s["verified_clauses_missed"] == 1
    assert s["verified_recall"] == 0.5           # 1 of 2 verified clauses flagged
    assert s["severity_agreement"] == 0.5        # miss = non-match (NOT 1.0)
    assert s["category_agreement_approx"] == 0.5  # miss = non-match (NOT 1.0)


def test_unshown_clause_excluded_from_recall_denominator():
    """Regression: a human-verified HIGH gold risk on a clause the model was NEVER
    shown (a clause_rejected reject absent from the input) must NOT deflate recall."""
    gold = [
        {"contract_clause_id": "c1", "severity": "HIGH", "verified": True, "visible": True,
         "human_verified": True, "final_category": "payment"},
        {"contract_clause_id": "c_rejected", "severity": "HIGH", "verified": True,
         "visible": True, "human_verified": True, "clause_rejected": True,
         "final_category": "liability"},
    ]
    model = [{"clause_id": "c1", "severity": "high", "risk_category": "Payment Terms",
              "description": "خطر."}]
    # only c1 is in the input clause list → c_rejected is un-catchable-by-design
    s = score_risk(model, gold, [CLAUSES[0]])
    assert s["verified_high_clauses"] == 1        # c_rejected excluded
    assert s["verified_high_recall"] == 1.0       # perfect on what it was shown (not 0.5)


def test_category_agreement_unified_map():
    """Regression: identical human category labels ('Payment Terms') on both sides
    must AGREE — the old split maps scored them as a mismatch."""
    gold = [{"contract_clause_id": "c1", "severity": "HIGH", "verified": True,
             "visible": True, "human_verified": True, "final_category": "Payment Terms"}]
    model = [{"clause_id": "c1", "severity": "high", "risk_category": "Payment Terms",
              "description": "خطر دفع."}]
    s = score_risk(model, gold, [CLAUSES[0]])
    assert s["category_agreement_approx"] == 1.0


def test_score_risk_arabic_violation_detected():
    # Model emits an ENGLISH description on the Arabic clause → same-language rate drops.
    bad = [{"clause_id": "c1", "severity": "high", "risk_category": "Payment Terms",
            "description": "English description on an Arabic clause."}]
    s = score_risk(bad, GOLD, CLAUSES)
    assert s["arabic_clause_risks"] == 1
    assert s["arabic_same_language_rate"] == 0.0


def test_head_to_head_high_divergence():
    a = [{"clause_id": "c1", "severity": "high"}]                       # sonnet: c1 High
    b = [{"clause_id": "c1", "severity": "medium"},
         {"clause_id": "c2", "severity": "high"}]                       # haiku: c2 High
    h = head_to_head(a, b, CLAUSES, "sonnet", "haiku")
    assert h["sonnet_high_count"] == 1 and h["haiku_high_count"] == 1
    assert h["high_only_sonnet"] == ["c1"]
    assert h["high_only_haiku"] == ["c2"]
    # c1: HIGH vs MEDIUM (disagree); c2: none vs HIGH (disagree) → 0/2 agree
    assert h["severity_agreement"] == 0.0
