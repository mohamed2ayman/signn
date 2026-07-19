"""Tests for the oversized-chunk truncation fix (FIX B + FIX C).

All Anthropic calls are mocked at ``app.agents.base_agent.Anthropic`` — no
network/key. Covers:
  FIX C — stop_reason==max_tokens is a FAILURE (retry with headroom, not accepted
          as success), the salvage parser recovers partial clauses, and an
          incomplete/unparseable response raises the `clause_extraction_incomplete`
          flag (single-call AND chunked paths).
  FIX B — the raised max_tokens tiers.
  (FIX A — the sentence-split prevention tier was REVERTED: its ~12k pieces are
   un-stitchable by PR #117, which would trade a caught truncation for unflagged
   over-fragmentation. The oversized-article break stays a ≤ _CHUNK_SIZE hard
   split; FIX B's headroom removes the truncation on those pieces.)
"""
from __future__ import annotations

import app.agents.clause_extractor as ce
from app.agents.clause_extractor import (
    ClauseExtractorAgent,
    _CHUNK_SIZE,
    _MAX_TOKENS_CEILING,
    _TRUNCATION_FLAG_PREFIX,
)

_MOCK = "app.agents.base_agent.Anthropic"


def _raw(stop_reason: str, text: str):
    """A fake with_raw_response wrapper: .headers + .parse()->message(.content,.stop_reason)."""
    msg = type("M", (), {})()
    msg.content = [type("B", (), {"text": text})()]
    msg.stop_reason = stop_reason
    wrapper = type("Raw", (), {})()
    wrapper.headers = {}
    wrapper.parse = lambda: msg
    return wrapper


# ── FIX C: stop_reason detection + truncation-aware retry ─────────────────────

def test_truncation_retries_with_more_headroom_then_succeeds(mocker):
    client = mocker.patch(_MOCK).return_value
    seen: list[int] = []

    def fake_create(**kw):
        seen.append(kw["max_tokens"])
        if len(seen) == 1:
            return _raw("max_tokens", '[{"title":"A","content":"c"')   # truncated
        return _raw("end_turn", '[{"title":"A","content":"c"}]')       # complete
    client.messages.with_raw_response.create = fake_create

    agent = ClauseExtractorAgent()
    result = agent._call_api_with_retry("مادة (1): نص")
    assert len(seen) == 2                 # a retry fired — not accepted as success
    assert seen[1] > seen[0]              # with MORE max_tokens headroom
    assert result.truncated is False      # recovered → clean
    assert result.text == '[{"title":"A","content":"c"}]'


def test_clean_response_is_not_flagged_truncated(mocker):
    client = mocker.patch(_MOCK).return_value
    client.messages.with_raw_response.create = lambda **kw: _raw("end_turn", "[]")
    result = ClauseExtractorAgent()._call_api_with_retry("مادة (1): نص")
    assert result.truncated is False


def test_persistent_truncation_bumps_to_ceiling_then_flags(mocker):
    client = mocker.patch(_MOCK).return_value
    seen: list[int] = []

    def always_truncated(**kw):
        seen.append(kw["max_tokens"])
        # complete first object, then cut off mid-second → salvage yields 1
        return _raw("max_tokens", '[{"title":"A","content":"c1"},{"title":"B","cont')
    client.messages.with_raw_response.create = always_truncated

    agent = ClauseExtractorAgent()
    clauses = agent.extract("مادة (1): تعريفات\nنص المادة الأولى.")  # single-call path
    # It kept retrying with growing headroom, capped at the ceiling…
    assert seen[-1] == _MAX_TOKENS_CEILING
    assert len(seen) >= 2
    # …salvaged the one complete clause (NOT lost the whole chunk)…
    assert len(clauses) == 1
    # …and raised the incomplete flag so the doc is NOT clean/silent.
    assert agent._truncated_chunks == 1
    assert any(f.startswith(_TRUNCATION_FLAG_PREFIX) for f in agent.last_quality_flags)


# ── FIX C: salvage parser ────────────────────────────────────────────────────

def test_parse_json_salvages_partial_array():
    agent = ClauseExtractorAgent.__new__(ClauseExtractorAgent)  # no client needed
    truncated = '[{"title":"A","content":"c1"},{"title":"B","content":"c2"},{"title":"C","cont'
    out = agent._parse_json(truncated)
    assert len(out) == 2                          # recovered the two complete objects
    assert [c["title"] for c in out] == ["A", "B"]


def test_parse_json_complete_array_unchanged():
    agent = ClauseExtractorAgent.__new__(ClauseExtractorAgent)
    out = agent._parse_json('[{"title":"A","content":"c1"},{"title":"B","content":"c2"}]')
    assert len(out) == 2


# ── FIX B: raised max_tokens tiers ───────────────────────────────────────────

def test_max_tokens_tiers_raised():
    f = ClauseExtractorAgent._calculate_max_tokens
    assert f(5_000) == 24_000
    assert f(11_000) == 40_000
    assert f(14_000) == 56_000
    assert _MAX_TOKENS_CEILING == 64_000


# ── FIX C: the CHUNKED path also raises the flag on a truncated chunk ─────────

def test_chunked_path_flags_truncation(mocker):
    client = mocker.patch(_MOCK).return_value
    # Every chunk truncates → salvage keeps 1, flag raised per chunk.
    client.messages.with_raw_response.create = lambda **kw: _raw(
        "max_tokens", '[{"title":"A","content":"c1"},{"title":"B","cont'
    )
    agent = ClauseExtractorAgent()
    # >30k with two مادة boundaries → chunked path, ≥1 chunk.
    doc = "مادة (1): " + ("نص طويل. " * 2500) + "\nمادة (2): " + ("نص آخر. " * 2500)
    clauses = agent.extract(doc)
    assert agent._truncated_chunks >= 1
    assert any(f.startswith(_TRUNCATION_FLAG_PREFIX) for f in agent.last_quality_flags)
    assert len(clauses) >= 1  # salvaged at least one per chunk


# ── Oversized-article break (FIX A reverted — hard-split at _CHUNK_SIZE) ──────

def test_break_returns_single_piece_when_already_small():
    small = "مادة (1): نص قصير."
    assert ClauseExtractorAgent._break_oversized_chunk(small) == [small]


def test_split_on_article_boundaries_caps_oversized_article():
    # One oversized boundary-less article → packer emits it alone and Phase 2
    # breaks it to ≤ _CHUNK_SIZE pieces (FIX A sentence-tier was reverted — it
    # produced un-stitchable pieces; the hard-split cap remains).
    agent = ClauseExtractorAgent.__new__(ClauseExtractorAgent)
    big = "مادة (1): تعريفات. " + ("جملة قانونية طويلة هنا. " * 1200)
    doc = big + "\nمادة (2): نص قصير للمادة الثانية."
    chunks = agent._split_on_article_boundaries(doc)
    assert len(chunks) > 2
    assert all(len(c) <= _CHUNK_SIZE for c in chunks)
