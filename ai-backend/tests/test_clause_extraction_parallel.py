"""Unit tests for the PARALLEL chunked clause-extraction path.

Covers:
  * `_merge_in_order` (content-aware dedup) produces the expected result.
  * The parallel `_extract_chunked` output equals the sequential merge of the
    same per-chunk responses — even when chunk calls COMPLETE out of order
    (proves reassembly is by chunk index, not completion order).
  * The concurrency cap is respected (and >1 ⇒ it really parallelizes).
  * The SDK's built-in retries are pinned OFF (no double-retry stacking).
  * The retry layer honors the server's Retry-After header.

Dedup SEMANTICS (content vs section/title) are covered in test_clause_dedup.py.
All Anthropic calls are mocked — no API key or network access needed.
"""

from __future__ import annotations

import json
import re
import threading
import time

from app.agents.clause_extractor import ClauseExtractorAgent


def _clause(title: str, content: str, section: str | None) -> dict:
    return {
        "title": title,
        "content": content,
        "clause_type": "general",
        "section_number": section,
        "confidence": 0.9,
    }


# Per-chunk responses. Each clause has DISTINCT content EXCEPT chunk 3's second
# clause, which is a TRUE overlap duplicate of chunk 1's clause (identical
# content) — the content-aware merge drops it. Everything else is kept in order.
CANNED: dict[int, list[dict]] = {
    1: [_clause("Definitions", "definitions body about the terms used", "1")],
    2: [_clause("Scope", "scope of works to be performed", "2")],
    3: [
        _clause("Payment", "payment terms and certificates", "3"),
        _clause("Definitions", "definitions body about the terms used", "1"),  # dup
    ],
    4: [_clause("Warranty", "warranty and defects liability", "4")],
    5: [_clause("Disputes", "dispute resolution and arbitration", "5")],
}
ORDERED_INPUTS = [CANNED[i] for i in (1, 2, 3, 4, 5)]
EXPECTED_TITLES = ["Definitions", "Scope", "Payment", "Warranty", "Disputes"]
EXPECTED_SECTIONS = ["1", "2", "3", "4", "5"]


def _chunk_text(idx: int) -> str:
    """A >500-char synthetic chunk that starts at an article boundary and
    carries a unique ZMARK<idx>Z marker the fake API call keys off."""
    return f"مادة ({idx}) عنوان البند\nZMARK{idx}Z " + ("نص تجريبي طويل. " * 60)


class _FakeCalls:
    """Thread-safe stand-in for `_call_api_with_retry`. Records max concurrent
    in-flight calls and returns the canned JSON for the chunk identified by its
    ZMARK<idx>Z marker. `delay_fn(idx)` controls per-call duration."""

    def __init__(self, delay_fn=None) -> None:
        self._delay_fn = delay_fn or (lambda idx: 0.0)
        self._lock = threading.Lock()
        self.in_flight = 0
        self.max_in_flight = 0
        self.calls = 0

    def __call__(self, user_content: str, gate=None) -> str:
        with self._lock:
            self.in_flight += 1
            self.calls += 1
            if self.in_flight > self.max_in_flight:
                self.max_in_flight = self.in_flight
        try:
            idx = int(re.search(r"ZMARK(\d+)Z", user_content).group(1))
            time.sleep(self._delay_fn(idx))
            return json.dumps(CANNED[idx])
        finally:
            with self._lock:
                self.in_flight -= 1


def _make_agent(mocker, concurrency: int):
    mocker.patch("app.agents.clause_extractor.Anthropic")
    agent = ClauseExtractorAgent()
    agent._concurrency = concurrency
    chunks = [_chunk_text(i) for i in (1, 2, 3, 4, 5)]
    mocker.patch.object(agent, "_split_on_article_boundaries", return_value=chunks)
    return agent


# ─────────────────────────────────────────────────────────────────────────────
# 1. The merge helper produces the expected content-deduped result.
# ─────────────────────────────────────────────────────────────────────────────

