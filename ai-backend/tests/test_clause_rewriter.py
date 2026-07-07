"""Unit tests for ClauseRewriterAgent (Risk-tab rework, STEP 3).

The agent re-phrases a clause to reduce a risk and returns a single JSON object.
The model wraps it in a ```json fence, so the parse must be fence-tolerant (the
same class of bug as lessons #166 / #200). No network: the Anthropic client is
mocked at construction and ``_call_model`` is stubbed per test, so the sanctioned
chokepoint is exercised without an API call.
"""

from __future__ import annotations

import pytest

from app.agents.clause_rewriter import ClauseRewriterAgent, _parse_rewrite_object


def _msg(text: str):
    """A fake Anthropic Message with .content[0].text == text."""
    block = type("Block", (), {"text": text})()
    return type("Message", (), {"content": [block]})()


FENCED = (
    '```json\n{'
    '"rewritten_title":"Payment Terms",'
    '"rewritten_content":"The Employer shall pay within 28 days.",'
    '"rationale":"Adds a firm payment deadline."'
    '}\n```'
)
CLEAN = (
    '{"rewritten_title":"T","rewritten_content":"Body.","rationale":"R"}'
)
ARABIC = (
    '```json\n{'
    '"rewritten_title":"شروط الدفع",'
    '"rewritten_content":"يلتزم صاحب العمل بالسداد خلال 28 يوماً.",'
    '"rationale":"Adds a firm deadline."'
    '}\n```'
)
PROSE = "Sorry, I could not rewrite this clause."


# ── the parser (pure function) ───────────────────────────────────────────────

def test_parse_fenced_object():
    out = _parse_rewrite_object(FENCED)
    assert out["rewritten_content"].startswith("The Employer")
    assert out["rewritten_title"] == "Payment Terms"


def test_parse_clean_object():
    assert _parse_rewrite_object(CLEAN)["rewritten_content"] == "Body."


def test_parse_prose_returns_empty_dict():
    assert _parse_rewrite_object(PROSE) == {}


def test_parse_preamble_then_fence():
    raw = "Here is the rewrite:\n```json\n" + CLEAN + "\n```"
    assert _parse_rewrite_object(raw)["rationale"] == "R"


# ── rewrite() end-to-end (mocked model call) ─────────────────────────────────

def test_rewrite_parses_fenced_response(mocker):
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = ClauseRewriterAgent()
    mocker.patch.object(agent, "_call_model", return_value=_msg(FENCED))
    out = agent.rewrite(clause_text="pay when able", recommendation="add a deadline")
    assert out["rewritten_content"].startswith("The Employer")
    assert out["rewritten_title"] == "Payment Terms"


def test_rewrite_preserves_arabic_output(mocker):
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = ClauseRewriterAgent()
    mocker.patch.object(agent, "_call_model", return_value=_msg(ARABIC))
    out = agent.rewrite(clause_text="نص عربي", recommendation="أضف مهلة")
    assert "صاحب العمل" in out["rewritten_content"]


def test_rewrite_echoes_original_title_when_model_omits_it(mocker):
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = ClauseRewriterAgent()
    body = '{"rewritten_content":"Body only.","rationale":"R"}'
    mocker.patch.object(agent, "_call_model", return_value=_msg(body))
    out = agent.rewrite(clause_text="x", clause_title="Original Title")
    assert out["rewritten_title"] == "Original Title"


def test_rewrite_raises_on_empty_content(mocker):
    """An empty rewrite must raise, so the caller never persists a blank proposal."""
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = ClauseRewriterAgent()
    mocker.patch.object(agent, "_call_model", return_value=_msg(PROSE))
    with pytest.raises(ValueError):
        agent.rewrite(clause_text="x", recommendation="y")


def test_rewrite_routes_through_call_model_chokepoint_with_scrub(mocker):
    """MUST route through _call_model with scrub=True (Camp-1) + max_tokens +
    system + messages — the ai-backend invariant."""
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = ClauseRewriterAgent()
    spy = mocker.patch.object(agent, "_call_model", return_value=_msg(CLEAN))
    agent.rewrite(clause_text="x", recommendation="y")
    _, kwargs = spy.call_args
    assert kwargs["scrub"] is True
    assert kwargs["max_tokens"] == 4096
    assert "system" in kwargs and "messages" in kwargs
