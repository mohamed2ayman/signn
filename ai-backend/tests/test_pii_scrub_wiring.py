"""Wiring proofs for Slice 1 PII scrubbing at the ``_call_model`` chokepoint.

All Anthropic calls are mocked at ``app.agents.base_agent.Anthropic`` — no
network, no API key. The six contract proofs:

  1. with ``scrub=True``, the kwargs RECEIVED BY THE MOCK contain NO raw PII —
     placeholders present, real values absent (checked over the full
     serialized outbound payload);
  2. the restored text the agent sees HAS the real values back;
  3. same-entity consistency within one call (system + message share tokens);
  4. ``scrub=False`` → byte-identical passthrough (the mock receives the very
     same ``system`` / ``messages`` OBJECTS, untouched);
  5. ``scrub=True`` + ``raw=True`` → loud ValueError (extraction is unscrubbed
     by design — D1);
  6. an unrestored-placeholder response → WARNING with placeholder NAMES only
     + the response is still returned (survivors are cosmetic, never fatal).

Plus: the scrub log path carries counts-by-type only — never a PII value.
"""
from __future__ import annotations

import json
import logging

import pytest

from app.agents import summarizer
from app.agents.base_agent import BaseAgent

_MOCK_TARGET = "app.agents.base_agent.Anthropic"

# The PII fixture threaded through the wiring tests: EG phone + email + IBAN.
PII_EMAIL = "site.manager@contractor-co.com"
PII_PHONE = "01012345678"
PII_IBAN = "EG380019000500000000263180002"
PII_TEXT = (
    f"Notify {PII_EMAIL} or {PII_PHONE}. "
    f"Payments to {PII_IBAN} within 30 days."
)


def _fake_message(text: str):
    class TextBlock:  # mutable, like the SDK's pydantic block
        pass

    block = TextBlock()
    block.text = text
    msg = type("Message", (), {})()
    msg.content = [block]
    return msg


def _mock_client(mocker, ret_text: str = "{}"):
    mock_cls = mocker.patch(_MOCK_TARGET)
    client = mock_cls.return_value
    client.messages.create.return_value = _fake_message(ret_text)
    return client


# ─────────────────────────────────────────────────────────────────────────────
# 1. The mock receives NO raw PII
# ─────────────────────────────────────────────────────────────────────────────

def test_scrub_true_mock_receives_no_raw_pii(mocker):
    client = _mock_client(mocker)
    agent = summarizer.SummarizerAgent()  # a real Camp-1 agent, scrub=True wired
    agent.summarize(PII_TEXT)

    kw = client.messages.create.call_args.kwargs
    outbound = json.dumps({"system": kw["system"], "messages": kw["messages"]})

    # Real values are ABSENT from everything that would go on the wire…
    assert PII_EMAIL not in outbound
    assert PII_PHONE not in outbound
    assert PII_IBAN not in outbound
    # …and the placeholders are PRESENT in their place.
    for token in ("[EMAIL_1]", "[PHONE_1]", "[IBAN_1]"):
        assert token in outbound
    # Non-PII contract content survives untouched.
    assert "within 30 days" in outbound
    # scrub is consumed at the chokepoint — never forwarded to the API.
    assert "scrub" not in kw
    assert set(kw) == {"model", "max_tokens", "system", "messages"}


# ─────────────────────────────────────────────────────────────────────────────
# 2. The agent sees the REAL values restored
# ─────────────────────────────────────────────────────────────────────────────

