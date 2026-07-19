"""Unit tests for split-clause STITCHING (A) + its loud flag (C).

A long clause cut across a chunk boundary comes back as two overlapping partial
entries (e.g. البند 7: idx6 = 7-1/7-2/7-3, idx7 = 7-2tail/7-3/7-4). The stitch
folds them back into ONE clause preserving all sub-articles (7-1…7-4) and
de-duplicating only the overlap (7-3).

STRICT guards (ALL required): adjacent in order + same leading section number +
junction content overlap. This must NEVER merge two DISTINCT clauses that merely
share a section number (a GC بند 7 and a PC بند 7) — that would undo the content
-dedup fix.

All Anthropic calls are mocked — no API key or network access needed.
"""

from __future__ import annotations

import json
import re

from app.agents.clause_extractor import (
    ClauseExtractorAgent,
    _ApiResult,
    _SPLIT_CLAUSE_FLAG_PREFIX,
)

A = ClauseExtractorAgent


def _long(marker: str) -> str:
    """A long, marker-tagged sub-article block (big enough to clear the overlap
    thresholds). The marker is embedded in EVERY repetition so different blocks
    are genuinely distinct text (as real sub-articles are) — not a shared filler."""
    return f"{marker}: " + (f"نص خاص بالفقرة {marker} يتضمن تفاصيل قانونية مميزة. " * 4)


def _c(title: str, content: str, section: str):
    return {
        "title": title,
        "content": content,
        "clause_type": "general",
        "section_number": section,
        "confidence": 0.9,
    }


H = "البند 7: الملكية الفكرية"
S71, S72, S73, S74 = _long("7 – 1"), _long("7 – 2"), _long("7 – 3"), _long("7 – 4")
# P1 = heading + 7-1 + 7-2 + 7-3 ; P2 = heading(prepended) + truncated 7-2 + 7-3 + 7-4
P1 = f"{H}\n\n{S71}\n\n{S72}\n\n{S73}"
P2 = f"{H}\n{S72[10:]}\n\n{S73}\n\n{S74}"


# ─────────────────────────────────────────────────────────────────────────────
# A — adjacent overlapping same-section partials → merged, all sub-parts kept.
# ─────────────────────────────────────────────────────────────────────────────

def test_adjacent_overlapping_partials_are_stitched():
    out, n = A._stitch_split_clauses([_c("الملكية الفكرية", P1, "7"),
                                      _c("الملكية الفكرية", P2, "7")])
    assert n == 1 and len(out) == 1
    m = out[0]["content"]
    for marker in ("7 – 1", "7 – 2", "7 – 3", "7 – 4"):
        assert marker in m                    # every sub-article preserved
    assert m.count(S73) == 1                  # the overlapping 7-3 appears ONCE


def test_huge_single_clause_three_way_split_is_stitched():
    """A genuinely-huge single بند cut into 3 pieces (overlaps X then Y) folds
    into one clause containing all parts."""
    X, Y = _long("shared X"), _long("shared Y")
    p1 = f"البند 5: مادة كبيرة\n{_long('5-1')}\n\n{X}"
    p2 = f"البند 5: مادة كبيرة\n{X}\n\n{_long('5-mid')}\n\n{Y}"
    p3 = f"البند 5: مادة كبيرة\n{Y}\n\n{_long('5-last')}"
    out, n = A._stitch_split_clauses([_c("مادة كبيرة", p1, "5"),
                                      _c("مادة كبيرة", p2, "5"),
                                      _c("مادة كبيرة", p3, "5")])
    assert len(out) == 1 and n == 2
    m = out[0]["content"]
    assert "5-1" in m and "5-mid" in m and "5-last" in m
    assert m.count(X) == 1 and m.count(Y) == 1  # both overlaps deduped


# ─────────────────────────────────────────────────────────────────────────────
# CRITICAL guards — must NOT re-merge distinct clauses that share a number.
# ─────────────────────────────────────────────────────────────────────────────

def test_non_adjacent_same_number_gc_pc_not_merged():
    """GC بند 7 and PC بند 7 share the leading number but are NON-adjacent →
    never merged (the GC/PC content-dedup fix stays intact)."""
    gc7 = _c("الملكية الفكرية", P1, "7")
    mid1 = _c("الالتزامات العامة", _long("8 body"), "8")
    mid2 = _c("سعر العقد", _long("9 body"), "9")
    pc7 = _c("فترة الضمان", _long("PC7 warranty entirely different"), "7")
    out, n = A._stitch_split_clauses([gc7, mid1, mid2, pc7])
    assert n == 0 and len(out) == 4


def test_adjacent_same_number_different_content_not_merged():
    """Adjacent, same leading number, but genuinely different content (no
    junction overlap) → NOT merged."""
    a = _c("الملكية الفكرية", P1, "7")
    b = _c("بند مختلف", _long("completely different body with no shared block"), "7")
    out, n = A._stitch_split_clauses([a, b])
    assert n == 0 and len(out) == 2


def test_mid_clause_shared_phrase_is_not_a_junction():
    """A shared block in the MIDDLE of both clauses (coincidental boilerplate) is
    not a junction overlap → not merged."""
    shared = _long("shared middle boilerplate block")
    p1 = f"{_long('p1 head')}\n{shared}\n{_long('p1 tail')}"
    p2 = f"{_long('p2 head')}\n{shared}\n{_long('p2 tail')}"
    assert A._content_overlap_merge(p1, p2) is None


def test_normal_single_section_list_unchanged():
    lst = [_c(f"C{i}", _long(f"body number {i}"), str(i)) for i in range(1, 6)]
    out, n = A._stitch_split_clauses(lst)
    assert n == 0
    assert [x["content"] for x in out] == [x["content"] for x in lst]


# ─────────────────────────────────────────────────────────────────────────────
# C — a stitch sets the split_clause flag (via extract()).
# ─────────────────────────────────────────────────────────────────────────────

def _chunk(idx: int) -> str:
    return f"مادة ({idx}) عنوان\nZMARK{idx}Z " + ("نص طويل للاختبار. " * 60)


def test_extract_sets_split_clause_flag(mocker):
    mocker.patch("app.agents.base_agent.Anthropic")
    agent = ClauseExtractorAgent()
    agent._concurrency = 2

    # chunk 1 ends with بند 7 partial P1; chunk 2 starts with بند 7 partial P2.
    canned = {
        1: [_c("بند ٦", _long("6 body"), "6"), _c("الملكية الفكرية", P1, "7")],
        2: [_c("الملكية الفكرية", P2, "7"), _c("بند ٨", _long("8 body"), "8")],
    }
    mocker.patch.object(agent, "_split_on_article_boundaries",
                        return_value=[_chunk(1), _chunk(2)])

    def fake_call(user_content, gate=None):
        idx = int(re.search(r"ZMARK(\d+)Z", user_content).group(1))
        return _ApiResult(text=json.dumps(canned[idx]), truncated=False)

    agent._call_api_with_retry = fake_call
    clauses = agent.extract("x" * 30_001)  # >30k → chunked path

    # the two بند 7 partials became one; بند 6 and بند 8 remain
    assert [c["title"] for c in clauses] == ["بند ٦", "الملكية الفكرية", "بند ٨"]
    m = next(c["content"] for c in clauses if c["title"] == "الملكية الفكرية")
    for marker in ("7 – 1", "7 – 4"):
        assert marker in m
    assert any(f.startswith(_SPLIT_CLAUSE_FLAG_PREFIX) for f in agent.last_quality_flags)
