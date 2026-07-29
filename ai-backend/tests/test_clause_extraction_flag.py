"""Step 3 — ClauseExtractorAgent routes to the flagged provider.

Mocks _call_model (no backend, no network). Confirms: default "claude" → ANTHROPIC;
"qwen" → OPENROUTER; the chunked path routes EVERY chunk to the flagged provider; the
clause-dict output shape is identical either way; cache_system is ignored on the
OpenRouter branch.
"""
from app.agents.base_agent import BaseAgent, ModelProvider

CLAUSE_JSON = (
    '[{"section_number": "1", "title": "T", "content": "C", '
    '"clause_type": "general", "confidence": 1.0}]'
)


class _FakeMsg:
    def __init__(self, text, stop="end_turn"):
        self.content = [type("B", (), {"text": text})()]
        self.stop_reason = stop


class _FakeRaw:
    """Quacks like the raw response _call_api_with_retry consumes."""

    def __init__(self, text, stop="end_turn"):
        self._m = _FakeMsg(text, stop)
        self.headers = {}

    def parse(self):
        return self._m


def _agent(monkeypatch, flag):
    monkeypatch.setenv("CLAUSE_EXTRACTION_PROVIDER", flag)
    from app.config.settings import get_settings

    get_settings.cache_clear()
    from app.agents.clause_extractor import ClauseExtractorAgent

    return ClauseExtractorAgent()


def _capture_call_model(monkeypatch, agent):
    """Replace _call_model with a capturing stub returning a valid clause array."""
    seen = []

    def stub(**kw):
        seen.append(kw)
        return _FakeRaw(CLAUSE_JSON)

    monkeypatch.setattr(agent, "_call_model", stub)
    return seen


def test_flag_claude_routes_anthropic_single(monkeypatch):
    agent = _agent(monkeypatch, "claude")
    seen = _capture_call_model(monkeypatch, agent)
    out = agent.extract("a short contract document")  # ≤30k → single call
    assert len(seen) == 1
    assert seen[0]["provider"] is ModelProvider.ANTHROPIC
    assert isinstance(out, list) and out
    assert {"section_number", "title", "content", "clause_type"} <= set(out[0])


def test_flag_qwen_routes_openrouter_single(monkeypatch):
    agent = _agent(monkeypatch, "qwen")
    seen = _capture_call_model(monkeypatch, agent)
    out = agent.extract("a short contract document")
    assert len(seen) == 1
    assert seen[0]["provider"] is ModelProvider.OPENROUTER
    # output shape IDENTICAL to the Anthropic path (same clause fields)
    assert {"section_number", "title", "content", "clause_type"} <= set(out[0])


def test_flag_qwen_chunked_routes_openrouter_every_chunk(monkeypatch):
    agent = _agent(monkeypatch, "qwen")
    seen = _capture_call_model(monkeypatch, agent)
    # >30k chars with multiple مادة boundaries → chunked into several calls.
    big = "".join(f"مادة ({i}) : عنوان\n" + ("محتوى نصية " * 1500) for i in range(1, 5))
    assert len(big) > 30_000
    agent.extract(big)
    assert len(seen) > 1                                   # genuinely chunked
    assert all(kw["provider"] is ModelProvider.OPENROUTER for kw in seen)  # EVERY chunk


def test_cache_system_ignored_on_openrouter(monkeypatch):
    # _call_model(provider=OPENROUTER, cache_system=True) must route to the client
    # WITHOUT crashing — cache_system is an Anthropic-only concern, ignored here.
    captured = {}
    monkeypatch.setattr(
        "app.services.openrouter_client.call_openrouter",
        lambda **kw: captured.update(kw) or "OK",
    )
    agent = BaseAgent()
    out = agent._call_model(
        provider=ModelProvider.OPENROUTER, system="S",
        messages=[{"role": "user", "content": "D"}], max_tokens=10, cache_system=True,
    )
    assert out == "OK"
    assert "cache_system" not in captured  # not forwarded as an unsupported field