def test_merge_in_order_matches_expectation():
    merged = ClauseExtractorAgent._merge_in_order(ORDERED_INPUTS)
    assert [c["title"] for c in merged] == EXPECTED_TITLES
    assert [c["section_number"] for c in merged] == EXPECTED_SECTIONS
    assert len(merged) == 5  # chunk 3's identical-content Definitions copy dropped


def test_merge_in_order_skips_failed_chunk():
    """A failed chunk is an empty list and contributes nothing; the rest merge
    in order (and the content-dup in chunk 3 is still dropped)."""
    inputs = [CANNED[1], [], CANNED[3], [], CANNED[5]]
    merged = ClauseExtractorAgent._merge_in_order(inputs)
    assert [c["title"] for c in merged] == ["Definitions", "Payment", "Disputes"]


# ─────────────────────────────────────────────────────────────────────────────
# 2. Parallel output == sequential merge, even with completion order inverted.
# ─────────────────────────────────────────────────────────────────────────────

def test_parallel_extract_equals_sequential_even_out_of_order(mocker):
    agent = _make_agent(mocker, concurrency=3)
    # Higher index finishes SOONER → as_completed yields out of chunk order.
    fake = _FakeCalls(delay_fn=lambda idx: 0.02 * (6 - idx))
    agent._call_api_with_retry = fake

    result = agent._extract_chunked("ignored", None, None)

    assert result == ClauseExtractorAgent._merge_in_order(ORDERED_INPUTS)
    assert [c["title"] for c in result] == EXPECTED_TITLES
    assert fake.calls == 5  # one call per chunk, none skipped


# ─────────────────────────────────────────────────────────────────────────────
# 3. Concurrency cap respected (and it really runs in parallel).
# ─────────────────────────────────────────────────────────────────────────────

def test_concurrency_cap_is_respected(mocker):
    agent = _make_agent(mocker, concurrency=3)
    fake = _FakeCalls(delay_fn=lambda idx: 0.1)  # uniform → forces overlap
    agent._call_api_with_retry = fake
    agent._extract_chunked("ignored", None, None)
    assert fake.max_in_flight == 3  # 5 chunks, cap 3 → at most 3 in flight


def test_concurrency_one_is_sequential(mocker):
    agent = _make_agent(mocker, concurrency=1)
    fake = _FakeCalls(delay_fn=lambda idx: 0.02)
    agent._call_api_with_retry = fake
    result = agent._extract_chunked("ignored", None, None)
    assert fake.max_in_flight == 1
    assert [c["title"] for c in result] == EXPECTED_TITLES


# ─────────────────────────────────────────────────────────────────────────────
# 4. SDK retries pinned OFF; Retry-After honored.
# ─────────────────────────────────────────────────────────────────────────────

def test_sdk_retries_are_pinned_off(mocker):
    mock_cls = mocker.patch("app.agents.clause_extractor.Anthropic")
    ClauseExtractorAgent()
    assert mock_cls.call_args.kwargs.get("max_retries") == 0


def test_retry_honors_retry_after_header(mocker):
    import httpx
    from anthropic import APIStatusError

    mock_cls = mocker.patch("app.agents.clause_extractor.Anthropic")
    mock_client = mock_cls.return_value
    agent = ClauseExtractorAgent()

    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    resp = httpx.Response(429, headers={"retry-after": "7"}, request=req)
    err = APIStatusError("rate limited", response=resp, body=None)

    fake_block = type("TextBlock", (), {"text": "[]"})()
    fake_message = type("Message", (), {"content": [fake_block]})()
    ok = mocker.MagicMock()
    ok.parse.return_value = fake_message
    ok.headers = {}

    mock_client.messages.with_raw_response.create.side_effect = [err, ok]
    sleep_mock = mocker.patch("app.agents.clause_extractor.time.sleep")

    out = agent._call_api_with_retry("hello")
    assert out == "[]"
    sleep_mock.assert_called_once_with(7.0)
