"""Item 3 — layer-aware overall_status + separate playbook_status axis.

Proves the deterministic code fallback ``_recompute_summary``:
  - overall_status (LEGAL rollup) is computed over non-PLAYBOOK layers only
    (STANDARD / JURISDICTION / CONFLICT); PLAYBOOK deviations NEVER flip a
    contract to NON_COMPLIANT.
  - playbook_status is a SEPARATE preference axis over PLAYBOOK findings only:
    none -> ON_STANDARD; any HIGH/CRITICAL -> MAJOR_DEVIATIONS; else
    (LOW/MEDIUM/INFO) -> MINOR_DEVIATIONS.

The six cases below mirror the NestJS deriveOverall/derivePlaybookStatus tests
(compliance.service.playbook-status.spec.ts) exactly — the agent's fallback and
the NestJS fallback must not drift.
"""
from __future__ import annotations

from app.agents.compliance_checker import _recompute_summary


def test_1_only_critical_playbook_is_legally_compliant():
    # ONLY a CRITICAL PLAYBOOK finding -> legally COMPLIANT, playbook MAJOR.
    s = _recompute_summary([{"layer": "PLAYBOOK", "severity": "CRITICAL"}])
    assert s["overall_status"] == "COMPLIANT"
    assert s["playbook_status"] == "MAJOR_DEVIATIONS"


def test_2_low_medium_playbook_only_is_minor():
    # ONLY LOW/MEDIUM PLAYBOOK findings -> COMPLIANT, MINOR.
    s = _recompute_summary(
        [
            {"layer": "PLAYBOOK", "severity": "LOW"},
            {"layer": "PLAYBOOK", "severity": "MEDIUM"},
        ]
    )
    assert s["overall_status"] == "COMPLIANT"
    assert s["playbook_status"] == "MINOR_DEVIATIONS"


def test_3_info_only_playbook_is_minor():
    # INFO-only PLAYBOOK finding -> COMPLIANT, MINOR (the locked edge: INFO < LOW).
    s = _recompute_summary([{"layer": "PLAYBOOK", "severity": "INFO"}])
    assert s["overall_status"] == "COMPLIANT"
    assert s["playbook_status"] == "MINOR_DEVIATIONS"


def test_4_legal_high_no_playbook_is_partial_and_on_standard():
    # 0 PLAYBOOK, a legal HIGH -> PARTIALLY_COMPLIANT, playbook ON_STANDARD.
    s = _recompute_summary([{"layer": "JURISDICTION", "severity": "HIGH"}])
    assert s["overall_status"] == "PARTIALLY_COMPLIANT"
    assert s["playbook_status"] == "ON_STANDARD"


def test_5_legal_critical_still_non_compliant():
    # GUARD: a real legal CRITICAL must still be NON_COMPLIANT (fix must NOT
    # weaken legal detection).
    s = _recompute_summary([{"layer": "STANDARD", "severity": "CRITICAL"}])
    assert s["overall_status"] == "NON_COMPLIANT"
    assert s["playbook_status"] == "ON_STANDARD"


def test_6_mixed_legal_critical_and_playbook_independent():
    # Mixed: legal CRITICAL + a PLAYBOOK finding -> still NON_COMPLIANT, and
    # playbook_status reflects the PLAYBOOK finding independently.
    s = _recompute_summary(
        [
            {"layer": "CONFLICT", "severity": "CRITICAL"},
            {"layer": "PLAYBOOK", "severity": "MEDIUM"},
        ]
    )
    assert s["overall_status"] == "NON_COMPLIANT"
    assert s["playbook_status"] == "MINOR_DEVIATIONS"
