"""Prompt-caching wiring proofs (Step 1, Option B — opt-in at the chokepoint).

All Anthropic calls are mocked at ``app.agents.base_agent.Anthropic`` — no
network, no key. Contracts proven here:

  1. cache_system=False → the request payload is BYTE-IDENTICAL to before:
     ``system`` reaches the endpoint as the very same string object, keys
     unchanged.
  2. cache_system=True → ``system`` is wrapped as a single ephemeral
     cache_control text block; ``messages`` is untouched.
  3. cache_system=True + scrub=True → scrub runs FIRST (the wrapped block's
     text carries placeholders, never raw PII), THEN the block is wrapped.
  4. cache_system=True + raw=True → the RAW endpoint receives the wrapped
     system (clause_extractor's path).
  5. clause_extractor and risk_analyzer actually opt in (cache_system=True
     reaches the wire); the OTHER agents do NOT (summarizer stays a plain
     string — below the cache minimum / sparse).
  6. pricing accounts for cache write (1.25x) and read (0.1x).
"""
from __future__ import annotations

from app.agents import summarizer
from app.agents.base_agent import BaseAgent
from app.agents.clause_extractor import ClauseExtractorAgent, SYSTEM_PROMPT as CLAUSE_SYS
from app.agents.risk_analyzer import RiskAnalyzerAgent, SYSTEM_PROMPT as RISK_SYS
from tests.accuracy import pricing

_MOCK_TARGET = "app.agents.base_agent.Anthropic"


def _fake_message(text: str):
    block = type("TextBlock", (), {})()
    block.text = text
    msg = type("Message", (), {})()
    msg.content = [block]
    return msg


def _mock_client(mocker, ret_text: str = "[]"):
    client = mocker.patch(_MOCK_TARGET).return_value
    client.messages.create.return_value = _fake_message(ret_text)
    # raw endpoint: returns a wrapper whose .parse() yields the message
    raw = type("Raw", (), {})()
    raw.parse = lambda: _fake_message(ret_text)
    raw.headers = {}
    client.messages.with_raw_response.create.return_value = raw
    return client


# ── 1. cache_system=False → byte-identical passthrough ───────────────────────

def test_cache_system_false_is_byte_identical(mocker):
    client = _mock_client(mocker)
    agent = BaseAgent()
    system = "You are a helpful assistant."
    messages = [{"role": "user", "content": "hi"}]
    agent._call_model(system=system, messages=messages, max_tokens=64)

    kw = client.messages.create.call_args.kwargs
    assert kw["system"] is system  # same object, not wrapped
    assert kw["messages"] is messages
    assert set(kw) == {"model", "max_tokens", "system", "messages"}


# ── 2. cache_system=True → system wrapped, messages unchanged ────────────────

def test_cache_system_true_wraps_system(mocker):
    client = _mock_client(mocker)
    agent = BaseAgent()
    system = "SYSTEM RULES " * 50
    messages = [{"role": "user", "content": "hi"}]
    agent._call_model(system=system, messages=messages, max_tokens=64, cache_system=True)

    kw = client.messages.create.call_args.kwargs
    assert kw["system"] == [
        {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
    ]
    assert kw["messages"] is messages  # messages never touched
    # cache_system is consumed at the chokepoint — never forwarded to the API.
    assert "cache_system" not in kw
    assert set(kw) == {"model", "max_tokens", "system", "messages"}


def test_cache_system_true_empty_system_not_wrapped(mocker):
    client = _mock_client(mocker)
    agent = BaseAgent()
    agent._call_model(system="", messages=[{"role": "user", "content": "hi"}],
                      max_tokens=64, cache_system=True)
    assert client.messages.create.call_args.kwargs["system"] == ""


# ── 3. scrub runs BEFORE the wrap ────────────────────────────────────────────

def test_cache_system_true_scrubs_before_wrapping(mocker):
    client = _mock_client(mocker)
    agent = BaseAgent()
    email = "engineer@contractor-co.com"
    agent._call_model(
        scrub=True,
        cache_system=True,
        system=f"Escalate to {email} for approvals. " + ("rule " * 50),
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=64,
    )
    block = client.messages.create.call_args.kwargs["system"][0]
    assert block["cache_control"] == {"type": "ephemeral"}
    assert email not in block["text"]        # scrubbed first…
    assert "[EMAIL_1]" in block["text"]      # …then wrapped


# ── 4. raw path (clause_extractor) receives the wrapped system ───────────────

def test_cache_system_true_on_raw_path(mocker):
    client = _mock_client(mocker)
    agent = BaseAgent()
    system = "RAW RULES " * 50
    agent._call_model(
        raw=True,
        cache_system=True,
        system=system,
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=64,
    )
    # The raw endpoint — not the plain one — carries the wrapped block.
    assert client.messages.create.call_count == 0
    kw = client.messages.with_raw_response.create.call_args.kwargs
    assert kw["system"] == [
        {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
    ]


# ── 5. the two agents opt in; others do not ──────────────────────────────────

def test_clause_extractor_opts_into_caching(mocker):
    client = _mock_client(mocker)
    ClauseExtractorAgent().extract(full_text="مادة (1): تعريفات\nنص المادة.", document_label="GC")
    kw = client.messages.with_raw_response.create.call_args.kwargs
    assert isinstance(kw["system"], list)
    assert kw["system"][0]["text"] == CLAUSE_SYS
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}


def test_risk_analyzer_opts_into_caching(mocker):
    client = _mock_client(mocker)
    agent = RiskAnalyzerAgent()
    agent._analyze_batch([{"id": "c1", "text": "payment within 90 days"}], 0, 1, None)
    kw = client.messages.create.call_args.kwargs
    assert isinstance(kw["system"], list)
    assert kw["system"][0]["text"] == RISK_SYS
    assert kw["system"][0]["cache_control"] == {"type": "ephemeral"}


def test_summarizer_does_not_cache(mocker):
    client = _mock_client(mocker, ret_text='{"executive_summary": "ok"}')
    summarizer.SummarizerAgent().summarize("A short contract about widgets.")
    # No cache_control anywhere — system stays a plain string.
    assert isinstance(client.messages.create.call_args.kwargs["system"], str)


# ── 6. pricing accounts for cache write/read ─────────────────────────────────

def test_pricing_cache_write_and_read():
    model = "claude-sonnet-4-6"  # input $3/Mtok
    # 1000 cache-write tokens @1.25x + 1000 cache-read @0.1x, no plain input/output.
    cost = pricing.estimate_cost_usd(model, 0, 0,
                                     cache_creation_tokens=1000, cache_read_tokens=1000)
    expected = ((1000 * 1.25 + 1000 * 0.10) / 1_000_000) * 3.00
    assert abs(cost - expected) < 1e-12


def test_pricing_zero_cache_matches_original():
    model = "claude-sonnet-4-6"
    assert pricing.estimate_cost_usd(model, 1000, 500) == pricing.estimate_cost_usd(
        model, 1000, 500, 0, 0
    )
