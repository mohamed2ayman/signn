"""Router for AI agent endpoints.

Each endpoint dispatches a Celery task and returns a job_id so the caller
can poll for results asynchronously.
"""

from __future__ import annotations

import uuid
from typing import Any

from celery import Celery
from fastapi import APIRouter

from app.config.settings import get_settings
from app.models.schemas import (
    AsyncJobResponse,
    ChatRequest,
    ChatResponse,
    ClauseExtractionRequest,
    ClauseExtractionResponse,
    DiffRequest,
    DiffResponse,
    ObligationsRequest,
    ObligationsResponse,
    ResearchRequest,
    ResearchResponse,
    RiskAnalysisRequest,
    RiskAnalysisResponse,
    SummarizeRequest,
    SummarizeResponse,
    TextExtractionRequest,
    TextExtractionResponse,
)

router = APIRouter(prefix="/agents")

settings = get_settings()
celery_app = Celery("sign_ai", broker=settings.REDIS_URL, backend=settings.REDIS_URL)


# ---------------------------------------------------------------------------
# Risk Analysis
# ---------------------------------------------------------------------------

@router.post(
    "/risk-analysis",
    response_model=AsyncJobResponse,
    summary="Analyse contract clauses for risks",
)
async def risk_analysis(request: RiskAnalysisRequest) -> AsyncJobResponse:
    """Dispatch a risk-analysis task to the Celery worker."""
    job_id = str(uuid.uuid4())
    celery_app.send_task(
        "tasks.run_risk_analysis",
        args=[request.model_dump()],
        task_id=job_id,
    )
    return AsyncJobResponse(job_id=job_id, status="queued")


# ---------------------------------------------------------------------------
# Summarise
# ---------------------------------------------------------------------------

@router.post(
    "/summarize",
    response_model=AsyncJobResponse,
    summary="Generate a structured contract summary",
)
async def summarize(request: SummarizeRequest) -> AsyncJobResponse:
    """Dispatch a summarisation task to the Celery worker."""
    job_id = str(uuid.uuid4())
    celery_app.send_task(
        "tasks.run_summarize",
        args=[request.model_dump()],
        task_id=job_id,
    )
    return AsyncJobResponse(job_id=job_id, status="queued")


# ---------------------------------------------------------------------------
# Diff Analysis
# ---------------------------------------------------------------------------

@router.post(
    "/diff",
    response_model=AsyncJobResponse,
    summary="Analyse differences between contract versions",
)
async def diff_analysis(request: DiffRequest) -> AsyncJobResponse:
    """Dispatch a diff-analysis task to the Celery worker."""
    job_id = str(uuid.uuid4())
    celery_app.send_task(
        "tasks.run_diff_analysis",
        args=[request.model_dump()],
        task_id=job_id,
    )
    return AsyncJobResponse(job_id=job_id, status="queued")


# ---------------------------------------------------------------------------
# Obligations Extraction
# ---------------------------------------------------------------------------

@router.post(
    "/extract-obligations",
    response_model=AsyncJobResponse,
    summary="Extract obligations from contract clauses",
)
async def extract_obligations(request: ObligationsRequest) -> AsyncJobResponse:
    """Dispatch an obligations-extraction task to the Celery worker."""
    job_id = str(uuid.uuid4())
    celery_app.send_task(
        "tasks.run_extract_obligations",
        args=[request.model_dump()],
        task_id=job_id,
    )
    return AsyncJobResponse(job_id=job_id, status="queued")


# ---------------------------------------------------------------------------
# Conversational Chat
# ---------------------------------------------------------------------------

@router.post(
    "/chat",
    response_model=AsyncJobResponse,
    summary="Chat with the AI about a contract",
)
async def chat(request: ChatRequest) -> AsyncJobResponse:
    """Dispatch a conversational-chat task to the Celery worker."""
    job_id = str(uuid.uuid4())
    celery_app.send_task(
        "tasks.run_chat",
        args=[request.model_dump()],
        task_id=job_id,
    )
    return AsyncJobResponse(job_id=job_id, status="queued")


# ---------------------------------------------------------------------------
# Research
# ---------------------------------------------------------------------------

@router.post(
    "/research",
    response_model=AsyncJobResponse,
    summary="Research legal assets by keywords and jurisdiction",
)
async def research(request: ResearchRequest) -> AsyncJobResponse:
    """Dispatch a research task to the Celery worker."""
    job_id = str(uuid.uuid4())
    celery_app.send_task(
        "tasks.run_research",
        args=[request.model_dump()],
        task_id=job_id,
    )
    return AsyncJobResponse(job_id=job_id, status="queued")


# ---------------------------------------------------------------------------
# Text Extraction
# ---------------------------------------------------------------------------

@router.post(
    "/extract-text",
    response_model=AsyncJobResponse,
    summary="Extract text from an uploaded document file",
)
async def extract_text(request: TextExtractionRequest) -> AsyncJobResponse:
    """Dispatch a text-extraction task to the Celery worker."""
    job_id = str(uuid.uuid4())
    celery_app.send_task(
        "tasks.run_extract_text",
        args=[request.model_dump()],
        task_id=job_id,
    )
    return AsyncJobResponse(job_id=job_id, status="queued")


# ---------------------------------------------------------------------------
# Clause Extraction
# ---------------------------------------------------------------------------

@router.post(
    "/extract-clauses",
    response_model=AsyncJobResponse,
    summary="Extract structured clauses from contract text",
)
async def extract_clauses(request: ClauseExtractionRequest) -> AsyncJobResponse:
    """Dispatch a clause-extraction task to the Celery worker."""
    job_id = str(uuid.uuid4())
    celery_app.send_task(
        "tasks.run_extract_clauses",
        args=[request.model_dump()],
        task_id=job_id,
    )
    return AsyncJobResponse(job_id=job_id, status="queued")


# ---------------------------------------------------------------------------
# Job Status Polling
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}",
    summary="Check status of an async AI job",
)
async def get_job_status(job_id: str) -> dict[str, Any]:
    """Poll the status of a previously dispatched Celery task."""
    result = celery_app.AsyncResult(job_id)

    if result.state == "PENDING":
        return {"job_id": job_id, "status": "pending"}
    elif result.state == "STARTED":
        return {"job_id": job_id, "status": "processing"}
    elif result.state == "SUCCESS":
        return {"job_id": job_id, "status": "completed", "result": result.result}
    elif result.state == "FAILURE":
        return {"job_id": job_id, "status": "failed", "error": str(result.result)}
    else:
        return {"job_id": job_id, "status": result.state.lower()}
