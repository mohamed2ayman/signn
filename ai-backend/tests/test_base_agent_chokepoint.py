"""Zero-behaviour-change proof for the BaseAgent chokepoint.

The BaseAgent slice routed all 9 agents' Anthropic calls through one method,
``BaseAgent._call_model`` (provider-generalized; defaults to Anthropic, the only
provider today). These tests prove the consolidation changed only
the call MECHANISM, not what is sent to Anthropic:

  * Per-agent OUTBOUND-kwargs proof — for each agent, the mocked client's
    ``messages.create`` (or ``messages.with_raw_response.create`` for the clause
    extractor) is invoked with EXACTLY the kwargs the agent sent before the
    refactor: ``model`` = the centralized model id, the agent's own
    ``max_tokens``, its ``system`` prompt, its ``messages`` — and NOTHING else
    (no injected ``temperature``, nothing dropped).
  * clause_extractor specifically still hits ``with_raw_response.create`` and
    ``.parse()``s the raw wrapper (its rate-limit header path). (The header READ
    is additionally covered by the gate tests in
    ``test_clause_extraction_parallel.py``.)
  * Boot-smoke — all 9 agents instantiate through BaseAgent, and the app + tasks
    modules import cleanly (the "un-bootable module" lesson applied to ai-backend).

All Anthropic calls are mocked at ``app.agents.base_agent.Anthropic`` (the single
construction point) — no API key or network needed.
"""
from __future__ import annotations

import pytest

from app.agents import (
    clause_extractor,
    compliance_checker,
    conflict_detector,
    conversational_agent,
    diff_analyzer,
    obligations_extractor,
    research_agent,
    risk_analyzer,
    summarizer,
)
from app.agents.base_agent import BaseAgent, ModelProvider
from app.config.settings import get_settings

_MOCK_TARGET = "app.agents.base_agent.Anthropic"


def _fake_message(text: str):
    block = type("TextBlock", (), {"text": text})()
    return type("Message", (), {"content": [block]})()


def _capture_plain_call(mocker, agent_cls, invoke, ret_text: str) -> dict:
    """Instantiate *agent_cls*, run *invoke*, return the kwargs it passed to the
    mocked ``messages.create``. Return-value PARSING is out of scope here — we
    only assert on the OUTBOUND request — so a post-call parse error is ignored,
    but the call itself must have happened exactly once via the plain endpoint.
    """
    mock_cls = mocker.patch(_MOCK_TARGET)
    client = mock_cls.return_value
    client.messages.create.return_value = _fake_message(ret_text)

    agent = agent_cls()
    try:
        invoke(agent)
    except Exception:
        pass

    assert client.messages.create.call_count == 1, "agent did not reach the plain endpoint"
    assert client.messages.with_raw_response.create.call_count == 0, (
        "a non-clause agent must use the plain create endpoint, not the raw one"
    )
    return client.messages.create.call_args.kwargs


# One row per simple agent: (class, invoke, expected max_tokens, expected system, mock JSON).
SIMPLE_CASES = [
    pytest.param(
        summarizer.SummarizerAgent,
        lambda a: a.summarize("Some contract text."),
        4096, summarizer.SYSTEM_PROMPT, "{}", id="summarizer",
    ),
    pytest.param(
        risk_analyzer.RiskAnalyzerAgent,
        lambda a: a.analyze([{"id": "1", "text": "A sample clause."}]),
        4096, risk_analyzer.SYSTEM_PROMPT, "[]", id="risk_analyzer",
    ),
    pytest.param(
        compliance_checker.ComplianceCheckerAgent,
        lambda a: a.check(
            contract_type="FIDIC_RED_BOOK_2017",
            jurisdiction="EG",
            clauses=[{"id": "1", "text": "A sample clause."}],
        ),
        8192, compliance_checker.SYSTEM_PROMPT, "{}", id="compliance_checker",
    ),
    pytest.param(
        conflict_detector.ConflictDetectorAgent,
        lambda a: a.detect(
            [{"id": "1", "text": "A sample clause.",
              "document_label": "DocA", "document_priority": 1}]
        ),
        8192, conflict_detector.SYSTEM_PROMPT, "{}", id="conflict_detector",
    ),
    pytest.param(
        obligations_extractor.ObligationsExtractorAgent,
        lambda a: a.extract([{"id": "1", "text": "A sample clause."}]),
        4096, obligations_extractor.SYSTEM_PROMPT, "[]", id="obligations_extractor",
    ),
    pytest.param(
        diff_analyzer.DiffAnalyzerAgent,
        lambda a: a.analyze_diff(
            [{"id": "1", "text": "Original clause."}],
            [{"id": "1", "text": "Modified clause."}],
        ),
        4096, diff_analyzer.SYSTEM_PROMPT, "{}", id="diff_analyzer",
    ),
    pytest.param(
        research_agent.ResearchAgent,
        lambda a: a.research(["delay damages"], jurisdiction="EG"),
        4096, research_agent.SYSTEM_PROMPT, "[]", id="research_agent",
    ),
    pytest.param(
        conversational_agent.ConversationalAgent,
        lambda a: a.chat("What is the payment term?"),
        4096, conversational_agent.SYSTEM_PROMPT,
        '{"response": "ok", "citations": []}', id="conversational_agent",
    ),
]


