"""7.22 Item 2 — agent-side M/N denominator counts (playbook_relevant_count /
playbook_on_standard_count).

M = number of structured positions evaluated. N = M minus the DISTINCT positions
a PLAYBOOK finding deviated from. Auditable (emitted into findings_summary), not
FE-derived. M=0/N=0 when no positions were sent.
"""
from __future__ import annotations

from app.agents.compliance_checker import ComplianceCheckerAgent


def test_M_and_N_counts_distinct_deviated_positions():
    result = {
        "findings": [
            {"layer": "PLAYBOOK", "playbook_position_id": "p1"},
            {"layer": "PLAYBOOK", "playbook_position_id": "p2"},
            {"layer": "PLAYBOOK", "playbook_position_id": "p1"},  # dup → distinct
            {"layer": "STANDARD", "playbook_position_id": "pX"},  # non-PLAYBOOK: ignored
            {"layer": "PLAYBOOK", "playbook_position_id": None},  # NON_STANDARD: no pos
        ],
        "summary": {"total": 5},
    }
    positions = [{"position_id": f"p{i}"} for i in range(1, 6)]  # M = 5

    ComplianceCheckerAgent._add_playbook_counts(result, positions)

    assert result["summary"]["playbook_relevant_count"] == 5  # M
    # distinct deviated = {p1, p2} = 2  → N = 5 − 2 = 3
    assert result["summary"]["playbook_on_standard_count"] == 3


def test_no_positions_gives_M0_N0():
    result = {
        "findings": [{"layer": "PLAYBOOK", "playbook_position_id": "p1"}],
        "summary": {},
    }
    ComplianceCheckerAgent._add_playbook_counts(result, None)
    assert result["summary"]["playbook_relevant_count"] == 0
    assert result["summary"]["playbook_on_standard_count"] == 0


def test_all_positions_on_standard_gives_N_equals_M():
    # No PLAYBOOK findings at all → nothing deviated → N == M.
    result = {"findings": [{"layer": "STANDARD"}], "summary": {}}
    positions = [{"position_id": "p1"}, {"position_id": "p2"}, {"position_id": "p3"}]
    ComplianceCheckerAgent._add_playbook_counts(result, positions)
    assert result["summary"]["playbook_relevant_count"] == 3
    assert result["summary"]["playbook_on_standard_count"] == 3


def test_N_never_negative():
    # Defensive: deviated ids not in the positions list can't push N below 0.
    result = {
        "findings": [
            {"layer": "PLAYBOOK", "playbook_position_id": "ghost-a"},
            {"layer": "PLAYBOOK", "playbook_position_id": "ghost-b"},
        ],
        "summary": {},
    }
    positions = [{"position_id": "p1"}]  # M = 1
    ComplianceCheckerAgent._add_playbook_counts(result, positions)
    assert result["summary"]["playbook_relevant_count"] == 1
    assert result["summary"]["playbook_on_standard_count"] == 0  # max(1-2, 0)
