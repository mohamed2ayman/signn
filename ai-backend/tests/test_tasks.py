"""Unit tests for run_extract_clauses Celery task.

The task is called DIRECTLY as a plain Python function — the Celery broker
(Redis) is never touched.  This is possible because:
  • Celery tasks decorated with @celery_app.task are still callable as
    regular functions when invoked with task_function(None, payload).
  • The first positional argument (self / bind=True) is passed as None.

Mock target: "app.agents.clause_extractor.ClauseExtractorAgent"

The task imports ClauseExtractorAgent LAZILY inside the function body:
    from app.agents.clause_extractor import ClauseExtractorAgent
so we must patch at the module where the class lives, not at app.tasks.
"""

from __future__ import annotations

import pytest

from app.tasks import run_extract_clauses

# ─────────────────────────────────────────────────────────────────────────────
# Shared fake clause list
# ─────────────────────────────────────────────────────────────────────────────

FAKE_CLAUSES = [
    {
        "title": "Scope of Works",
        "content": "The Contractor shall complete all works described herein.",
        "clause_type": "scope_of_work",
        "section_number": "2",
        "confidence": 0.97,
    },
    {
        "title": "Payment Schedule",
        "content": "Payments shall be made in monthly instalments.",
        "clause_type": "payment",
        "section_number": "12",
        "confidence": 0.94,
    },
]

# ─────────────────────────────────────────────────────────────────────────────
# Test 1: valid input → completed status with clauses
# ─────────────────────────────────────────────────────────────────────────────

def test_run_extract_clauses_success(mocker):
    """run_extract_clauses with well-formed input should return
    {status: "completed", result: {clauses: [...]}}."""
    mock_agent_cls = mocker.patch("app.agents.clause_extractor.ClauseExtractorAgent")
    mock_agent_cls.return_value.extract.return_value = FAKE_CLAUSES

    # .run() is a bound method — self (the task instance) is already injected.
    # Pass only request_data.
    result = run_extract_clauses.run(
        {
            "full_text": "Sample contract text for FIDIC General Conditions.",
            "contract_type": "FIDIC_RED",
            "document_label": "General Conditions",
        },
    )

    assert result["status"] == "completed"
    assert "result" in result
    assert "clauses" in result["result"]
    assert result["result"]["clauses"] == FAKE_CLAUSES
    # Confirm the agent was actually instantiated and extract() was called
    mock_agent_cls.assert_called_once()
    mock_agent_cls.return_value.extract.assert_called_once_with(
        full_text="Sample contract text for FIDIC General Conditions.",
        contract_type="FIDIC_RED",
        document_label="General Conditions",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test 2: agent raises exception → failed status, no re-raise
# ─────────────────────────────────────────────────────────────────────────────

def test_run_extract_clauses_agent_exception_returns_failed(mocker):
    """When ClauseExtractorAgent.extract() raises, the task must catch it and
    return {status: "failed", error: <message>} — never re-raise."""
    mock_agent_cls = mocker.patch("app.agents.clause_extractor.ClauseExtractorAgent")
    mock_agent_cls.return_value.extract.side_effect = Exception("API timeout")

    result = run_extract_clauses.run(
        {
            "full_text": "Some text.",
            "contract_type": None,
            "document_label": None,
        },
    )

    assert result["status"] == "failed"
    assert "error" in result
    assert "API timeout" in result["error"]


# ─────────────────────────────────────────────────────────────────────────────
# Test 3: missing full_text key → failed status (KeyError handled gracefully)
# ─────────────────────────────────────────────────────────────────────────────

def test_run_extract_clauses_missing_full_text_returns_failed(mocker):
    """Calling with an empty dict (no 'full_text' key) should return
    {status: "failed"} — the task catches the KeyError rather than crashing.

    The KeyError fires at request_data["full_text"] in the task body itself,
    BEFORE extract() is ever called.  We still mock ClauseExtractorAgent so
    the Anthropic client is never created (the constructor runs first).
    """
    # Mock the class so ClauseExtractorAgent() instantiation is safe
    mocker.patch("app.agents.clause_extractor.ClauseExtractorAgent")
    # No side_effect needed — the KeyError is raised by the task body:
    #   full_text=request_data["full_text"]  ← KeyError here

    result = run_extract_clauses.run({})

    assert result["status"] == "failed"
    assert "error" in result
