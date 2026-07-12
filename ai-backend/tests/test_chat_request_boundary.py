"""Boundary test — knowledge_context survives the REAL pydantic boundary.

This is the test that was required after the 7.27 host-chat silent-drop
(commit 31474c9). It proves knowledge_context now travels the full path
HTTP request -> ChatRequest validation -> request.model_dump() -> the Celery
task payload — i.e. it survives the exact model_dump() step that previously
DROPPED it (ChatRequest lacked the field, pydantic extra=ignore discarded it).

It drives the ACTUAL FastAPI route (POST /agents/chat) with a real TestClient.
It deliberately does NOT call tasks.run_chat directly: a task-direct call hands
run_chat a raw dict that never passes through ChatRequest, so it can never catch
a field the model omits — that bypass is the precise blind spot that hid the
original bug.

Celery dispatch is mocked (we assert on the payload handed to send_task); no
Redis, no Anthropic/OpenAI, no network. TestClient is used NON-context-manager
so the FastAPI lifespan (Base.metadata.create_all -> Postgres) never fires.
"""

from fastapi.testclient import TestClient

from main import app

# Module-level client — lifespan is NOT triggered here (no PG connection).
client = TestClient(app)

# Patch target: the module-level Celery instance the /agents/chat route calls.
_SEND_TASK = "app.routers.agents.celery_app.send_task"


def _dispatched_payload(send_task_mock):
    """The dict actually handed to run_chat = args=[request.model_dump()]."""
    assert send_task_mock.call_count == 1, "expected exactly one Celery dispatch"
    # Route calls: send_task("tasks.run_chat", args=[payload], task_id=job_id)
    assert send_task_mock.call_args.args[0] == "tasks.run_chat"
    return send_task_mock.call_args.kwargs["args"][0]


def test_knowledge_context_survives_the_pydantic_boundary(mocker):
    """A knowledge_context sent over HTTP reaches the task payload intact."""
    send_task = mocker.patch(_SEND_TASK)
    legal_block = (
        '<legal_context jurisdiction="EG">SENTINEL — Egyptian Civil Code '
        "Article 217 grounding block</legal_context>"
    )

    resp = client.post(
        "/agents/chat",
        json={
            "message": "does force majeure apply?",
            "knowledge_context": legal_block,
            "contract_context": "### Contract Context\nSENTINEL clause text",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "queued"

    payload = _dispatched_payload(send_task)
    # THE REGRESSION: the field must survive model_dump() — it did NOT before 31474c9.
    assert payload["knowledge_context"] == legal_block
    # The sibling grounding field and the message also make it through (sanity).
    assert payload["contract_context"] == "### Contract Context\nSENTINEL clause text"
    assert payload["message"] == "does force majeure apply?"


def test_undeclared_field_is_still_dropped_extra_ignore(mocker):
    """Regression guard: ChatRequest (extra=ignore) still drops unknown fields.

    Proves the fix ADDED knowledge_context as a real, declared field — it did
    NOT globally relax the model to let arbitrary junk cross the boundary.
    """
    send_task = mocker.patch(_SEND_TASK)

    resp = client.post(
        "/agents/chat",
        json={
            "message": "hello",
            "knowledge_context": "kept",
            "junk_undeclared_field": "SHOULD_BE_DROPPED",
        },
    )

    # extra=ignore ACCEPTS (does not 422 on) the unknown field...
    assert resp.status_code == 200
    payload = _dispatched_payload(send_task)
    assert payload["knowledge_context"] == "kept"  # declared field survives
    assert "junk_undeclared_field" not in payload  # ...but the unknown field is dropped
