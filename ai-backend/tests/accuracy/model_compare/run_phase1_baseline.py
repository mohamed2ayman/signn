"""Step 5 Phase 1 — fresh Claude extraction baseline on gold contracts (BILLABLE, budget-capped).

Runs the REAL production extraction pipeline (ClauseExtractorAgent, claude-sonnet-4-6) fresh on each
selected contract's raw source text, scores the output against the Phase-8.3 gold with the Phase-0
gold-backed scorer (boundary P/R/F1 + verbatim fidelity + type), captures truncation warnings, prints
the running cost after EACH contract, and HALTS before a hard budget cap. Saves raw Claude outputs so
Phase 2 can score Qwen/Llama on the EXACT same contracts identically.

    GOLD_DIR=/tmp/gold SRC_DIR=/tmp/src OUT_DIR=/tmp/out BUDGET_CAP=2.50 \
      ANTHROPIC_API_KEY=... python -m tests.accuracy.model_compare.run_phase1_baseline
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from app.agents.clause_extractor import SYSTEM_PROMPT as _SYSTEM_PROMPT
from tests.accuracy.model_compare import gold_loader
from tests.accuracy.model_compare.extraction_gold import classify_language, score_group
from tests.accuracy.model_compare.run_stage import run_stage

BUDGET = float(os.environ.get("BUDGET_CAP", "2.50"))
MODEL = os.environ.get("BASELINE_MODEL", "claude-sonnet-4-6")
SRC_DIR = Path(os.environ.get("SRC_DIR", "/tmp/src"))
OUT_DIR = Path(os.environ.get("OUT_DIR", "/tmp/out"))
OUT_DIR.mkdir(parents=True, exist_ok=True)

# (contract, source filename, conservative pre-estimate $). Order = AR-small → EN → AR-medium so
# 1 Arabic + 1 English (both languages) is secured before the pricier run. Both Arabic picks are
# clean single-numbering (Project4's combined GC+PC confounds section-key scoring — a Phase-0
# known-hard case — so it is NOT used for the clean decision-metric baseline).
PLAN = [
    ("Project10", "Project10.txt", 0.35),
    ("Project_1", "Project_1.txt", 0.35),
    ("Project8", "Project8.txt", 0.40),
]
INTER_SLEEP = float(os.environ.get("INTER_SLEEP", "5"))  # gentle gap between contracts (rate limits)
# SAFETY (stable-network run): NO whole-contract retry (1) + exactly ONE internal API attempt per
# chunk (SINGLE_ATTEMPT=1 monkeypatch below). A dropped call can still bill for the generation, so on
# a good link we take at most one shot per chunk; a rare failure = re-run MANUALLY, never auto-retry.
EXTRACT_RETRIES = int(os.environ.get("EXTRACT_RETRIES", "1"))
SINGLE_ATTEMPT = os.environ.get("SINGLE_ATTEMPT", "1") == "1"


def _single_attempt_call(self, user_content, gate=None):
    """Harness override of ClauseExtractorAgent._call_api_with_retry — exactly ONE API call, no
    retry loop, no backoff. On any error it raises immediately: the chunked path skips that chunk
    (partial result), the single-call path fails the contract — either way NO retry storm, so we
    never bill a second generation for the same chunk on a flaky link."""
    from app.agents.clause_extractor import _ApiResult
    max_tokens = self._calculate_max_tokens(len(user_content))
    if gate is not None:
        gate.wait_if_needed()
    raw = self._call_model(
        max_tokens=max_tokens, system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
        raw=True, cache_system=True,
    )
    if gate is not None:
        gate.note_headers(raw.headers)
    message = raw.parse()
    text = message.content[0].text
    truncated = getattr(message, "stop_reason", None) == "max_tokens"
    return _ApiResult(text=text, truncated=truncated)


class _TruncationWatch(logging.Handler):
    """Capture the extractor's truncation / salvage warnings so the baseline is honest."""

    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.hits: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage().lower()
        if any(w in msg for w in ("truncat", "salvag", "incomplete", "still truncated")):
            self.hits.append(record.getMessage())


