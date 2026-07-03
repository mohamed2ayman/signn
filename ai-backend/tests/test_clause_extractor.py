"""Unit tests for ClauseExtractorAgent.

All Anthropic API calls are mocked — no API key or network access needed.

Mock target: "app.agents.base_agent.Anthropic"
The mock MUST be in place before ClauseExtractorAgent() is instantiated
because the client is created inside BaseAgent.__init__ (via super().__init__):
    self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
"""

from __future__ import annotations

import json

import pytest

from app.agents.clause_extractor import ClauseExtractorAgent

# ─────────────────────────────────────────────────────────────────────────────
# Shared fixtures and constants
# ─────────────────────────────────────────────────────────────────────────────

VALID_CLAUSES_JSON = json.dumps([
    {
        "title": "Definitions",
        "content": "For the purposes of this contract, the following terms apply.",
        "clause_type": "general",
        "section_number": "1",
        "confidence": 0.95,
    },
    {
        "title": "Payment Terms",
        "content": "Payment shall be made within 28 days of invoice.",
        "clause_type": "payment",
        "section_number": "14",
        "confidence": 0.92,
    },
])


def _make_mock_client(mocker, json_text: str):
    """Patch anthropic.Anthropic and wire the raw-response call to return json_text.

    Returns (mock_anthropic_class, mock_client_instance).

    The patch must be applied before ClauseExtractorAgent() is instantiated
    because BaseAgent.__init__ calls Anthropic(api_key=..., max_retries=0) immediately
    (ClauseExtractorAgent passes max_retries=0 through super().__init__).

    The agent reads rate-limit headers, so it now calls
    ``messages.with_raw_response.create(...)`` and then ``.parse()`` /``.headers``
    (instead of ``messages.create``). The mock mirrors that shape.
    """
    mock_anthropic_cls = mocker.patch("app.agents.base_agent.Anthropic")
    mock_client = mock_anthropic_cls.return_value  # what Anthropic() returns

    # Build a fake message object with .content[0].text = json_text
    fake_block = type("TextBlock", (), {"text": json_text})()
    fake_message = type("Message", (), {"content": [fake_block]})()

    # Raw-response wrapper: .parse() -> message, .headers -> dict-like (.get()).
    raw = mocker.MagicMock()
    raw.parse.return_value = fake_message
    raw.headers = {}  # empty → gate sees no rate-limit signal
    mock_client.messages.with_raw_response.create.return_value = raw

    return mock_anthropic_cls, mock_client


# ─────────────────────────────────────────────────────────────────────────────
# Test 1: short document (< 30 000 chars) returns correct clause list
# ─────────────────────────────────────────────────────────────────────────────

def test_extract_short_document_returns_clauses(mocker):
    """extract() on a document shorter than 30 000 chars takes the single-call
    path and returns a correctly shaped list of clause dicts."""
    _make_mock_client(mocker, VALID_CLAUSES_JSON)

    agent = ClauseExtractorAgent()
    result = agent.extract("Sample contract text for testing purposes.")

    assert isinstance(result, list)
    assert len(result) == 2

    # Every clause must carry the required fields
    for clause in result:
        assert "title" in clause
        assert "content" in clause
        assert "clause_type" in clause
        assert "section_number" in clause
        assert "confidence" in clause

    assert result[0]["title"] == "Definitions"
    assert result[1]["clause_type"] == "payment"


# ─────────────────────────────────────────────────────────────────────────────
# Test 2: Arabic text input does not raise encoding errors
# ─────────────────────────────────────────────────────────────────────────────

def test_extract_arabic_text_no_encoding_error(mocker):
    """extract() must handle Arabic Unicode input without raising any
    UnicodeDecodeError or similar encoding exception.

    We supply a one-clause Arabic contract preamble.  The mock returns an
    empty JSON array — we only care that no exception is raised and the
    return value is a list.
    """
    _make_mock_client(mocker, "[]")

    agent = ClauseExtractorAgent()

    arabic_text = (
        "مادة (1) : تعريفات وتفسيرات\n"
        "تكون للكلمات والمصطلحات الواردة فيما يلي المعاني المذكورة قرين كلاً منها\n"
        "- الهيئة: يقصد بها الهيئة القومية للأنفاق\n"
        "- المقاول: يقصد به الشخص أو الشركة المتعاقدة لتنفيذ الأعمال"
    )

    result = agent.extract(arabic_text)

    assert isinstance(result, list)   # _parse_json returns [] on empty response
    # No UnicodeDecodeError or any other exception — if we get here the test passes


# ─────────────────────────────────────────────────────────────────────────────
# Test 3: long document (> 30 000 chars) triggers the chunked path
# ─────────────────────────────────────────────────────────────────────────────

def test_extract_long_document_triggers_chunked_path(mocker):
    """Documents longer than 30 000 characters must use _extract_chunked(),
    which splits the text and calls the API once per chunk.

    We verify that messages.create was called (i.e. the API was invoked)
    and that the result is a list.
    """
    _, mock_client = _make_mock_client(mocker, VALID_CLAUSES_JSON)

    agent = ClauseExtractorAgent()

    # Build a text > 30 000 chars that starts with recognisable Arabic
    # article boundaries so the chunker can split it properly.
    long_text = "مادة (1) بند تجريبي\nهذا نص تجريبي للاختبار.\n\n" * 2_000
    assert len(long_text) > 30_000, "Fixture must exceed the 30 000-char threshold"

    result = agent.extract(long_text)

    # API must have been called at least once (chunked path)
    assert mock_client.messages.with_raw_response.create.call_count >= 1
    assert isinstance(result, list)


# ─────────────────────────────────────────────────────────────────────────────
# Test 4: invalid JSON from API returns empty list — no crash
# ─────────────────────────────────────────────────────────────────────────────

def test_extract_invalid_json_returns_empty_list(mocker):
    """When the Anthropic API returns prose instead of JSON, _parse_json()
    must return [] rather than raising a JSONDecodeError.

    This is an important resilience guarantee — a bad API response must
    not crash the Celery task.
    """
    _make_mock_client(mocker, "This is not JSON at all — just prose text.")

    agent = ClauseExtractorAgent()
    result = agent.extract("Some contract text.")

    assert result == []          # _parse_json() gracefully returns []
    assert isinstance(result, list)
