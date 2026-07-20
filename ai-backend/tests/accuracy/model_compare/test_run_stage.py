"""run_stage forces the model, installs the recorder, and captures tokens+cost
(no real API — Anthropic mocked)."""
from __future__ import annotations

from tests.accuracy.model_compare.compliance_dump import side_by_side
from tests.accuracy.model_compare.gold_loader import contract_clauses
from tests.accuracy.model_compare.run_stage import run_stage


def _fake_msg(text, in_tok=100, out_tok=50):
    b = type("B", (), {"text": text})()
    u = type("U", (), {"input_tokens": in_tok, "output_tokens": out_tok,
                       "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0})()
    m = type("M", (), {})()
    m.content = [b]
    m.usage = u
    m.stop_reason = "end_turn"
    return m


def test_run_stage_risk_forces_model_and_records_cost(mocker):
    client = mocker.patch("app.agents.base_agent.Anthropic").return_value
    risks = ('[{"clause_id":"c1","severity":"high","risk_category":"Payment Terms",'
             '"description":"د","suggestion":"s","likelihood":4,"impact":4}]')
    client.messages.create.return_value = _fake_msg(risks)

    res = run_stage("risk", "claude-haiku-4-5-20251001",
                    [{"id": "c1", "text": "نص", "clause_ref": "1"}], contract="X")

    assert res.stage == "risk"
    assert res.model == "claude-haiku-4-5-20251001"     # override forced onto the agent
    assert len(res.outputs) == 1 and res.outputs[0]["clause_id"] == "c1"
    assert res.input_tokens == 100 and res.output_tokens == 50 and res.calls == 1
    # Haiku pricing: (100/1e6)*1 + (50/1e6)*5 = 0.00035
    assert abs(res.cost_usd - 0.00035) < 1e-9


def test_run_stage_compliance_forces_model_and_records_cost(mocker):
    client = mocker.patch("app.agents.base_agent.Anthropic").return_value
    findings = ('{"findings":[{"layer":"STANDARD","severity":"HIGH","finding_type":"DEVIATION",'
                '"clause_ref":"1","description":"x","recommendation":"y"}],"summary":{}}')
    client.messages.create.return_value = _fake_msg(findings, in_tok=2000, out_tok=300)

    res = run_stage("compliance", "claude-sonnet-4-6",
                    [{"id": "c1", "text": "clause", "clause_ref": "1"}],
                    contract="X", jurisdiction="EG")

    assert res.stage == "compliance" and res.model == "claude-sonnet-4-6"
    assert res.outputs["findings"][0]["severity"] == "HIGH"
    assert res.input_tokens == 2000 and res.output_tokens == 300
    # Sonnet: (2000/1e6)*3 + (300/1e6)*15 = 0.0105
    assert abs(res.cost_usd - 0.0105) < 1e-9


def test_try_stage_tolerates_a_stage_failure(mocker):
    """A weak-model parse/truncation failure is a DATA POINT — it must not abort
    the paid run. `_try_stage` returns None instead of raising."""
    from tests.accuracy.model_compare import run_compare
    mocker.patch.object(run_compare.run_stage, "run_stage",
                        side_effect=ValueError("truncated compliance JSON"))
    res = run_compare._try_stage("compliance rep1", "compliance", "haiku",
                                 [{"id": "c1", "text": "x"}], contract="X")
    assert res is None


def test_compliance_side_by_side_shape():
    a = {"findings": [{"layer": "STANDARD", "severity": "HIGH", "finding_type": "DEVIATION",
                       "clause_ref": "1", "requirement": "cap liability",
                       "recommendation": "add a cap"}], "summary": {}}
    b = {"findings": [], "summary": {}}
    out = side_by_side(a, b, "sonnet", "haiku")
    assert out["sonnet"]["total"] == 1 and out["haiku"]["total"] == 0
    assert out["sonnet"]["by_severity"] == {"HIGH": 1}
    # brief surfaces the REAL text fields (requirement/recommendation), not `description`
    brief = out["sonnet"]["findings"][0]
    assert brief["requirement"] == "cap liability" and brief["recommendation"] == "add a cap"
    assert "description" not in brief


def test_gold_loader_shapes_clause_input():
    gold_clauses = [
        # friendly document_label wins over the raw filename (production parity)…
        {"contract": "P6", "contract_clause_id": "cc1", "section_number": "1",
         "document": "cond.docx", "document_label": "General Conditions", "text": "نص"},
        # …and falls back to the filename when the friendly label is absent
        {"contract": "P6", "contract_clause_id": "cc2", "section_number": "2",
         "document": "agr.docx", "text": "x"},
        {"contract": "Other", "contract_clause_id": "cc9", "section_number": "1", "text": "y"},
    ]
    out = contract_clauses(gold_clauses, "P6")
    assert out == [
        {"id": "cc1", "text": "نص", "clause_ref": "1", "document_label": "General Conditions"},
        {"id": "cc2", "text": "x", "clause_ref": "2", "document_label": "agr.docx"},
    ]
