"""7.22 Item 1 — structured playbook_positions reach the compliance agent.

Guards the three silent-drop points: the request schema (Pydantic drops
undeclared fields on model_dump), the tasks.py re-pluck, and the agent's prompt
injection. Plus the regression: absent playbook_positions = today's prompt.
"""
from __future__ import annotations

from app.agents.compliance_checker import ComplianceCheckerAgent
from app.models.schemas import ComplianceCheckRequest

_POS = {
    "position_id": "11111111-1111-1111-1111-111111111111",
    "clause_type": "payment_terms",
    "rule_type": "RANGE",
    "value_config": {"min": 28, "max": 45, "unit": "days"},
}


def _fake_message(text: str):
    block = type("Block", (), {})()
    block.text = text
    msg = type("Message", (), {})()
    msg.content = [block]
    msg.stop_reason = "end_turn"
    return msg


# 1a — the field survives the FastAPI request boundary (model_dump keeps it).
def test_playbook_positions_survive_model_dump():
    req = ComplianceCheckRequest(
        contract_id="c-1",
        clauses=[],
        playbook_positions=[_POS],
    )
    dumped = req.model_dump()
    assert "playbook_positions" in dumped
    assert dumped["playbook_positions"][0]["position_id"] == _POS["position_id"]


# 1b — the tasks.py re-pluck forwards it to agent.check (the trap).
def test_task_forwards_playbook_positions(mocker):
    import app.tasks as tasks

    fake_agent = mocker.MagicMock()
    fake_agent.check.return_value = {"findings": [], "summary": {}}
    # Task imports the agent lazily inside the function body.
    mocker.patch(
        "app.agents.compliance_checker.ComplianceCheckerAgent",
        return_value=fake_agent,
    )
    request_data = {"clauses": [], "playbook_positions": [_POS]}
    tasks.run_compliance_check.run(request_data)  # bind=True → .run(payload)
    _, kwargs = fake_agent.check.call_args
    assert kwargs["playbook_positions"] == [_POS]


# 1c — the agent injects the structured rule + position_id into the prompt.
def test_agent_injects_structured_positions_into_prompt(mocker):
    agent = ComplianceCheckerAgent()
    captured: dict = {}

    def fake_call_model(**kw):
        captured.update(kw)
        return _fake_message('{"findings": [], "summary": {}}')

    mocker.patch.object(agent, "_call_model", side_effect=fake_call_model)
    agent.check(
        contract_type="FIDIC_RED_BOOK_2017",
        jurisdiction="EG",
        clauses=[{"id": "c1", "text": "payment in 60 days"}],
        playbook_positions=[_POS],
    )
    user_content = captured["messages"][0]["content"]
    assert "PLAYBOOK positions (STRUCTURED" in user_content
    assert _POS["position_id"] in user_content
    assert "28" in user_content and "45" in user_content  # the RANGE bounds


# 4 — REGRESSION: no positions → no structured section, prompt as today.
def test_no_positions_omits_structured_section(mocker):
    agent = ComplianceCheckerAgent()
    captured: dict = {}

    def fake_call_model(**kw):
        captured.update(kw)
        return _fake_message('{"findings": [], "summary": {}}')

    mocker.patch.object(agent, "_call_model", side_effect=fake_call_model)
    agent.check(
        contract_type="FIDIC_RED_BOOK_2017",
        jurisdiction="EG",
        clauses=[{"id": "c1", "text": "payment in 60 days"}],
        playbook_positions=None,
    )
    user_content = captured["messages"][0]["content"]
    assert "PLAYBOOK positions (STRUCTURED" not in user_content
