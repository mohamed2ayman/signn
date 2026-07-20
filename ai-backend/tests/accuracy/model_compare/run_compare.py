"""GATED, BILLABLE model-comparison runner (Step 3: Haiku vs Sonnet).

Runs risk + compliance for each (model × contract) over the gold subset, scores
risk vs the human-verified gold, dumps compliance side-by-side, and prints a cost
report. Calls the paid Anthropic API — NEVER runs in unit CI.

    RUN_MODEL_COMPARE=1 ANTHROPIC_API_KEY=... GOLD_DIR=/path/to/gold \
      python -m tests.accuracy.model_compare.run_compare

Config (env, all optional except the gate + GOLD_DIR):
  SONNET_MODEL   default claude-sonnet-4-6
  HAIKU_MODEL    default claude-haiku-4-5-20251001
  COMPARE_CONTRACTS  default "Project6,Project12,Project7"
  COMPARE_STAGES     default "risk,compliance"
  COMPARE_REPEATS    default 1   (set 2 for a variance check — lesson #271)
"""
from __future__ import annotations

import json
import os

from tests.accuracy.model_compare import gold_loader, run_stage
from tests.accuracy.model_compare.compliance_dump import side_by_side
from tests.accuracy.model_compare.risk_scorer import head_to_head, score_risk

SONNET = os.environ.get("SONNET_MODEL", "claude-sonnet-4-6")
HAIKU = os.environ.get("HAIKU_MODEL", "claude-haiku-4-5-20251001")


def _try_stage(label: str, stage: str, model: str, payload, **kw):
    """Run ONE stage but never let a single weak-model failure (a truncated /
    malformed JSON parse — exactly the failure the benchmark exists to observe)
    abort the whole PAID run. Returns the StageResult, or None on failure after
    logging it as a data point."""
    try:
        return run_stage.run_stage(stage, model, payload, **kw)
    except Exception as exc:  # noqa: BLE001 — a model failure is a data point, not a run-aborter
        print(f"[{label}] {model:20} FAILED — {type(exc).__name__}: {exc}")
        return None


def _run() -> None:
    contracts = os.environ.get("COMPARE_CONTRACTS", "Project6,Project12,Project7").split(",")
    stages = os.environ.get("COMPARE_STAGES", "risk,compliance").split(",")
    repeats = int(os.environ.get("COMPARE_REPEATS", "1"))
    gold = gold_loader.load_gold()
    total_cost = 0.0

    for contract in [c.strip() for c in contracts if c.strip()]:
        clauses = gold_loader.contract_clauses(gold["clauses"], contract)
        gold_risks = gold_loader.contract_gold_risks(gold["risks"], contract)
        print("\n" + "=" * 78)
        print(f"CONTRACT {contract} — {len(clauses)} clauses, "
              f"{sum(1 for r in gold_risks if r.get('human_verified') and str(r.get('severity')).upper()=='HIGH')} "
              f"human-verified-High")
        print("=" * 78)

        for rep in range(1, repeats + 1):
            if "risk" in stages:
                risk_out = {}
                for name, model in (("sonnet", SONNET), ("haiku", HAIKU)):
                    res = _try_stage(f"risk rep{rep}", "risk", model, clauses, contract=contract)
                    risk_out[name] = res
                    if res is None:
                        continue
                    total_cost += res.cost_usd
                    sc = score_risk(res.outputs, gold_risks, clauses)
                    print(f"[risk rep{rep}] {name:6} ${res.cost_usd:.4f}  "
                          f"in/out={res.input_tokens}/{res.output_tokens} cache_w/r="
                          f"{res.cache_creation_tokens}/{res.cache_read_tokens}")
                    print("           score:", json.dumps(sc, ensure_ascii=False))
                if risk_out.get("sonnet") and risk_out.get("haiku"):
                    h2h = head_to_head(risk_out["sonnet"].outputs, risk_out["haiku"].outputs,
                                       clauses, "sonnet", "haiku")
                    print(f"[risk rep{rep}] HEAD-TO-HEAD:", json.dumps(h2h, ensure_ascii=False))

            if "compliance" in stages:
                comp = {}
                for name, model in (("sonnet", SONNET), ("haiku", HAIKU)):
                    res = _try_stage(f"compliance rep{rep}", "compliance", model, clauses,
                                     contract=contract, jurisdiction="EG")
                    comp[name] = res
                    if res is None:
                        continue
                    total_cost += res.cost_usd
                    print(f"[compliance rep{rep}] {name:6} ${res.cost_usd:.4f}  "
                          f"in/out={res.input_tokens}/{res.output_tokens}")
                if comp.get("sonnet") and comp.get("haiku"):
                    dump = side_by_side(comp["sonnet"].outputs, comp["haiku"].outputs)
                    print(f"[compliance rep{rep}] SIDE-BY-SIDE:",
                          json.dumps(dump, ensure_ascii=False)[:1200], "…")

    print("\n" + "=" * 78)
    print(f"TOTAL ESTIMATED COST: ${round(total_cost, 4)}")
    print("=" * 78)


if __name__ == "__main__":
    if os.environ.get("RUN_MODEL_COMPARE") != "1":
        raise SystemExit(
            "Refusing to run: set RUN_MODEL_COMPARE=1 (this calls the paid "
            "Anthropic API). Also set GOLD_DIR. See the module docstring."
        )
    _run()
