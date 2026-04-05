"""Celery tasks that execute AI agent work asynchronously."""

from __future__ import annotations

import json
from typing import Any

from celery import Celery

from app.config.settings import get_settings

settings = get_settings()

celery_app = Celery(
    "sign_ai",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    result_expires=3600,  # Results expire after 1 hour
    task_track_started=True,
)


@celery_app.task(name="tasks.run_risk_analysis", bind=True)
def run_risk_analysis(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Execute risk analysis on contract clauses."""
    from app.agents.risk_analyzer import RiskAnalyzerAgent

    agent = RiskAnalyzerAgent()
    try:
        risks = agent.analyze(
            clauses=request_data["clauses"],
            knowledge_context=request_data.get("knowledge_context"),
        )
        return {"status": "completed", "result": {"risks": risks}}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_summarize", bind=True)
def run_summarize(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Generate a structured contract summary."""
    from app.agents.summarizer import SummarizerAgent

    agent = SummarizerAgent()
    try:
        summary = agent.summarize(full_text=request_data["full_text"])
        return {"status": "completed", "result": {"summary": summary}}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_diff_analysis", bind=True)
def run_diff_analysis(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Analyze differences between contract versions."""
    from app.agents.diff_analyzer import DiffAnalyzerAgent

    agent = DiffAnalyzerAgent()
    try:
        result = agent.analyze_diff(
            original_clauses=request_data["original_clauses"],
            modified_clauses=request_data["modified_clauses"],
        )
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_extract_obligations", bind=True)
def run_extract_obligations(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Extract obligations from contract clauses."""
    from app.agents.obligations_extractor import ObligationsExtractorAgent

    agent = ObligationsExtractorAgent()
    try:
        obligations = agent.extract(clauses=request_data["clauses"])
        return {"status": "completed", "result": {"obligations": obligations}}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_conflict_detection", bind=True)
def run_conflict_detection(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Detect conflicts between clauses from different documents."""
    from app.agents.conflict_detector import ConflictDetectorAgent

    agent = ConflictDetectorAgent()
    try:
        result = agent.detect(clauses=request_data["clauses"])
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_chat", bind=True)
def run_chat(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Run a conversational chat interaction."""
    from app.agents.conversational_agent import ConversationalAgent

    agent = ConversationalAgent()
    try:
        result = agent.chat(
            message=request_data["message"],
            contract_context=request_data.get("contract_context"),
            knowledge_context=request_data.get("knowledge_context"),
            history=request_data.get("history"),
        )
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_research", bind=True)
def run_research(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Research legal assets by keywords and jurisdiction."""
    from app.agents.research_agent import ResearchAgent

    agent = ResearchAgent()
    try:
        assets = agent.research(
            keywords=request_data["keywords"],
            jurisdiction=request_data.get("jurisdiction"),
        )
        return {"status": "completed", "result": {"discovered_assets": assets}}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_extract_text", bind=True)
def run_extract_text(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Extract text content from an uploaded document file."""
    from app.services.text_extractor import TextExtractorService

    service = TextExtractorService()
    try:
        result = service.extract(
            file_path=request_data["file_path"],
            mime_type=request_data["mime_type"],
        )
        return {"status": "completed", "result": result}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@celery_app.task(name="tasks.run_extract_clauses", bind=True)
def run_extract_clauses(self, request_data: dict[str, Any]) -> dict[str, Any]:
    """Extract structured clauses from contract text using AI."""
    from app.agents.clause_extractor import ClauseExtractorAgent

    agent = ClauseExtractorAgent()
    try:
        clauses = agent.extract(
            full_text=request_data["full_text"],
            contract_type=request_data.get("contract_type"),
        )
        return {"status": "completed", "result": {"clauses": clauses}}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