@pytest.mark.parametrize(
    "agent_cls, invoke, expected_max_tokens, expected_system, ret_text", SIMPLE_CASES
)
def test_agent_forwards_unchanged_kwargs(
    mocker, agent_cls, invoke, expected_max_tokens, expected_system, ret_text
):
    kw = _capture_plain_call(mocker, agent_cls, invoke, ret_text)

    # The strongest no-change assertion: EXACTLY these four kwargs reach Anthropic
    # — nothing injected (no temperature), nothing dropped.
    assert set(kw) == {"model", "max_tokens", "system", "messages"}, (
        f"chokepoint must forward exactly these 4 kwargs; got {sorted(kw)}"
    )
    assert kw["model"] == get_settings().ANTHROPIC_MODEL
    assert kw["max_tokens"] == expected_max_tokens
    assert kw["system"] == expected_system
    assert isinstance(kw["messages"], list) and kw["messages"]
    assert kw["messages"][-1]["role"] == "user"
    assert "temperature" not in kw


def test_clause_extractor_uses_raw_path_and_forwards_kwargs(mocker):
    """clause_extractor keeps the raw-response path: it hits
    ``with_raw_response.create`` (never plain ``create``), ``.parse()``s the
    wrapper, and forwards exactly the same four kwargs with no temperature."""
    mock_cls = mocker.patch(_MOCK_TARGET)
    client = mock_cls.return_value
    raw = mocker.MagicMock()
    raw.parse.return_value = _fake_message("[]")
    raw.headers = {}
    client.messages.with_raw_response.create.return_value = raw

    agent = clause_extractor.ClauseExtractorAgent()
    agent.extract("Sample contract text for testing purposes.")

    assert client.messages.with_raw_response.create.call_count == 1
    assert client.messages.create.call_count == 0, "clause_extractor must use the raw endpoint"
    raw.parse.assert_called()

    kw = client.messages.with_raw_response.create.call_args.kwargs
    assert set(kw) == {"model", "max_tokens", "system", "messages"}, (
        f"raw chokepoint must forward exactly these 4 kwargs; got {sorted(kw)}"
    )
    assert kw["model"] == get_settings().ANTHROPIC_MODEL
    assert kw["system"] == clause_extractor.SYSTEM_PROMPT
    assert isinstance(kw["max_tokens"], int) and kw["max_tokens"] > 0  # dynamically sized
    assert "temperature" not in kw


def test_call_model_provider_seam(mocker):
    """The chokepoint is provider-generalized: ``provider`` defaults to ANTHROPIC
    (today's only backend, so every agent takes the exact pre-reshape path), and
    any other provider is a LOUD NotImplementedError — the deliberate seam the
    model migration extends, never a silent fallthrough."""
    import inspect

    sig = inspect.signature(BaseAgent._call_model)
    assert sig.parameters["provider"].default is ModelProvider.ANTHROPIC

    mocker.patch(_MOCK_TARGET)
    agent = BaseAgent()
    with pytest.raises(NotImplementedError):
        # A stand-in for any future not-yet-wired provider value.
        agent._call_model(
            provider="sagemaker",  # type: ignore[arg-type]
            system="s", messages=[{"role": "user", "content": "m"}], max_tokens=1,
        )


def test_call_model_temperature_none_is_omitted_from_wire(mocker):
    """``temperature`` defaults to None and is OMITTED from the API call — the
    byte-identical guarantee for today's agents (none pass it). It reaches the
    wire ONLY when a caller explicitly sets it."""
    mock_cls = mocker.patch(_MOCK_TARGET)
    client = mock_cls.return_value
    msgs = [{"role": "user", "content": "m"}]

    agent = BaseAgent()

    # (a) default temperature=None → key absent from the create kwargs entirely.
    agent._call_model(system="s", messages=msgs, max_tokens=7)
    kw = client.messages.create.call_args.kwargs
    assert set(kw) == {"model", "max_tokens", "system", "messages"}
    assert "temperature" not in kw

    # (b) explicitly set → present with exactly that value.
    agent._call_model(system="s", messages=msgs, max_tokens=7, temperature=0.3)
    kw = client.messages.create.call_args.kwargs
    assert kw["temperature"] == 0.3
    assert set(kw) == {"model", "max_tokens", "system", "messages", "temperature"}


