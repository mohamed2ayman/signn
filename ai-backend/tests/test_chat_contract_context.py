"""Guest chat Slice 1 — contract_context must survive the HTTP boundary.

The gap this guards (recon Gap 2b): ``tasks.run_chat`` has always read
``request_data.get("contract_context")`` and ``ConversationalAgent.chat()``
has always accepted it — but the field was MISSING from the ``ChatRequest``
pydantic model, so pydantic (extra=ignore) silently DROPPED it at the FastAPI
boundary and it never reached the agent. The pre-existing test
(test_chat_legal_context.py) calls ``tasks.run_chat.run(dict)`` directly,
bypassing pydantic — which is exactly why the drop was never caught.

These tests pin the FULL path: model → route dispatch → task → agent.
No real Anthropic or Celery calls — send_task and the agent are mocked.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from fastapi.testclient import TestClient

import app.tasks as tasks
from main import app
from app.models.schemas import ChatRequest

# NOT a context manager — lifespan would hit PostgreSQL (repo test rule).
client = TestClient(app)

CTX = "### Contract\nName: Bound Contract A\n\n### Clauses\n[§1] Retention\nfive percent"


def test_chat_request_model_carries_contract_context():
    """ChatRequest accepts contract_context and model_dump() preserves it."""
    req = ChatRequest(message="What is the retention?", contract_context=CTX)
    dumped = req.model_dump()
    assert dumped["contract_context"] == CTX


def test_chat_request_contract_context_defaults_none():
    """Field is optional — existing callers without it are untouched."""
    dumped = ChatRequest(message="hi").model_dump()
    assert dumped["contract_context"] is None


def test_chat_route_forwards_contract_context_to_celery(mocker):
    """POST /agents/chat: contract_context survives pydantic validation and
    lands in the send_task payload (the exact hop that used to drop it)."""
    send_task = mocker.patch("app.routers.agents.celery_app.send_task")

    resp = client.post(
        "/agents/chat",
        json={
            "message": "What is the retention?",
            "contract_id": "11111111-1111-1111-1111-111111111111",
            "org_id": "22222222-2222-2222-2222-222222222222",
            "history": [],
            "contract_context": CTX,
        },
    )

    assert resp.status_code == 200
    assert send_task.call_count == 1
    task_name, payload = send_task.call_args.args[0], send_task.call_args.kwargs["args"][0]
    assert task_name == "tasks.run_chat"
    assert payload["contract_context"] == CTX


def test_run_chat_forwards_contract_context_to_agent(mocker):
    """tasks.run_chat hands contract_context to ConversationalAgent.chat —
    where it becomes the '### Contract Context' block in the user turn."""
    fake_agent = MagicMock()
    fake_agent.chat.return_value = {"response": "ok", "citations": []}
    mocker.patch(
        "app.agents.conversational_agent.ConversationalAgent",
        return_value=fake_agent,
    )

    tasks.run_chat.run(
        {
            "message": "What is the retention?",
            "contract_context": CTX,
            "history": [],
        }
    )

    assert fake_agent.chat.call_args.kwargs.get("contract_context") == CTX
