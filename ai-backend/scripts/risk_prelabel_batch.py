#!/usr/bin/env python
"""Risk PRE-LABELING batch — Phase 8.3 annotation prep (NOT a production feature).

Runs the existing ``RiskAnalyzerAgent`` over the clause corpus and writes AI risk
pre-labels into ``risk_analyses`` so Label Studio annotators CORRECT rather than
label from scratch — the analog of how ``clause_type`` + ``confidence_score`` are
already populated.

⚠️  UNVALIDATED ANCHORS: the agent's likelihood/impact anchor language is NOT
    domain-expert validated (see the banner in ``app/agents/risk_analyzer.py``).
    These pre-labels are a STARTING POINT for human correction, NOT authoritative
    risk scores. Do not surface them as a shipped product feature.

────────────────────────────────────────────────────────────────────────────────
SAFETY CONTRACT (read before running):
  • This script is INSERT-ONLY into ``risk_analyses``.
  • It NEVER updates/deletes clauses, contract_clauses, clause_type, review_status,
    or anything else. Clause reads are pure SELECT.
  • ``check-categories`` mode writes NOTHING (pure read + agent calls).
  • Sequential, small batches (default 10) to respect the agent's max_tokens=4096.

DECISIONS baked in (per the approved build spec):
  1. CATEGORY  — stores the agent's OWN category name verbatim (truncated to the
     100-char column). No coercion to 'Uncategorized' (empty/missing → 'Uncategorized'
     only as a last resort). No taxonomy strict-match.
  2. LINK      — risk.contract_clause_id = contract_clauses.id (the junction row id).
     NOTE: the existing finalizeReview path stores clauses.id here, which VIOLATES the
     enforced FK ``FK_risk_analyses_clause -> contract_clauses(id)`` (0 clause ids are
     valid cc ids) and would fail to insert. We link by the cc.id that actually
     satisfies the FK and still reaches the clause (cc.id -> cc.clause_id -> clauses.id).
  3. L/I       — accept the agent's likelihood/impact as-is when valid ints 1-5,
     else severity-map (mirrors backend severity-mapping.ts). source = FALLBACK
     (risk_category_platform_defaults is empty, so the backend resolver would also
     return FALLBACK).
  4. RUN       — sequential; ~10-12 clauses/call.

This is a DELIBERATELY SEPARATE, simplified writer (annotation-prep only). It does
NOT reuse / modify the private production writer in document-processing.service.ts,
so it cannot change existing behavior. The small mapping it replicates
(risk_score = L×I; risk_level bands 15/6; FALLBACK source) is traceable to
backend/src/modules/risk-analysis/utils/severity-mapping.ts.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from collections import Counter
from typing import Any

# Make the ai-backend root (…/app's parent) importable when run as a script
# (sys.path[0] is the script dir, not the app root). Standard scripts/ bootstrap.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
import psycopg2.extras

from app.agents.risk_analyzer import RiskAnalyzerAgent, SYSTEM_PROMPT
from app.config.settings import get_settings

# ── Mapping constants (mirrors backend severity-mapping.ts) ────────────────────
_SCORE_HIGH_FLOOR = 15   # >=15 -> HIGH  (15-20 HIGH, 21-25 CRITICAL collapse to HIGH)
_SCORE_MEDIUM_FLOOR = 6  # >=6  -> MEDIUM
_CATEGORY_MAXLEN = 100   # risk_analyses.risk_category is varchar(100)


def _score_to_risk_level(score: int) -> str:
    if score >= _SCORE_HIGH_FLOOR:
        return "HIGH"
    if score >= _SCORE_MEDIUM_FLOOR:
        return "MEDIUM"
    return "LOW"


def _severity_to_li(severity: Any) -> tuple[int, int]:
    s = (severity or "medium").strip().lower() if isinstance(severity, str) else "medium"
    return {
        "critical": (4, 5),
        "high": (3, 5),
        "low": (2, 2),
        "medium": (3, 3),
    }.get(s, (3, 3))


def _connect():
    return psycopg2.connect(get_settings().DATABASE_URL)


# ── Clause loading (READ-ONLY) ─────────────────────────────────────────────────

def load_clauses(cur, *, clause_ids: list[str] | None, contract: str | None,
                 limit: int | None, skip_existing: bool = False) -> list[dict[str, Any]]:
    """Load clauses to pre-label. Pure SELECT. Returns rows ordered by
    (contract_id, order_index) so batches stay within one contract.

    skip_existing=True excludes any clause that ALREADY has ≥1 risk_analyses row —
    used to COMPLETE a partial run (e.g. after truncation) without re-labeling or
    duplicating the clauses that already succeeded."""
    sql = """
        SELECT cc.id            AS contract_clause_id,
               cc.contract_id   AS contract_id,
               cc.order_index   AS order_index,
               cl.id            AS clause_id,
               cl.title         AS title,
               cl.content       AS content,
               cl.clause_type   AS clause_type,
               ct.name          AS contract_name
        FROM contract_clauses cc
        JOIN clauses cl        ON cl.id = cc.clause_id
        JOIN contracts ct      ON ct.id = cc.contract_id
        WHERE 1=1
    """
    params: list[Any] = []
    if skip_existing:
        sql += " AND NOT EXISTS (SELECT 1 FROM risk_analyses ra WHERE ra.contract_clause_id = cc.id)"
    if clause_ids:
        sql += " AND cl.id = ANY(%s::uuid[])"
        params.append(clause_ids)
    if contract:
        sql += " AND ct.name = %s"
        params.append(contract)
    sql += " ORDER BY cc.contract_id, cc.order_index"
    if limit:
        sql += " LIMIT %s"
        params.append(limit)
    cur.execute(sql, params)
    return [dict(r) for r in cur.fetchall()]


def _batches(rows: list[dict[str, Any]], size: int):
    """Yield batches of at most *size*, never crossing a contract_id boundary."""
    cur_cid = None
    buf: list[dict[str, Any]] = []
    for r in rows:
        if r["contract_id"] != cur_cid or len(buf) >= size:
            if buf:
                yield buf
            buf = []
            cur_cid = r["contract_id"]
        buf.append(r)
    if buf:
        yield buf


def _lenient_json_array(raw: str) -> list[dict[str, Any]]:
    """Parse the model's JSON risk array robustly + TRUNCATION-TOLERANT.

    Two problems this handles:
      1. The RiskAnalyzerAgent's own analyze() does a bare json.loads() that FAILS
         on the ```json markdown fence the model returns (a latent production bug —
         it would parse 0 risks in finalizeReview; never noticed because
         risk_analyses is empty). We strip fences first. Agent is NOT modified.
      2. TRUNCATION: a dense batch can hit max_tokens mid-array, so the array has no
         closing ']'. A naive json.loads then drops the WHOLE batch. Instead we
         decode complete top-level objects one at a time and keep every object that
         finished before the cutoff — so a truncated batch still yields its complete
         risks rather than nothing.
    """
    s = (raw or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```\s*$", "", s).strip()
    a = s.find("[")
    if a == -1:
        return []
    # Fast path: a well-formed complete array.
    b = s.rfind("]")
    if b > a:
        try:
            out = json.loads(s[a:b + 1])
            if isinstance(out, list):
                return [x for x in out if isinstance(x, dict)]
        except (json.JSONDecodeError, ValueError):
            pass
    # Salvage path: decode complete objects until the first incomplete one.
    dec = json.JSONDecoder()
    i = a + 1
    objs: list[dict[str, Any]] = []
    while i < len(s):
        while i < len(s) and s[i] in " \t\r\n,":
            i += 1
        if i >= len(s) or s[i] == "]":
            break
        try:
            obj, end = dec.raw_decode(s, i)
        except (json.JSONDecodeError, ValueError):
            break  # truncated/incomplete object — keep what we have
        if isinstance(obj, dict):
            objs.append(obj)
        i = end
    return objs


