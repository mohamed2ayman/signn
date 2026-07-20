"""Compliance has NO gold labels — so this produces a side-by-side view of two
models' {findings, summary} for a HUMAN spot-check (no automated score)."""
from __future__ import annotations

from collections import Counter
from typing import Any


def _counts(findings: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    return {
        "by_severity": dict(Counter(str(f.get("severity", "?")) for f in findings)),
        "by_layer": dict(Counter(str(f.get("layer", "?")) for f in findings)),
        "by_type": dict(Counter(str(f.get("finding_type", "?")) for f in findings)),
    }


def _brief(f: dict[str, Any]) -> dict[str, Any]:
    # The compliance agent's finding schema has NO `description` field — the
    # substantive text lives in `requirement` (what the standard/law requires)
    # and `recommendation` (the action). Surface both for the human spot-check.
    return {
        "layer": f.get("layer"),
        "severity": f.get("severity"),
        "finding_type": f.get("finding_type"),
        "clause_ref": f.get("clause_ref"),
        "requirement": (f.get("requirement") or "")[:220],
        "recommendation": (f.get("recommendation") or "")[:220],
    }


def side_by_side(a_result: dict[str, Any], b_result: dict[str, Any],
                 a_name: str = "sonnet", b_name: str = "haiku") -> dict[str, Any]:
    a_f = a_result.get("findings", []) if isinstance(a_result, dict) else []
    b_f = b_result.get("findings", []) if isinstance(b_result, dict) else []
    return {
        "note": "No gold labels for compliance — HUMAN spot-check required "
                "(matched / missed / weaker / spurious per finding).",
        a_name: {"total": len(a_f), **_counts(a_f), "findings": [_brief(f) for f in a_f]},
        b_name: {"total": len(b_f), **_counts(b_f), "findings": [_brief(f) for f in b_f]},
    }
