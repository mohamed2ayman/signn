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


# ─────────────────────────────────────────────────────────────────────────────
# Issue 1 — FIX 2 (Defect A2): the prompt generalises structure preservation
# ─────────────────────────────────────────────────────────────────────────────

def test_prompt_generalizes_layout_preservation_to_all_clauses():
    """The SYSTEM_PROMPT must instruct layout preservation for EVERY clause
    (line breaks + bullets + sub-clauses), not only for the definitions clause,
    while keeping guideline 12 (definitions formatting) intact."""
    from app.agents.clause_extractor import SYSTEM_PROMPT

    low = SYSTEM_PROMPT.lower()
    assert "line break" in low                                      # keep line breaks
    assert "bulleted list into a single flat paragraph" in low      # don't flatten
    assert "applies to every clause" in low                         # not just definitions
    # Guideline 12 (definitions) is unchanged.
    assert "DEFINITIONS FORMATTING" in SYSTEM_PROMPT


# ─────────────────────────────────────────────────────────────────────────────
# Issue 1 — FIX 3 (Defect B): chunk-boundary tail loss
# ─────────────────────────────────────────────────────────────────────────────

def test_split_keeps_boundary_article_whole_no_midclause_cut(mocker):
    """An article that would push a chunk over _CHUNK_SIZE must move WHOLE into
    the next chunk — never hard-split mid-body (which the 'skip continuations'
    note would then drop). Each article's full text lands intact in exactly ONE
    chunk (no split, no duplication)."""
    from app.agents.clause_extractor import _CHUNK_SIZE

    _make_mock_client(mocker, "[]")
    agent = ClauseExtractorAgent()

    def article(n: int, size: int) -> str:
        head = f"مادة ({n}) : العنوان\n"
        filler = "محتوى " * max(1, (size - len(head) - 24) // len("محتوى "))
        return f"{head}{filler} <<<END{n}>>>\n\n"

    # 5000 + 5000 = 10000 fits one chunk; adding the 7000-char art 3 would
    # overshoot 15000 → OLD packing put art 3 in that chunk and hard-cut it;
    # NEW packing moves art 3 whole into chunk 2.
    a1, a2, a3, a4 = article(1, 5000), article(2, 5000), article(3, 7000), article(4, 3000)
    text = a1 + a2 + a3 + a4

    chunks = agent._split_on_article_boundaries(text)

    for n, art in [(1, a1), (2, a2), (3, a3), (4, a4)]:
        core = art.strip()
        containing = [c for c in chunks if core in c]
        assert len(containing) == 1, f"article {n} was split or duplicated across chunks"
        sentinels = sum(c.count(f"<<<END{n}>>>") for c in chunks)
        assert sentinels == 1, f"article {n} tail appears {sentinels}× (expected exactly 1)"

    # Multi-article packing never overshoots the limit.
    assert all(len(c) <= _CHUNK_SIZE for c in chunks)


def test_split_oversized_single_article_still_broken(mocker):
    """A SINGLE article larger than _CHUNK_SIZE is the ONLY case allowed to
    exceed the limit at packing time — it is still handed to Phase 2 and broken
    into pieces (so the >30k chunking guarantee holds)."""
    from app.agents.clause_extractor import _CHUNK_SIZE

    _make_mock_client(mocker, "[]")
    agent = ClauseExtractorAgent()

    # One article ~2× the chunk size, with no sub-article/paragraph boundaries →
    # forces the hard-split branch of _break_oversized_chunk.
    huge = "مادة (1) : بند ضخم\n" + ("حرف" * (_CHUNK_SIZE))  # ~3×_CHUNK_SIZE chars
    chunks = agent._split_on_article_boundaries(huge)

    assert len(chunks) >= 2, "an oversized single article must be split into pieces"
