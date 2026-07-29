"""Step 4 — per-document OpenRouter cost ceiling.

Exercises ClauseExtractorAgent's cost accounting by mocking _call_model to return
a raw response carrying a usage_cost — no network, no billing. Confirms: a document
whose cumulative spend blows OPENROUTER_CLAUSE_MAX_COST_USD FAILS LOUDLY
(CostCeilingExceeded) rather than returning over-billed clauses; a run under the
ceiling completes; and the Anthropic (claude) path has NO budget at all.
"""
import pytest

from app.agents.base_agent import ModelProvider
from app.services.openrouter_client import CostCeilingExceeded

CLAUSE_JSON = (
    '[{"section_number": "1", "title": "T", "content": "C", '
    '"clause_type": "general", "confidence": 1.0}]'
)


class _FakeMsg:
    def __init__(self, text, stop="end_turn"):
        self.content = [type("B", (), {"text": text})()]
        self.stop_reason = stop


class _FakeRawCost:
    """Quacks like the raw response, and carries a usage_cost (OpenRouter)."""

    def __init__(self, text, cost, stop="end_turn"):
        self._m = _FakeMsg(text, stop)
        self.headers = {}
        self.usage_cost = cost

    def parse(self):
        return self._m


def _qwen_agent(monkeypatch, ceiling):
    monkeypatch.setenv("CLAUSE_EXTRACTION_PROVIDER", "qwen")
    monkeypatch.setenv("OPENROUTER_CLAUSE_MAX_COST_USD", str(ceiling))
    from app.config.settings import get_settings

    get_settings.cache_clear()
    from app.agents.clause_extractor import ClauseExtractorAgent

    return ClauseExtractorAgent()


def _stub_cost(monkeypatch, agent, cost):
    monkeypatch.setattr(agent, "_call_model", lambda **kw: _FakeRawCost(CLAUSE_JSON, cost))


def test_single_call_over_ceiling_raises(monkeypatch):
    agent = _qwen_agent(monkeypatch, ceiling=0.01)
    _stub_cost(monkeypatch, agent, cost=0.03)  # one call already blows $0.01
    with pytest.raises(CostCeilingExceeded):
        agent.extract("a short contract document")  # ≤30k → single call


def test_chunked_cumulative_over_ceiling_raises(monkeypatch):
    agent = _qwen_agent(monkeypatch, ceiling=0.05)
    _stub_cost(monkeypatch, agent, cost=0.03)  # ≥2 chunks × $0.03 > $0.05
    big = "".join(f"مادة ({i}) : عنوان\n" + ("محتوى " * 2000) for i in range(1, 5))
    assert len(big) > 30_000
    with pytest.raises(CostCeilingExceeded):
        agent.extract(big)


def test_under_ceiling_completes(monkeypatch):
    agent = _qwen_agent(monkeypatch, ceiling=10.0)
    _stub_cost(monkeypatch, agent, cost=0.001)  # nowhere near $10
    out = agent.extract("a short contract document")
    assert isinstance(out, list) and out
    assert {"section_number", "title", "content", "clause_type"} <= set(out[0])


def test_claude_path_has_no_cost_budget(monkeypatch):
    # Default provider → no CostBudget is created → the cost gate is a pure no-op,
    # so extraction is byte-unchanged and can NEVER raise a ceiling error.
    monkeypatch.setenv("CLAUSE_EXTRACTION_PROVIDER", "claude")
    from app.config.settings import get_settings

    get_settings.cache_clear()
    from app.agents.clause_extractor import ClauseExtractorAgent

    agent = ClauseExtractorAgent()

    class _FakeRawNoCost:
        def __init__(self, text):
            self._m = _FakeMsg(text)
            self.headers = {}

        def parse(self):
            return self._m

    monkeypatch.setattr(agent, "_call_model", lambda **kw: _FakeRawNoCost(CLAUSE_JSON))
    out = agent.extract("a short contract document")
    assert isinstance(out, list) and out
    assert agent._clause_provider is ModelProvider.ANTHROPIC
    assert agent._cost_budget is None  # no budget on the Anthropic path