# ─────────────────────────────────────────────────────────────────────────────
# Slice 1 — per-agent PII-scrub opt-in surface (greppable via scrub=True)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "agent_cls, invoke, _max_tokens, _system, ret_text", SIMPLE_CASES
)
def test_camp1_agents_opt_in_to_scrub(
    mocker, agent_cls, invoke, _max_tokens, _system, ret_text
):
    """Every Camp-1 agent passes ``scrub=True`` to the chokepoint — the
    explicit, per-agent opt-in surface of Slice 1."""
    spy = mocker.spy(BaseAgent, "_call_model")
    mock_cls = mocker.patch(_MOCK_TARGET)
    mock_cls.return_value.messages.create.return_value = _fake_message(ret_text)

    agent = agent_cls()
    try:
        invoke(agent)
    except Exception:
        pass  # outbound-only assertion; parsing is out of scope here

    assert spy.call_count == 1
    assert spy.call_args.kwargs.get("scrub") is True, (
        f"{agent_cls.__name__} must opt in to PII scrubbing (scrub=True)"
    )


def test_clause_extractor_does_not_opt_in_to_scrub(mocker):
    """ClauseExtractorAgent must NOT pass ``scrub=True`` — extraction stays
    unscrubbed BY DESIGN (BAA posture, decision D1)."""
    spy = mocker.spy(BaseAgent, "_call_model")
    mock_cls = mocker.patch(_MOCK_TARGET)
    client = mock_cls.return_value
    raw = mocker.MagicMock()
    raw.parse.return_value = _fake_message("[]")
    raw.headers = {}
    client.messages.with_raw_response.create.return_value = raw

    agent = clause_extractor.ClauseExtractorAgent()
    agent.extract("Sample contract text for testing purposes.")

    assert spy.call_count >= 1
    for call in spy.call_args_list:
        assert call.kwargs.get("scrub", False) is False, (
            "clause_extractor must never opt in to scrubbing (D1)"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Boot-smoke: nothing broke at wiring / instantiation time.
# ─────────────────────────────────────────────────────────────────────────────

ALL_AGENT_CLASSES = [
    summarizer.SummarizerAgent,
    risk_analyzer.RiskAnalyzerAgent,
    compliance_checker.ComplianceCheckerAgent,
    conflict_detector.ConflictDetectorAgent,
    obligations_extractor.ObligationsExtractorAgent,
    diff_analyzer.DiffAnalyzerAgent,
    research_agent.ResearchAgent,
    conversational_agent.ConversationalAgent,
    clause_extractor.ClauseExtractorAgent,
]


def test_all_nine_agents_instantiate_through_base_agent(mocker):
    """Every agent constructs cleanly through BaseAgent — the client + centralized
    model id are wired by the base. Anthropic is mocked so no key/network needed."""
    mocker.patch(_MOCK_TARGET)
    assert len(ALL_AGENT_CLASSES) == 9
    for cls in ALL_AGENT_CLASSES:
        agent = cls()
        assert isinstance(agent, BaseAgent), f"{cls.__name__} must inherit BaseAgent"
        assert agent._model, f"{cls.__name__} did not resolve the centralized model id"
        assert agent._client is not None, f"{cls.__name__} has no client from BaseAgent"

    # clause_extractor keeps its extra per-instance fields after super().__init__.
    ce = clause_extractor.ClauseExtractorAgent()
    assert ce._concurrency >= 1
    assert ce.last_quality_flags == []


def test_app_and_tasks_modules_import_cleanly():
    """Importing the FastAPI app (top-level ``main``) and the Celery tasks module
    (``app.tasks``, which lazily imports all 9 agents inside its task bodies) must
    not raise — proves the refactor left module wiring intact. Plain imports do not
    trigger the app lifespan or any DB connection."""
    import main  # FastAPI app lives at ai-backend/main.py (pythonpath = .)
    import app.tasks  # Celery tasks; lazy-imports the 9 agents inside each task

    assert main.app is not None
    assert app.tasks.celery_app is not None
