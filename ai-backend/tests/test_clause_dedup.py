"""Unit tests for content-aware clause de-duplication (A), loud drops (D),
and combined-conditions detection (E).

The bug being fixed: the old merge de-duplicated by ``section_number`` alone and
then by ``title`` alone, so a Particular-Conditions ``بند 1`` (same number, and
sometimes same title, as a General-Conditions ``بند 1``) was silently dropped as
a "duplicate". The fix keys de-dup on NORMALIZED CONTENT — a true duplicate is
the SAME clause re-emitted at a chunk boundary.

All Anthropic calls are mocked — no API key or network access needed.
"""

from __future__ import annotations

import json
import logging
import re

from app.agents.clause_extractor import (
    ClauseExtractorAgent,
    _COMBINED_CONDITIONS_FLAG,
    _DEDUP_DROPPED_FLAG_PREFIX,
)

_merge = ClauseExtractorAgent._merge_in_order
_restart = ClauseExtractorAgent._detect_numbering_restart


def _c(title: str, content: str, section):
    return {
        "title": title,
        "content": content,
        "clause_type": "general",
        "section_number": section,
        "confidence": 0.9,
    }


# ─────────────────────────────────────────────────────────────────────────────
# A — content-aware dedup: the GC+PC collision cases must keep BOTH clauses.
# ─────────────────────────────────────────────────────────────────────────────

def test_gc_pc_same_number_different_content_both_kept():
    """GC بند 1 and PC بند 1 share section_number '1' but have different content
    → BOTH kept (the old section_number dedup dropped the PC one)."""
    gc1 = _c("التعريفات", "GC article one — definitions and interpretation", "1")
    pc1 = _c("أطراف هذا العقد", "PC article one — the parties to this contract", "1")
    merged = _merge([[gc1], [pc1]])
    assert len(merged) == 2
    assert [m["title"] for m in merged] == ["التعريفات", "أطراف هذا العقد"]


def test_cross_section_same_title_different_content_both_kept():
    """Same title, DIFFERENT content, different section → BOTH kept (the old
    title dedup dropped the later one)."""
    gc = _c("اللغة والمراسلات", "GC language and correspondence clause body", "11")
    pc = _c("اللغة والمراسلات", "PC language and correspondence clause body — differs", "7")
    merged = _merge([[gc], [pc]])
    assert len(merged) == 2


def test_true_overlap_identical_content_deduped():
    """The SAME clause re-emitted at a chunk boundary — identical content, even
    with a DIFFERENT section label and whitespace — is merged to one."""
    original = _c("Force Majeure", "identical force majeure body text here", "9")
    boundary_copy = _c("Force Majeure", "  identical force majeure   body text here \n", "9-cont")
    merged = _merge([[original], [boundary_copy]])
    assert len(merged) == 1
    assert merged[0]["section_number"] == "9"  # first occurrence wins


def test_normal_single_section_boundary_overlap_deduped():
    """A normal single-section doc whose boundary clause is emitted by two
    adjacent chunks still dedupes correctly (regression guard)."""
    chunk_a = [_c("C1", "clause one body", "1"), _c("C2", "clause two body", "2"),
               _c("C3", "clause three body", "3")]
    chunk_b = [_c("C3", "clause three body", "3"), _c("C4", "clause four body", "4")]  # C3 overlap
    merged = _merge([chunk_a, chunk_b])
    assert [m["title"] for m in merged] == ["C1", "C2", "C3", "C4"]
    assert len(merged) == 4


def test_empty_content_clauses_are_never_deduped():
    """Empty content is not a reliable signal — such clauses are always kept."""
    merged = _merge([[_c("X", "", "1")], [_c("Y", "", "2")]])
    assert len(merged) == 2


# ─────────────────────────────────────────────────────────────────────────────
# D — every drop is LOUD (warning), no longer a silent debug.
# ─────────────────────────────────────────────────────────────────────────────

def test_dropping_a_duplicate_logs_a_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="app.agents.clause_extractor"):
        _merge([[_c("A", "shared body text", "1")], [_c("B", "shared body text", "2")]])
    assert any("Dropping duplicate clause" in r.getMessage() for r in caplog.records)


# ─────────────────────────────────────────────────────────────────────────────
# E — combined GC+PC detection via a numbering restart.
# ─────────────────────────────────────────────────────────────────────────────

def _secs(nums):
    return [_c(f"clause {n}", f"body {n}", str(n)) for n in nums]


def test_restart_detected_for_gc_then_pc():
    # GC 1..19 then PC restarts at 1
    clauses = _secs(list(range(1, 20)) + [1, 2, 3])
    assert _restart(clauses) is True


def test_no_restart_for_normal_ascending():
    assert _restart(_secs(range(1, 20))) is False


def test_no_restart_for_subarticle_numbers():
    # leading ints 1,2,3,3,3,4 (sub-articles reduce to the parent) — never a restart
    clauses = [_c("a", "x", "1"), _c("b", "x2", "2"), _c("c", "x3", "3"),
               _c("d", "x4", "3.1"), _c("e", "x5", "3.2"), _c("f", "x6", "4")]
    assert _restart(clauses) is False


def test_restart_ignores_null_and_nonnumeric_sections():
    clauses = [_c("a", "x", None), _c("b", "x2", "GC-1"), _c("c", "x3", "1"),
               _c("d", "x4", "2"), _c("e", "x5", "3")]
    assert _restart(clauses) is False  # 1,2,3 ascending; null/label ignored


# ─────────────────────────────────────────────────────────────────────────────
# D + E integration — extract() sets both flags on last_quality_flags.
# ─────────────────────────────────────────────────────────────────────────────

def _chunk(idx: int) -> str:
    return f"مادة ({idx}) عنوان\nZMARK{idx}Z " + ("نص طويل للاختبار. " * 60)


def test_extract_sets_dedup_and_combined_flags(mocker):
    """A combined GC+PC file with a boundary duplicate → extract() records BOTH
    `clause_dedup_dropped:<n>` and `combined_conditions_file`."""
    mocker.patch("app.agents.clause_extractor.Anthropic")
    agent = ClauseExtractorAgent()
    agent._concurrency = 2

    # chunk 1 = GC 1,2,3 ; chunk 2 = a duplicate of GC 3 (dropped) + PC 1 (restart)
    canned = {
        1: [_c("GC1", "gc one body", "1"), _c("GC2", "gc two body", "2"),
            _c("GC3", "gc three body", "3")],
        2: [_c("GC3", "gc three body", "3"),                    # true dup → dropped
            _c("PC1", "pc one body — parties", "1")],           # restart → combined
    }
    mocker.patch.object(
        agent, "_split_on_article_boundaries", return_value=[_chunk(1), _chunk(2)]
    )

    def fake_call(user_content, gate=None):
        idx = int(re.search(r"ZMARK(\d+)Z", user_content).group(1))
        return json.dumps(canned[idx])

    agent._call_api_with_retry = fake_call

    # >30k so extract() takes the chunked path (patched split ignores the text).
    clauses = agent.extract("x" * 30_001)

    titles = [c["title"] for c in clauses]
    assert titles == ["GC1", "GC2", "GC3", "PC1"]  # dup dropped, PC1 kept
    assert any(f.startswith(_DEDUP_DROPPED_FLAG_PREFIX) for f in agent.last_quality_flags)
    assert _COMBINED_CONDITIONS_FLAG in agent.last_quality_flags
