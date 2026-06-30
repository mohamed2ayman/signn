"""Unit tests for the PARALLEL chunked clause-extraction path (A + B).

Covers:
  * `_merge_in_order` produces the exact sequential merge/dedup result.
  * The parallel `_extract_chunked` output is byte-identical to the sequential
    merge of the same per-chunk responses — even when chunk calls COMPLETE
    out of order (proves reassembly is by chunk index, not completion order).
  * The concurrency cap is respected (and >1 ⇒ it really parallelizes).
  * The SDK's built-in retries are pinned OFF (no double-retry stacking).
  * The retry layer honors the server's Retry-After header.

All Anthropic calls are mocked — no API key or network access needed.
"""

from __future__ import annotations

import json
import re
import threading
import time

from app.agents.clause_extractor import ClauseExtractorAgent

# ─────────────────────────────────────────────────────────────────────────────
# Canned per-chunk responses, chosen to exercise every dedup branch:
#   - chunk 2 repeats section_number "1"  → section dedup drops it
#   - chunk 3 has two null-section clauses → both kept (running __nosec_ counter)
#   - chunk 4 title "a" collides with chunk 1 title "A" → title dedup drops it
# Expected final (in chunk-index order): A, B, C, D, E
# ─────────────────────────────────────────────────────────────────────────────

CANNED: dict[int, list[dict]] = {
    1: [{"title": "A", "content": "a", "clause_type": "general", "section_number": "1", "confidence": 0.9}],
    2: [
        {"title": "B", "content": "b", "clause_type": "general", "section_number": "2", "confidence": 0.9},
        {"title": "Dup1", "content": "d", "clause_type": "general", "section_number": "1", "confidence": 0.5},
    ],
    3: [
        {"title": "C", "content": "c", "clause_type": "general", "section_number": None, "confidence": 0.9},
        {"title": "D", "content": "dd", "clause_type": "general", "section_number": None, "confidence": 0.9},
    ],
    4: [{"title": "a", "content": "aa", "clause_type": "general", "section_number": "4", "confidence": 0.4}],
    5: [{"title": "E", "content": "e", "clause_type": "general", "section_number": "5", "confidence": 0.9}],
}

ORDERED_INPUTS = [CANNED[i] for i in (1, 2, 3, 4, 5)]


def _chunk_text(idx: int) -> str:
    """A >500-char synthetic chunk that starts at an article boundary and
    carries a unique ZMARK<idx>Z marker the fake API call keys off."""
    return f"مادة ({idx}) عنوان البند\nZMARK{idx}Z " + ("نص تجريبي طويل. " * 60)


class _FakeCalls:
    """Thread-safe stand-in for `_call_api_with_retry`.

    Records max concurrent in-flight calls and returns the canned JSON for the
    chunk identified by its ZMARK<idx>Z marker. `delay_fn(idx)` controls per-call
    duration so completion order can be inverted on purpose.
    """

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
    """Construct an agent with Anthropic patched out and a fixed chunk list."""
    mocker.patch("app.agents.clause_extractor.Anthropic")
    agent = ClauseExtractorAgent()
    agent._concurrency = concurrency
    chunks = [_chunk_text(i) for i in (1, 2, 3, 4, 5)]
    mocker.patch.object(agent, "_split_on_article_boundaries", return_value=chunks)
    return agent


# ─────────────────────────────────────────────────────────────────────────────
# 1. The merge helper itself produces the exact, hand-computed result.
# ─────────────────────────────────────────────────────────────────────────────

def test_merge_in_order_matches_hand_computed_expectation():
    merged = ClauseExtractorAgent._merge_in_order(ORDERED_INPUTS)

    assert [c["title"] for c in merged] == ["A", "B", "C", "D", "E"]
    assert [c["section_number"] for c in merged] == ["1", "2", None, None, "5"]
    # section "1" duplicate (chunk 2) dropped; title "a" (chunk 4) dropped;
    # both null-section clauses (chunk 3) kept.
    assert len(merged) == 5


def test_merge_in_order_is_independent_of_a_failed_chunk():
    """A failed chunk is represented as an empty list and contributes nothing —
    the rest still merge in order (mirrors the skip-failed-chunk behavior)."""
    inputs = [CANNED[1], [], CANNED[3], [], CANNED[5]]
    merged = ClauseExtractorAgent._merge_in_order(inputs)
    assert [c["title"] for c in merged] == ["A", "C", "D", "E"]


# ─────────────────────────────────────────────────────────────────────────────
# 2. Parallel output === sequential merge of the same responses (THE guarantee).
#    Completion order is inverted (chunk 5 finishes first) to prove reassembly
#    is by chunk index, not by which future resolves first.
# ─────────────────────────────────────────────────────────────────────────────

def test_parallel_extract_equals_sequential_even_out_of_order(mocker):
    agent = _make_agent(mocker, concurrency=3)
    # Higher index finishes SOONER → as_completed yields out of chunk order.
    fake = _FakeCalls(delay_fn=lambda idx: 0.02 * (6 - idx))
    agent._call_api_with_retry = fake

    result = agent._extract_chunked("ignored", None, None)

    expected = ClauseExtractorAgent._merge_in_order(ORDERED_INPUTS)
    assert result == expected  # byte-identical to the sequential merge
    assert [c["title"] for c in result] == ["A", "B", "C", "D", "E"]
    assert [c["section_number"] for c in result] == ["1", "2", None, None, "5"]
    assert fake.calls == 5  # one call per chunk, none skipped


# ─────────────────────────────────────────────────────────────────────────────
# 3. Concurrency cap is respected (and it really runs in parallel).
# ─────────────────────────────────────────────────────────────────────────────

def test_concurrency_cap_is_respected(mocker):
    agent = _make_agent(mocker, concurrency=3)
    fake = _FakeCalls(delay_fn=lambda idx: 0.1)  # uniform → forces overlap
    agent._call_api_with_retry = fake

    agent._extract_chunked("ignored", None, None)

    # 5 chunks, cap 3 → at most 3 ever in flight, and it DID parallelize to 3.
    assert fake.max_in_flight == 3


def test_concurrency_one_is_sequential(mocker):
    agent = _make_agent(mocker, concurrency=1)
    fake = _FakeCalls(delay_fn=lambda idx: 0.02)
    agent._call_api_with_retry = fake

    result = agent._extract_chunked("ignored", None, None)

    assert fake.max_in_flight == 1  # cap=1 ⇒ strictly one at a time
    # …and the output is still the same correct, ordered merge.
    assert [c["title"] for c in result] == ["A", "B", "C", "D", "E"]


# ─────────────────────────────────────────────────────────────────────────────
# 4. (B) SDK retries pinned OFF — no double-retry stacking.
# ─────────────────────────────────────────────────────────────────────────────

def test_sdk_retries_are_pinned_off(mocker):
    mock_cls = mocker.patch("app.agents.clause_extractor.Anthropic")
    ClauseExtractorAgent()
    assert mock_cls.call_args.kwargs.get("max_retries") == 0


# ─────────────────────────────────────────────────────────────────────────────
# 5. (B) The retry layer honors the server's Retry-After header.
# ─────────────────────────────────────────────────────────────────────────────

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

    # First attempt raises 429+Retry-After; second succeeds.
    mock_client.messages.with_raw_response.create.side_effect = [err, ok]
    sleep_mock = mocker.patch("app.agents.clause_extractor.time.sleep")

    out = agent._call_api_with_retry("hello")

    assert out == "[]"
    # Honored the server's 7s (not the old 30s base), capped at _RL_MAX_PAUSE.
    sleep_mock.assert_called_once_with(7.0)
