"""Unit tests for RiskAnalyzerAgent parsing (Bug-1 fix).

The model wraps its risk output in a ```json markdown fence; the agent
previously did a bare ``json.loads()`` that raised on the fence and returned 0
risks. ``_parse_risk_array`` now handles fenced / truncated / clean output.

No API calls — the Anthropic client is mocked at construction and ``_call_model``
is stubbed per test, so the sanctioned chokepoint call is exercised without
network access.
"""

from __future__ import annotations

import math

from app.agents.risk_analyzer import (
    RISK_BATCH_SIZE,
    RiskAnalyzerAgent,
    _parse_risk_array,
)


def _msg(text: str):
    """A fake Anthropic Message with .content[0].text == text."""
    block = type("Block", (), {"text": text})()
    return type("Message", (), {"content": [block]})()


FENCED = (
    '```json\n['
    '{"clause_id":"A","risk_category":"Payment Terms","likelihood":3,'
    '"impact":4,"severity":"high","description":"x","suggestion":"y"},'
    '{"clause_id":"B","risk_category":"Liability Cap","likelihood":4,'
    '"impact":4,"severity":"high","description":"z"}'
    ']\n```'
)
# Two complete objects then cut off mid-third (max_tokens truncation).
TRUNCATED = (
    '```json\n['
    '{"clause_id":"A","risk_category":"Payment Terms","likelihood":3,'
    '"impact":4,"description":"x"},'
    '{"clause_id":"B","risk_category":"Termination","likelihood":2,'
    '"impact":3,"description":"y"},'
    '{"clause_id":"C","risk_ca'
)
CLEAN = (
    '[{"clause_id":"Z","risk_category":"Termination","likelihood":2,'
    '"impact":2,"description":"ok"}]'
)
PROSE = "I could not identify any risks in these clauses."


# ── the parser (pure function) ────────────────────────────────────────────────

def test_parse_fenced_json():
    out = _parse_risk_array(FENCED)
    assert len(out) == 2  # was 0 before the fix
    assert out[0]["risk_category"] == "Payment Terms"
    assert out[1]["clause_id"] == "B"


def test_parse_truncated_salvages_complete_objects():
    out = _parse_risk_array(TRUNCATED)
    assert len(out) == 2  # the two complete objects survive; the cut-off 3rd is dropped
    assert [o["clause_id"] for o in out] == ["A", "B"]


def test_parse_clean_unfenced_array():
    assert len(_parse_risk_array(CLEAN)) == 1


def test_parse_prose_returns_empty():
    assert _parse_risk_array(PROSE) == []


def test_parse_preamble_then_fence():
    raw = "Here are the risks I found:\n```json\n" + CLEAN + "\n```"
    assert len(_parse_risk_array(raw)) == 1


# ── analyze() end-to-end (mocked model call) ─────────────────────────────────

def test_analyze_parses_fenced_response(mocker):
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = RiskAnalyzerAgent()
    mocker.patch.object(agent, "_call_model", return_value=_msg(FENCED))
    risks = agent.analyze([{"id": "A", "text": "clause text"}])
    assert len(risks) == 2  # 0 before the fix (bare json.loads on the fence)
    assert risks[0]["risk_category"] == "Payment Terms"


def test_analyze_empty_on_prose(mocker):
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = RiskAnalyzerAgent()
    mocker.patch.object(agent, "_call_model", return_value=_msg(PROSE))
    assert agent.analyze([{"id": "A", "text": "x"}]) == []


def test_analyze_keeps_call_model_chokepoint_unchanged(mocker):
    """The fix must NOT change the _call_model invocation — analyze() still calls
    the chokepoint with scrub=True + max_tokens=4096 + system + messages."""
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = RiskAnalyzerAgent()
    spy = mocker.patch.object(agent, "_call_model", return_value=_msg(CLEAN))
    agent.analyze([{"id": "A", "text": "x"}])
    _, kwargs = spy.call_args
    assert kwargs["scrub"] is True
    assert kwargs["max_tokens"] == 4096
    assert "system" in kwargs and "messages" in kwargs


# ── Issue 5 — small-batch coverage ───────────────────────────────────────────

def test_analyze_splits_clauses_into_batches(mocker):
    """One model call per batch of RISK_BATCH_SIZE clauses; results aggregate."""
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = RiskAnalyzerAgent()
    spy = mocker.patch.object(agent, "_call_model", return_value=_msg(CLEAN))
    n = RISK_BATCH_SIZE * 2 + 1  # e.g. 9 → batches of 4,4,1
    clauses = [{"id": f"c{i}", "text": "x"} for i in range(n)]
    risks = agent.analyze(clauses)
    expected_batches = math.ceil(n / RISK_BATCH_SIZE)
    assert spy.call_count == expected_batches  # one call per batch, not one giant call
    assert len(risks) == expected_batches  # CLEAN → 1 risk per batch, aggregated
    assert agent.failed_batches == []


def test_analyze_aggregates_batches_in_order(mocker):
    """Risks from every batch are aggregated, preserving batch order even though
    the batches run concurrently."""
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = RiskAnalyzerAgent()
    b1 = '[{"clause_id":"A","risk_category":"Termination","likelihood":2,"impact":2,"description":"b1"}]'
    b2 = '[{"clause_id":"E","risk_category":"Termination","likelihood":2,"impact":2,"description":"b2"}]'

    # Batches run concurrently → route by CONTENT, not call order: the first
    # batch holds clause c0, the second holds c4.
    def route(*_a, **kw):
        content = kw["messages"][0]["content"]
        return _msg(b1) if "Clause c0" in content else _msg(b2)

    spy = mocker.patch.object(agent, "_call_model", side_effect=route)
    clauses = [{"id": f"c{i}", "text": "x"} for i in range(RISK_BATCH_SIZE + 1)]  # 2 batches
    risks = agent.analyze(clauses)
    assert [r["clause_id"] for r in risks] == ["A", "E"]  # aggregation preserves batch order
    assert spy.call_count == 2


def test_analyze_failed_batch_retries_once_then_skips(mocker):
    """A batch that raises is retried once, then logged + skipped; the rest of the
    run still returns, and the skipped batch is recorded on failed_batches."""
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = RiskAnalyzerAgent()

    # Batches run concurrently → route by CONTENT: batch 0 (holds clause c0)
    # always raises; batch 1 (clause c4) succeeds.
    def route(*_a, **kw):
        content = kw["messages"][0]["content"]
        if "Clause c0" in content:
            raise RuntimeError("boom")
        return _msg(CLEAN)

    spy = mocker.patch.object(agent, "_call_model", side_effect=route)
    clauses = [{"id": f"c{i}", "text": "x"} for i in range(RISK_BATCH_SIZE + 1)]  # 2 batches
    risks = agent.analyze(clauses)
    assert len(risks) == 1  # only the surviving batch's risk
    assert spy.call_count == 3  # batch 0: original + 1 retry; batch 1: 1 call
    assert len(agent.failed_batches) == 1
    assert agent.failed_batches[0]["batch_index"] == 0
    assert "boom" in agent.failed_batches[0]["error"]
