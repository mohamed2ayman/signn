"""The per-stage model overrides (Step 3) are respected, and default to the
centralized ANTHROPIC_MODEL when unset (production unchanged). Anthropic is
mocked — no key/network. get_settings is lru_cached; conftest clears it, and we
clear again after mutating env."""
from __future__ import annotations

from app.config.settings import get_settings


def test_risk_model_override_respected(mocker, monkeypatch):
    from app.agents.risk_analyzer import RiskAnalyzerAgent
    mocker.patch("app.agents.base_agent.Anthropic")
    monkeypatch.setenv("RISK_ANALYSIS_MODEL", "claude-haiku-4-5-20251001")
    get_settings.cache_clear()
    assert RiskAnalyzerAgent()._model == "claude-haiku-4-5-20251001"


def test_compliance_model_override_respected(mocker, monkeypatch):
    from app.agents.compliance_checker import ComplianceCheckerAgent
    mocker.patch("app.agents.base_agent.Anthropic")
    monkeypatch.setenv("COMPLIANCE_MODEL", "claude-haiku-4-5-20251001")
    get_settings.cache_clear()
    assert ComplianceCheckerAgent()._model == "claude-haiku-4-5-20251001"


def test_risk_defaults_to_anthropic_model_when_unset(mocker, monkeypatch):
    from app.agents.risk_analyzer import RiskAnalyzerAgent
    mocker.patch("app.agents.base_agent.Anthropic")
    monkeypatch.delenv("RISK_ANALYSIS_MODEL", raising=False)
    get_settings.cache_clear()
    assert RiskAnalyzerAgent()._model == get_settings().ANTHROPIC_MODEL == "claude-sonnet-4-6"


def test_compliance_defaults_to_anthropic_model_when_unset(mocker, monkeypatch):
    from app.agents.compliance_checker import ComplianceCheckerAgent
    mocker.patch("app.agents.base_agent.Anthropic")
    monkeypatch.delenv("COMPLIANCE_MODEL", raising=False)
    get_settings.cache_clear()
    assert ComplianceCheckerAgent()._model == get_settings().ANTHROPIC_MODEL == "claude-sonnet-4-6"


def test_override_is_isolated_to_that_agent(mocker, monkeypatch):
    """Setting RISK_ANALYSIS_MODEL must NOT change other agents (summarizer)."""
    from app.agents.risk_analyzer import RiskAnalyzerAgent
    from app.agents.summarizer import SummarizerAgent
    mocker.patch("app.agents.base_agent.Anthropic")
    monkeypatch.setenv("RISK_ANALYSIS_MODEL", "claude-haiku-4-5-20251001")
    monkeypatch.delenv("COMPLIANCE_MODEL", raising=False)
    get_settings.cache_clear()
    assert RiskAnalyzerAgent()._model == "claude-haiku-4-5-20251001"
    assert SummarizerAgent()._model == "claude-sonnet-4-6"  # untouched
