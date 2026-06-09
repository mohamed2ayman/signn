"""Phase E — chat legal-context grounding tests.

Covers:
- run_chat forwards knowledge_context (the legal_context carrier) to the agent
- the conversational system prompt instructs article citation for <legal_context>
- the agent's response parser tolerates fenced JSON and prose (the fragility
  the legal block surfaced)

No real Anthropic calls — the agent client is mocked.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import app.tasks as tasks
from app.agents.conversational_agent import ConversationalAgent, SYSTEM_PROMPT


def test_system_prompt_instructs_legal_citation():
    """The chat system prompt tells the model to cite articles from <legal_context>."""
    assert "<legal_context>" in SYSTEM_PROMPT
    assert "cite" in SYSTEM_PROMPT.lower()
    assert "article" in SYSTEM_PROMPT.lower()


def test_run_chat_forwards_knowledge_context(mocker):
    """run_chat passes knowledge_context (the legal block) through to the agent."""
    fake_agent = MagicMock()
    fake_agent.chat.return_value = {"response": "ok", "citations": []}
    mocker.patch(
        "app.agents.conversational_agent.ConversationalAgent",
        return_value=fake_agent,
    )

    legal_block = '<legal_context jurisdiction="EG">[Passage 1 — Egyptian Civil Code, مادة 217]</legal_context>'
    tasks.run_chat.run(
        {
            "message": "force majeure?",
            "knowledge_context": legal_block,
            "history": [],
        }
    )

    assert fake_agent.chat.call_args.kwargs.get("knowledge_context") == legal_block


def test_agent_parses_fenced_json(mocker):
    """A ```json fenced reply (what the model emits with a legal block) parses cleanly."""
    agent = ConversationalAgent.__new__(ConversationalAgent)  # skip __init__/client
    fenced = '```json\n{"response": "Per Article 217 ...", "citations": []}\n```'
    out = agent._parse_response(fenced)
    assert out["response"].startswith("Per Article 217")
    assert out["citations"] == []


def test_agent_parses_prose_fallback():
    """Non-JSON prose is wrapped as the response rather than throwing."""
    out = ConversationalAgent._parse_response("Just a plain sentence, no JSON.")
    assert out["response"] == "Just a plain sentence, no JSON."
    assert out["citations"] == []


def test_agent_parses_bare_json():
    """Plain JSON (no fence) still works."""
    out = ConversationalAgent._parse_response('{"response": "hi", "citations": [{"source": "Art 1"}]}')
    assert out["response"] == "hi"
    assert out["citations"] == [{"source": "Art 1"}]
