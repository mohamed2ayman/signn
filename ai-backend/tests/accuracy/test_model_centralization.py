"""Guards the model centralization — NO API calls (runs in CI).

Phase 8.1 gave the Claude model id a SINGLE source of truth
(``settings.ANTHROPIC_MODEL``). The BaseAgent chokepoint slice consolidated the
per-agent Anthropic client + model wiring into ``app/agents/base_agent.py``, so
the centralized literals (``self._model = settings.ANTHROPIC_MODEL`` and
``model=self._model``) now live in ONE place — the base — and every agent
inherits ``BaseAgent`` and routes its call through ``self._call_model(...)``
(provider-generalized; defaults to Anthropic, the only provider today).

These tests assert that stronger invariant:
  * the 9 agents are all present (base_agent.py excluded from that set);
  * the centralized model literals live in base_agent.py (the single source);
  * every agent inherits BaseAgent, routes through the chokepoint, and does NOT
    reintroduce its own client construction or model read;
  * no file (the 9 agents OR the base) hardcodes a "claude-..." model literal.
"""
from __future__ import annotations

import re
from pathlib import Path

from app.config.settings import Settings, get_settings

_AGENTS_DIR = Path(__file__).parents[2] / "app" / "agents"
_BASE_AGENT = _AGENTS_DIR / "base_agent.py"
# The agent files, EXCLUDING the shared base and the package marker.
_AGENT_FILES = sorted(
    p
    for p in _AGENTS_DIR.glob("*.py")
    if p.name not in {"__init__.py", "base_agent.py"}
)

# The 9 Claude agents that must inherit BaseAgent and route through the chokepoint.
EXPECTED_AGENTS = {
    "clause_extractor.py", "risk_analyzer.py", "compliance_checker.py",
    "conflict_detector.py", "obligations_extractor.py", "summarizer.py",
    "diff_analyzer.py", "conversational_agent.py", "research_agent.py",
}


def test_all_nine_agents_present():
    assert {p.name for p in _AGENT_FILES} == EXPECTED_AGENTS


def test_settings_default_model_is_sonnet():
    # Assert on the declared default so the test is robust to env overrides.
    assert Settings.model_fields["ANTHROPIC_MODEL"].default == "claude-sonnet-4-6"
    assert isinstance(get_settings().ANTHROPIC_MODEL, str)
    assert get_settings().ANTHROPIC_MODEL


def test_no_file_hardcodes_a_model_literal():
    # Covers the 9 agents AND base_agent.py — no one may reintroduce a literal.
    offenders = []
    for p in [*_AGENT_FILES, _BASE_AGENT]:
        if re.search(r'model\s*=\s*["\']claude-', p.read_text(encoding="utf-8")):
            offenders.append(p.name)
    assert offenders == [], f"files hardcode a model literal: {offenders}"


def test_centralized_model_lives_in_base_agent():
    # The single source of truth: BaseAgent reads the model and injects it once.
    src = _BASE_AGENT.read_text(encoding="utf-8")
    assert "self._model = settings.ANTHROPIC_MODEL" in src, (
        "base_agent.py must read the centralized model id"
    )
    assert "model=self._model" in src, (
        "base_agent.py must inject model=self._model into the Anthropic call"
    )


def test_every_agent_inherits_base_and_routes_through_chokepoint():
    for p in _AGENT_FILES:
        src = p.read_text(encoding="utf-8")
        assert "from app.agents.base_agent import BaseAgent" in src, (
            f"{p.name} must import BaseAgent"
        )
        assert re.search(r"class \w+\(BaseAgent\)", src), (
            f"{p.name} must inherit BaseAgent"
        )
        assert "self._call_model(" in src, (
            f"{p.name} must route its model call through self._call_model()"
        )
        # And must NOT bypass the chokepoint by rebuilding its own client or
        # re-reading the model directly — those now live only in BaseAgent.
        assert not re.search(r"=\s*Anthropic\(", src), (
            f"{p.name} must not construct its own Anthropic client"
        )
        assert "self._model = settings.ANTHROPIC_MODEL" not in src, (
            f"{p.name} must not read the model directly — it inherits it from BaseAgent"
        )
