"""Gated LIVE clause-extraction baseline test (Phase 8.1).

SKIPPED by default — it calls the paid Anthropic API. Opt in with:

    RUN_ACCURACY_SUITE=1 ANTHROPIC_API_KEY=... pytest \
        tests/accuracy/test_accuracy_clause_extraction.py -s

It CAPTURES + prints the baseline (it is not a strict pass/fail gate); the
assertions are loose sanity checks that the harness ran end-to-end.
"""
from __future__ import annotations

import os

import pytest

_RUN = os.getenv("RUN_ACCURACY_SUITE") == "1" and bool(os.getenv("ANTHROPIC_API_KEY"))


@pytest.mark.skipif(
    not _RUN,
    reason="Live accuracy suite (paid API). Set RUN_ACCURACY_SUITE=1 + ANTHROPIC_API_KEY.",
)
def test_clause_extraction_baseline():
    # Lazy import so CI collection never needs the SDK/key.
    from tests.accuracy.run_accuracy import print_report, run_baseline

    result = run_baseline()
    print_report(result)

    r = result["report"]
    assert r["golden_count"] == 38
    assert r["matched"] > 0
    assert r["boundary_recall"] >= 0.5  # loose baseline sanity, not a strict gate
