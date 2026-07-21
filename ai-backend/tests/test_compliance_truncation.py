"""Tests for the compliance-agent truncation fix.

Mirrors ``test_extraction_truncation.py`` (the audited PR #177 pattern),
adapted to compliance's shape: ONE non-chunked call, OBJECT-wrapped output
(``{"findings": [...], "summary": {...}}``).

All Anthropic calls are mocked at ``app.agents.base_agent.Anthropic`` — no
network/key. Covers:
  - stop_reason == 'max_tokens' fires ONE retry with doubled headroom
    (16k → 32k), through the sanctioned _call_model chokepoint.
  - a STILL-truncated response salvages the leading findings, recomputes the
    summary from them, and labels summary.incomplete = true — partial +
    flagged, never the old throw-away-all json.loads crash.
  - a response with NOTHING salvageable still raises (loud failure beats a
    fabricated empty COMPLIANT result — that would be a silent false-pass).
  - the clean path is byte-identical to before (no incomplete label).
"""

from __future__ import annotations

import json

import pytest

from app.agents.compliance_checker import (
    ComplianceCheckerAgent,
    _MAX_TOKENS,
    _RETRY_MAX_TOKENS,
    _recompute_summary,
)

_MOCK = "app.agents.base_agent.Anthropic"


def _msg(stop_reason: str, text: str):
    """A fake Anthropic Message: .content[0].text + .stop_reason."""
    block = type("Block", (), {})()
    block.text = text
    msg = type("Message", (), {})()
    msg.content = [block]
    msg.stop_reason = stop_reason
    return msg


COMPLETE = json.dumps(
    {
        "findings": [
            {
                "layer": "STANDARD",
                "clause_ref": "20.1",
                "finding_type": "DEVIATION",
                "severity": "HIGH",
                "requirement": "Notice within 28 days",
                "actual_text": None,
                "recommendation": "Restore the 28-day notice window.",
                "knowledge_asset_ref": None,
            }
        ],
        "summary": {
            "total": 1,
            "by_layer": {"STANDARD": 1},
            "by_severity": {"HIGH": 1},
            "overall_status": "PARTIALLY_COMPLIANT",
        },
    }
)

# A response cut off mid-way through the SECOND finding — the max_tokens shape.
TRUNCATED = (
    '{"findings": ['
    '{"layer": "JURISDICTION", "finding_type": "MISSING_CLAUSE",'
    ' "severity": "CRITICAL", "requirement": "Decennial liability (Art 651)",'
    ' "recommendation": "Add the mandatory clause."},'
    '{"layer": "STANDARD", "severity": "LOW", "requirement": "cut off he'
)


def _check(agent):
    return agent.check(
        contract_type="FIDIC_RED_BOOK_2017",
        jurisdiction="EG",
        clauses=[{"id": "c1", "text": "clause text"}],
    )


# ── clean path (regression: behavior unchanged) ──────────────────────────────

def test_clean_response_parses_without_incomplete_label(mocker):
    client = mocker.patch(_MOCK).return_value
    seen: list[int] = []

    def fake_create(**kw):
        seen.append(kw["max_tokens"])
        return _msg("end_turn", COMPLETE)

    client.messages.create = fake_create
    result = _check(ComplianceCheckerAgent())
    assert seen == [_MAX_TOKENS]  # one call, raised flat ceiling
    assert len(result["findings"]) == 1
    assert result["summary"]["overall_status"] == "PARTIALLY_COMPLIANT"
    assert "incomplete" not in result["summary"]


# ── retry with headroom ──────────────────────────────────────────────────────

def test_truncation_retries_once_with_doubled_headroom(mocker):
    client = mocker.patch(_MOCK).return_value
    seen: list[int] = []

    def fake_create(**kw):
        seen.append(kw["max_tokens"])
        if len(seen) == 1:
            return _msg("max_tokens", TRUNCATED)
        return _msg("end_turn", COMPLETE)

    client.messages.create = fake_create
    result = _check(ComplianceCheckerAgent())
    assert seen == [_MAX_TOKENS, _RETRY_MAX_TOKENS]  # exactly one retry, doubled
    assert "incomplete" not in result["summary"]  # recovered clean → not flagged


# ── salvage on still-truncated ───────────────────────────────────────────────

def test_still_truncated_salvages_findings_and_flags_incomplete(mocker):
    client = mocker.patch(_MOCK).return_value
    seen: list[int] = []

    def fake_create(**kw):
        seen.append(kw["max_tokens"])
        return _msg("max_tokens", TRUNCATED)

    client.messages.create = fake_create
    result = _check(ComplianceCheckerAgent())
    assert seen == [_MAX_TOKENS, _RETRY_MAX_TOKENS]  # retried, still truncated
    # The complete leading finding was salvaged; the cut-off one dropped.
    assert len(result["findings"]) == 1
    assert result["findings"][0]["severity"] == "CRITICAL"
    # Summary recomputed from the salvaged findings, per the prompt's rules.
    s = result["summary"]
    assert s["total"] == 1
    assert s["by_severity"] == {"CRITICAL": 1}
    assert s["overall_status"] == "NON_COMPLIANT"
    assert s["incomplete"] is True


def test_truncated_but_parseable_output_is_still_flagged(mocker):
    # stop_reason says the model wanted to continue even though the JSON
    # happens to parse — label it incomplete rather than trust it silently.
    client = mocker.patch(_MOCK).return_value
    client.messages.create = lambda **kw: _msg("max_tokens", COMPLETE)
    result = _check(ComplianceCheckerAgent())
    assert result["summary"]["incomplete"] is True
    assert len(result["findings"]) == 1  # findings preserved


# ── nothing salvageable still raises (no fabricated empty result) ────────────

def test_unsalvageable_response_raises(mocker):
    client = mocker.patch(_MOCK).return_value
    client.messages.create = lambda **kw: _msg("max_tokens", '{"findings": ')
    with pytest.raises(json.JSONDecodeError):
        _check(ComplianceCheckerAgent())


# ── summary recompute (pure function) ────────────────────────────────────────

def test_recompute_summary_mirrors_prompt_rules():
    findings = [
        {"layer": "STANDARD", "severity": "HIGH"},
        {"layer": "STANDARD", "severity": "LOW"},
        {"layer": "PLAYBOOK", "severity": "MEDIUM"},
    ]
    s = _recompute_summary(findings)
    assert s["total"] == 3
    assert s["by_layer"] == {"STANDARD": 2, "PLAYBOOK": 1}
    assert s["by_severity"] == {"HIGH": 1, "LOW": 1, "MEDIUM": 1}
    assert s["overall_status"] == "PARTIALLY_COMPLIANT"  # HIGH, no CRITICAL


def test_recompute_summary_empty_is_compliant():
    s = _recompute_summary([])
    assert s == {
        "total": 0,
        "by_layer": {},
        "by_severity": {},
        "overall_status": "COMPLIANT",
    }
