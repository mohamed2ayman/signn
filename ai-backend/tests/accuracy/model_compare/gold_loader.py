"""Load Phase 8.3 gold clauses + risks for a contract (from a runtime dir).

The real gold (real Arabic contract text) is NEVER committed — pass ``gold_dir``
(or set ``GOLD_DIR``) to a directory holding ``gold_clauses.jsonl`` +
``gold_risks.jsonl`` at run time. Pure I/O + shaping; no model calls.
"""
from __future__ import annotations

import json
import os
from typing import Any


def _read_jsonl(path: str) -> list[dict[str, Any]]:
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def resolve_gold_dir(gold_dir: str | None = None) -> str:
    d = gold_dir or os.environ.get("GOLD_DIR")
    if not d:
        raise RuntimeError(
            "gold dir not set — pass gold_dir or set GOLD_DIR to a directory with "
            "gold_clauses.jsonl + gold_risks.jsonl (real gold is not committed)."
        )
    return d


def load_gold(gold_dir: str | None = None) -> dict[str, list[dict[str, Any]]]:
    d = resolve_gold_dir(gold_dir)
    return {
        "clauses": _read_jsonl(os.path.join(d, "gold_clauses.jsonl")),
        "risks": _read_jsonl(os.path.join(d, "gold_risks.jsonl")),
    }


def contract_clauses(all_clauses: list[dict[str, Any]], contract: str) -> list[dict[str, Any]]:
    """Agent-input shape: {id, text, clause_ref, document_label}. `id` is the
    junction `contract_clause_id`, which the risk model echoes back as `clause_id`
    (so scoring aligns model risks to gold clauses directly)."""
    out: list[dict[str, Any]] = []
    for c in all_clauses:
        if c.get("contract") != contract:
            continue
        out.append({
            "id": c["contract_clause_id"],
            "text": c.get("text", "") or "",
            "clause_ref": c.get("section_number"),
            # Production feeds the FRIENDLY label ("General Conditions") into the
            # prompt, not the raw filename — mirror that; fall back to the filename.
            "document_label": c.get("document_label") or c.get("document"),
        })
    return out


def contract_gold_risks(all_risks: list[dict[str, Any]], contract: str) -> list[dict[str, Any]]:
    return [r for r in all_risks if r.get("contract") == contract]


def is_arabic(text: str) -> bool:
    return any("؀" <= ch <= "ۿ" for ch in (text or ""))
