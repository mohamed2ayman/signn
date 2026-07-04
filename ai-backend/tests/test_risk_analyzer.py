"""Unit tests for RiskAnalyzerAgent parsing (Bug-1 fix).

The model wraps its risk output in a ```json markdown fence; the agent
previously did a bare ``json.loads()`` that raised on the fence and returned 0
risks. ``_parse_risk_array`` now handles fenced / truncated / clean output.

No API calls — the Anthropic client is mocked at construction and ``_call_model``
is stubbed per test, so the sanctioned chokepoint call is exercised without
network access.
"""

from __future__ import annotations

from app.agents.risk_analyzer import RiskAnalyzerAgent, _parse_risk_array


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