def main() -> None:
    # Make the extractor's retry / rate-limit / truncation WARNINGs visible so an API failure is
    # diagnosable (the first run hid them). Quiet the noisy httpx/anthropic INFO chatter.
    logging.basicConfig(level=logging.WARNING, format="    [log] %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.ERROR)

    if SINGLE_ATTEMPT:
        from app.agents.clause_extractor import ClauseExtractorAgent
        ClauseExtractorAgent._call_api_with_retry = _single_attempt_call  # type: ignore[assignment]
        print("SAFETY: internal API retries = 1 (single attempt/chunk), whole-contract retries = "
              f"{EXTRACT_RETRIES} — no retry storms.")

    gold = gold_loader.load_gold()["clauses"]

    def gold_for(contract: str) -> list[dict]:
        return [c for c in gold if c.get("contract") == contract]

    watch = _TruncationWatch()
    logging.getLogger("app.agents.clause_extractor").addHandler(watch)

    print("=" * 84)
    print(f"STEP 5 PHASE 1 — Claude extraction baseline ({MODEL}) | HARD CAP ${BUDGET:.2f}")
    print("=" * 84)

    spent = 0.0
    results: list[dict] = []
    for idx, (contract, srcfile, est) in enumerate(PLAN):
        if idx > 0:
            time.sleep(INTER_SLEEP)  # let rate limits recover between contracts
        if spent + est > BUDGET:
            print(f"\n⛔ HALT before {contract}: spent ${spent:.4f} + est ${est:.2f} would exceed "
                  f"cap ${BUDGET:.2f}. Stopping with {len(results)} contract(s) done.")
            break

        gclauses = gold_for(contract)
        if not gclauses:
            print(f"  !! {contract}: no gold clauses found — skipping")
            continue
        source = (SRC_DIR / srcfile).read_text(encoding="utf-8")
        label = gclauses[0].get("document_label") or gclauses[0].get("document")
        lang = classify_language(" ".join((c.get("text") or "") for c in gclauses))

        n_before = len(watch.hits)
        print(f"\n>>> {contract} [{lang}] — {len(source):,} source chars — running Claude (est ${est:.2f}) …")
        # Intermittent egress drops kill long Arabic single-call generations mid-stream. A DROPPED
        # call bills ~$0 (usage is tallied only on a successful parse), so retry the whole extraction
        # up to EXTRACT_RETRIES times — free on failure, and re-run on a partial/truncated success.
        res = None
        for attempt in range(1, EXTRACT_RETRIES + 1):
            try:
                # run_stage passes its `contract=` through as the extractor's document_label.
                candidate = run_stage("extraction", MODEL, source, contract=label)
            except Exception as exc:  # noqa: BLE001 — a run failure is a data point, not an abort
                print(f"    attempt {attempt}/{EXTRACT_RETRIES} failed: {type(exc).__name__}: {exc}")
                time.sleep(4)
                continue
            truncated_now = len(watch.hits) > n_before
            if not truncated_now or attempt == EXTRACT_RETRIES:
                res = candidate
                break
            # partial/truncated success — a chunk dropped; retry for a complete extraction.
            spent += candidate.cost_usd  # a partial success still billed — count it honestly
            print(f"    attempt {attempt}/{EXTRACT_RETRIES} truncated (partial, +${candidate.cost_usd:.4f}) "
                  f"— retrying for a complete extraction; running total ${spent:.4f}")
            n_before = len(watch.hits)
            time.sleep(4)
        if res is None:
            print(f"  !! {contract} FAILED after {EXTRACT_RETRIES} attempts (connection drops)")
            continue

        spent += res.cost_usd
        rep = score_group(res.outputs, gclauses, contract=contract,
                          document=gclauses[0].get("document", ""))
        truncations = watch.hits[n_before:]

        # Save the raw Claude output for Phase 2 (score Qwen/Llama on the SAME contracts identically).
        (OUT_DIR / f"{contract}.claude.json").write_text(
            json.dumps({
                "contract": contract, "language": lang, "model": MODEL,
                "source_chars": len(source), "document_label": label,
                "tokens_in": res.input_tokens, "tokens_out": res.output_tokens,
                "cache_read_tokens": res.cache_read_tokens,
                "cache_write_tokens": res.cache_creation_tokens,
                "api_calls": res.calls, "cost_usd": round(res.cost_usd, 6),
                "predicted_clauses": res.outputs,
                "score": rep.to_dict(), "truncation_warnings": truncations,
            }, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )

        results.append({"contract": contract, "lang": lang, "rep": rep, "res": res,
                        "truncations": truncations})
        print(f"    cost ${res.cost_usd:.4f}  |  RUNNING TOTAL ${spent:.4f} / ${BUDGET:.2f}")
        print(f"    tokens in/out {res.input_tokens:,}/{res.output_tokens:,}  "
              f"cache r/w {res.cache_read_tokens:,}/{res.cache_creation_tokens:,}  calls {res.calls}")
        print(f"    boundary P/R/F1 = {rep.boundary_precision}/{rep.boundary_recall}/{rep.boundary_f1}"
              f"  fidelity {rep.mean_fidelity}  type {rep.type_accuracy}")
        print(f"    matched {rep.matched}/{rep.gold_numbered} gold  predicted {rep.predicted_total} "
              f"(numbered {rep.predicted_numbered})  missing {len(rep.missing)}  "
              f"spurious {len(rep.spurious)}  dup {rep.duplicates}  low_fidelity {len(rep.low_fidelity)}")
        if truncations:
            print(f"    ⚠ TRUNCATION: {len(truncations)} warning(s) — e.g. {truncations[0][:90]}")
        if spent > BUDGET:
            print(f"\n⛔ OVER BUDGET after {contract} (${spent:.4f} > ${BUDGET:.2f}) — stopping.")
            break

    _final_report(results, spent)


def _final_report(results: list[dict], spent: float) -> None:
    print("\n" + "=" * 84)
    print("PHASE 1 BASELINE — Claude (claude-sonnet-4-6) vs Phase-8.3 gold")
    print("=" * 84)
    print(f"{'contract':12} {'lang':4} {'F1':>7} {'prec':>7} {'rec':>7} {'fidelity':>9} "
          f"{'type':>6} {'match/gold':>11} {'trunc':>6} {'cost$':>8}")
    print("-" * 84)
    for r in results:
        rep = r["rep"]
        print(f"{r['contract']:12} {r['lang']:4} {rep.boundary_f1:>7} {rep.boundary_precision:>7} "
              f"{rep.boundary_recall:>7} {rep.mean_fidelity:>9} {rep.type_accuracy:>6} "
              f"{str(rep.matched)+'/'+str(rep.gold_numbered):>11} {len(r['truncations']):>6} "
              f"{r['res'].cost_usd:>8.4f}")

    def _agg(lang: str) -> None:
        sel = [r for r in results if r["lang"] == lang]
        if not sel:
            return
        matched = sum(r["rep"].matched for r in sel)
        gnum = sum(r["rep"].gold_numbered for r in sel)
        pnum = sum(r["rep"].predicted_numbered for r in sel)
        p = matched / pnum if pnum else 0.0
        rc = matched / gnum if gnum else 0.0
        f1 = 2 * p * rc / (p + rc) if (p + rc) else 0.0
        fid = sum(r["rep"].mean_fidelity for r in sel) / len(sel)
        print(f"  {lang.upper():4} micro P/R/F1 = {round(p,4)}/{round(rc,4)}/{round(f1,4)}  "
              f"mean fidelity {round(fid,4)}  ({len(sel)} contract(s))")

    print("-" * 84)
    print("PER LANGUAGE (Arabic is the Phase-8.1 DECISION metric):")
    _agg("ar")
    _agg("en")
    print("-" * 84)
    print(f"TOTAL SPEND: ${spent:.4f}   (cap ${BUDGET:.2f}, "
          f"{'UNDER' if spent <= BUDGET else 'OVER!'} by ${abs(BUDGET - spent):.4f})")
    print(f"Raw Claude outputs saved to {OUT_DIR} — reuse for Phase 2 (Qwen/Llama on the SAME contracts).")
    print("=" * 84)


if __name__ == "__main__":
    main()