def test_agent_sees_real_values_restored(mocker):
    _mock_client(
        mocker,
        ret_text='{"executive_summary": "notify [EMAIL_1] on [PHONE_1] via [IBAN_1]"}',
    )
    agent = summarizer.SummarizerAgent()
    result = agent.summarize(PII_TEXT)

    assert result["executive_summary"] == (
        f"notify {PII_EMAIL} on {PII_PHONE} via {PII_IBAN}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3. Same-entity consistency within one call (system + messages share tokens)
# ─────────────────────────────────────────────────────────────────────────────

def test_same_entity_same_token_across_system_and_messages(mocker):
    client = _mock_client(mocker)
    agent = BaseAgent()
    agent._call_model(
        scrub=True,
        system=f"The engineer of record is {PII_EMAIL}.",
        messages=[
            {"role": "user", "content": f"Escalate to {PII_EMAIL} and {PII_PHONE}."},
        ],
        max_tokens=64,
    )
    kw = client.messages.create.call_args.kwargs
    assert kw["system"] == "The engineer of record is [EMAIL_1]."
    assert kw["messages"][0]["content"] == "Escalate to [EMAIL_1] and [PHONE_1]."


# ─────────────────────────────────────────────────────────────────────────────
# 4. scrub=False → byte-identical passthrough
# ─────────────────────────────────────────────────────────────────────────────

def test_scrub_false_is_byte_identical_passthrough(mocker):
    client = _mock_client(mocker)
    agent = BaseAgent()
    system = f"contact {PII_EMAIL}"
    messages = [{"role": "user", "content": f"call {PII_PHONE}"}]

    agent._call_model(system=system, messages=messages, max_tokens=64)

    kw = client.messages.create.call_args.kwargs
    # Identity, not just equality: the very same objects reach the endpoint,
    # PII intact — the pre-slice wire payload, byte for byte.
    assert kw["system"] is system
    assert kw["messages"] is messages
    assert messages[0]["content"] == f"call {PII_PHONE}"
    assert set(kw) == {"model", "max_tokens", "system", "messages"}


# ─────────────────────────────────────────────────────────────────────────────
# 5. scrub=True + raw=True → loud ValueError
# ─────────────────────────────────────────────────────────────────────────────

def test_scrub_on_raw_path_raises_value_error(mocker):
    client = _mock_client(mocker)
    agent = BaseAgent()
    with pytest.raises(ValueError, match="unscrubbed by design"):
        agent._call_model(
            scrub=True,
            raw=True,
            system="s",
            messages=[{"role": "user", "content": "m"}],
            max_tokens=8,
        )
    # Rejected BEFORE any call went out.
    assert client.messages.create.call_count == 0
    assert client.messages.with_raw_response.create.call_count == 0


# ─────────────────────────────────────────────────────────────────────────────
# 6. Unrestored placeholder → WARNING (names only), response still returned
# ─────────────────────────────────────────────────────────────────────────────

def test_unrestored_placeholder_warns_names_only_and_returns(mocker, caplog):
    # The model echoes a token this session never issued ([EMAIL_9]).
    _mock_client(mocker, ret_text="reach [EMAIL_1] or [EMAIL_9] for payment")
    agent = BaseAgent()

    with caplog.at_level(logging.INFO, logger="app.agents.base_agent"):
        response = agent._call_model(
            scrub=True,
            system="s",
            messages=[{"role": "user", "content": f"owner {PII_EMAIL}"}],
            max_tokens=64,
        )

    # The response is still returned, with the known token restored.
    assert response.content[0].text == f"reach {PII_EMAIL} or [EMAIL_9] for payment"

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "[EMAIL_9]" in warnings[0].getMessage()
    # SECURITY: no log record — warning or otherwise — ever carries a value.
    for record in caplog.records:
        assert PII_EMAIL not in record.getMessage()


def test_scrub_logs_counts_by_type_never_values(mocker, caplog):
    _mock_client(mocker)
    agent = BaseAgent()
    with caplog.at_level(logging.DEBUG, logger="app.agents.base_agent"):
        agent._call_model(
            scrub=True,
            system="s",
            messages=[{"role": "user", "content": PII_TEXT}],
            max_tokens=64,
        )
    joined = " | ".join(r.getMessage() for r in caplog.records)
    assert "1 EMAIL, 1 IBAN, 1 PHONE" in joined
    for value in (PII_EMAIL, PII_PHONE, PII_IBAN):
        assert value not in joined


def test_scrub_with_no_pii_found_sends_text_unchanged(mocker):
    client = _mock_client(mocker)
    agent = BaseAgent()
    clean = "The retention is 5% released after 365 days."
    agent._call_model(
        scrub=True,
        system="s",
        messages=[{"role": "user", "content": clean}],
        max_tokens=64,
    )
    kw = client.messages.create.call_args.kwargs
    assert kw["messages"][0]["content"] == clean