def _run_agent(agent: RiskAnalyzerAgent, batch: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Call the risk agent on one batch and parse robustly. Sends only {id, text}
    (no doc metadata) so the model uses per-clause framing, not cross-document
    conflict framing. Uses the agent's own SYSTEM_PROMPT + _call_model chokepoint
    (PII-scrubbed) but our own lenient parser (see _lenient_json_array)."""
    user_content = "Analyse the following contract clauses for risks:\n\n"
    for r in batch:
        user_content += f"### Clause {r['clause_id']}\n{r['content'] or ''}\n\n"
    try:
        msg = agent._call_model(
            scrub=True,
            max_tokens=8192,  # raised from the agent's 4096 to cut truncation on dense batches
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
        return _lenient_json_array(msg.content[0].text)
    except Exception as exc:  # noqa: BLE001 — one bad batch must not kill the run
        print(f"  ! agent call failed for batch of {len(batch)}: {exc}", file=sys.stderr)
        return []


# ── Row building (the simplified writer) ───────────────────────────────────────

def build_rows(batch: list[dict[str, Any]], risks: list[dict[str, Any]]):
    """Map agent risks -> risk_analyses row tuples. Returns (rows, skipped, stats)."""
    by_clause = {r["clause_id"]: r for r in batch}
    rows = []
    skipped = 0
    for risk in risks:
        cid = risk.get("clause_id")
        src = by_clause.get(cid)
        if src is None:
            skipped += 1
            continue  # agent echoed an id not in this batch — drop, don't guess
        if not risk.get("description"):
            skipped += 1
            continue
        li_ok = (isinstance(risk.get("likelihood"), int) and isinstance(risk.get("impact"), int)
                 and 1 <= risk["likelihood"] <= 5 and 1 <= risk["impact"] <= 5)
        if li_ok:
            L, I = risk["likelihood"], risk["impact"]
        elif isinstance(risk.get("severity"), str):
            L, I = _severity_to_li(risk.get("severity"))
        else:
            skipped += 1
            continue
        score = L * I
        cat = risk.get("risk_category")
        cat = cat.strip()[:_CATEGORY_MAXLEN] if isinstance(cat, str) and cat.strip() else "Uncategorized"
        rows.append({
            "id": str(uuid.uuid4()),
            "contract_id": src["contract_id"],
            "contract_clause_id": src["contract_clause_id"],  # cc.id — satisfies FK
            "risk_category": cat,
            "risk_level": _score_to_risk_level(score),
            "description": risk["description"],
            "recommendation": risk.get("suggestion") or None,
            "likelihood": L,
            "impact": I,
            "risk_score": score,
            "likelihood_source": "FALLBACK",
            "impact_source": "FALLBACK",
            "status": "OPEN",
        })
    return rows, skipped


_INSERT = """
INSERT INTO risk_analyses
  (id, contract_id, contract_clause_id, risk_category, risk_level, description,
   recommendation, likelihood, impact, risk_score, likelihood_source, impact_source, status)
VALUES
  (%(id)s, %(contract_id)s, %(contract_clause_id)s, %(risk_category)s, %(risk_level)s,
   %(description)s, %(recommendation)s, %(likelihood)s, %(impact)s, %(risk_score)s,
   %(likelihood_source)s, %(impact_source)s, %(status)s)
"""


def insert_rows(cur, rows: list[dict[str, Any]]) -> int:
    for row in rows:
        cur.execute(_INSERT, row)
    return len(rows)


# ── Modes ──────────────────────────────────────────────────────────────────────

def mode_check_categories(args):
    """READ-ONLY: run the agent on a sample, report the category names + consistency.
    Writes NOTHING to the DB."""
    conn = _connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    rows = load_clauses(cur, clause_ids=args.clause_ids, contract=args.contract,
                        limit=args.limit, skip_existing=args.skip_existing)
    conn.close()
    print(f"[check-categories] sampling {len(rows)} clauses (NO writes)\n")
    agent = RiskAnalyzerAgent()
    cats = Counter()
    total_risks = 0
    per_clause = []
    for batch in _batches(rows, args.batch_size):
        risks = _run_agent(agent, batch)
        total_risks += len(risks)
        for risk in risks:
            c = risk.get("risk_category")
            cats[c.strip() if isinstance(c, str) and c.strip() else "(empty)"] += 1
        counts = Counter(r.get("clause_id") for r in risks)
        for r in batch:
            per_clause.append((r["clause_type"], (r["title"] or "")[:34], counts.get(r["clause_id"], 0)))
    print(f"risks returned: {total_risks} across {len(rows)} clauses\n")
    print("CATEGORY NAMES produced by the agent (freq):")
    for name, n in cats.most_common():
        print(f"  {n:3}  {name!r}")
    print("\nper-clause risk count (clause_type | title | #risks):")
    for ctype, title, n in per_clause:
        print(f"  {n:2}  [{ctype:14}] {title!r}")


def mode_write(args, *, dry_run: bool):
    label = "dry-run" if dry_run else "FULL"
    conn = _connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    rows = load_clauses(cur, clause_ids=args.clause_ids, contract=args.contract,
                        limit=args.limit, skip_existing=args.skip_existing)
    print(f"[{label}] processing {len(rows)} clauses in batches of {args.batch_size}\n")
    agent = RiskAnalyzerAgent()
    total_saved = total_skipped = 0
    inserted_ids = []
    for bi, batch in enumerate(_batches(rows, args.batch_size), 1):
        risks = _run_agent(agent, batch)
        built, skipped = build_rows(batch, risks)
        n = insert_rows(cur, built)
        conn.commit()  # commit per batch — partial progress survives an interruption
        inserted_ids.extend(x["id"] for x in built)
        total_saved += n
        total_skipped += skipped
        print(f"  batch {bi}: {len(batch)} clauses -> {n} risks saved, {skipped} skipped")
    print(f"\n[{label}] DONE — {total_saved} risk rows inserted, {total_skipped} skipped")
    # Echo back the inserted rows (joined to the clause) for spot-checking.
    if inserted_ids:
        cur.execute("""
            SELECT ra.risk_category, ra.likelihood, ra.impact, ra.risk_score, ra.risk_level,
                   cl.clause_type, LEFT(cl.title,34) AS title, LEFT(ra.description,120) AS description
            FROM risk_analyses ra
            JOIN contract_clauses cc ON cc.id = ra.contract_clause_id
            JOIN clauses cl ON cl.id = cc.clause_id
            WHERE ra.id = ANY(%s::uuid[])
            ORDER BY cl.clause_type, ra.risk_score DESC
        """, (inserted_ids,))
        print("\ninserted rows (spot-check):")
        for r in cur.fetchall():
            print(f"  [{r['clause_type']:14}] L{r['likelihood']}×I{r['impact']}={r['risk_score']} "
                  f"{r['risk_level']:6} {r['risk_category']!r}  «{r['title']}»")
            print(f"       {r['description']!r}")
    conn.close()


def main():
    p = argparse.ArgumentParser(description="Risk pre-labeling batch (annotation prep)")
    p.add_argument("--mode", choices=["check-categories", "dry-run", "full"], required=True)
    p.add_argument("--batch-size", type=int, default=6,
                   help="clauses per API call (small avoids max_tokens truncation)")
    p.add_argument("--limit", type=int, default=None, help="max clauses to load")
    p.add_argument("--contract", default=None, help="filter to one contract name")
    p.add_argument("--clause-ids", default=None, help="comma-separated clauses.id list")
    p.add_argument("--skip-existing", action="store_true",
                   help="only process clauses with NO existing risk row (complete a partial run)")
    args = p.parse_args()
    args.clause_ids = [s.strip() for s in args.clause_ids.split(",")] if args.clause_ids else None

    if args.mode == "check-categories":
        mode_check_categories(args)
    elif args.mode == "dry-run":
        mode_write(args, dry_run=True)
    else:
        mode_write(args, dry_run=False)


if __name__ == "__main__":
    main()
