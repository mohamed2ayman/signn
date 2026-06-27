"""Guards the Phase 8.1 model centralization — NO API calls (runs in CI).

Asserts the Claude model id has a SINGLE source of truth (settings.ANTHROPIC_MODEL)
and that no agent reintroduced a hardcoded model literal.
"""
from __future__ import annotations

import re
from pathlib import Path

from app.config.settings import Settings, get_settings

_AGENTS_DIR = Path(__file__).parents[2] / "app" / "agents"
_AGENT_FILES = sorted(
    p for p in _AGENTS_DIR.glob("*.py") if p.name != "__init__.py"
)

# The 9 Claude agents that must read the centralized model id.
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


def test_no_agent_hardcodes_a_model_literal():
    offenders = []
    for p in _AGENT_FILES:
        if re.search(r'model\s*=\s*["\']claude-', p.read_text(encoding="utf-8")):
            offenders.append(p.name)
    assert offenders == [], f"agents hardcode a model literal: {offenders}"


def test_every_agent_reads_centralized_model():
    for p in _AGENT_FILES:
        src = p.read_text(encoding="utf-8")
        assert "self._model = settings.ANTHROPIC_MODEL" in src, f"{p.name} missing self._model"
        assert "model=self._model" in src, f"{p.name} does not pass model=self._model"
