"""Integrity checks for the baseline fixture + golden set — NO API (runs in CI)."""
from __future__ import annotations

import json
from pathlib import Path

from app.agents.clause_extractor import _ARTICLE_BOUNDARY_RE
from tests.accuracy.scorer import ALLOWED_CLAUSE_TYPES

_HERE = Path(__file__).parent
FIXTURE = _HERE / "fixtures" / "general_conditions_ar.txt"
GOLDEN = _HERE / "golden" / "general_conditions_ar.golden.json"

# Anonymization markers that MUST be present (positive check — never references
# the original sensitive values).
EXPECTED_PLACEHOLDERS = {
    "[PARTY_A]": 2, "[PARTY_B]": 1, "[PARTY_C]": 1, "[PARTY_D]": 1,
    "[PARTY_E]": 1, "[PROJECT]": 5, "[LOCATION]": 2,
}


def test_golden_has_38_contiguous_clauses():
    # 37 مادة articles + the final الفقرة (38) clause = 38 total.
    data = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert data["expected_clause_count"] == 38
    clauses = data["clauses"]
    assert len(clauses) == 38
    nums = [c["section_number"] for c in clauses]
    assert nums == [str(i) for i in range(1, 39)]


def test_golden_types_and_titles_valid():
    clauses = json.loads(GOLDEN.read_text(encoding="utf-8"))["clauses"]
    for c in clauses:
        assert c["clause_type"] in ALLOWED_CLAUSE_TYPES, c
        assert c["title_ar"].strip(), c


def test_fixture_size_and_chunking_match_baseline():
    text = FIXTURE.read_text(encoding="utf-8")
    assert 80_000 < len(text) < 82_000  # ~81k baseline
    assert len(text) > 30_000           # exercises the chunked path
    boundaries = [m.start() for m in _ARTICLE_BOUNDARY_RE.finditer(text)]
    # 37 body articles + 37 TOC stubs = 74 article-boundary markers.
    assert len(boundaries) >= 37


def test_fixture_is_anonymized():
    text = FIXTURE.read_text(encoding="utf-8")
    for token, expected in EXPECTED_PLACEHOLDERS.items():
        assert text.count(token) == expected, (token, text.count(token), expected)
