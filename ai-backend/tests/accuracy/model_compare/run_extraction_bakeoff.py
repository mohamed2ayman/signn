"""Extraction bake-off runner (Step 5 Phase 0). Two modes:

  * SELF-CONSISTENCY (FREE, no model, no billing) — score the gold set against ITSELF to prove the
    harness + scorer end-to-end and print the per-language report structure:

        GOLD_DIR=/path/to/phase-8.3-gold python -m tests.accuracy.model_compare.run_extraction_bakeoff

  * LIVE bake-off (GATED, BILLABLE — a later phase, NOT this one) — run an OpenAI-compatible model
    (Together.ai / OpenRouter) per document and score vs gold. Requires ``RUN_EXTRACTION_BAKEOFF=1``
    + provider creds AND a **source-text provider** (see the note below). Refuses to run otherwise.

⚠️ The gold set stores each clause's TEXT but NOT the raw source DOCUMENT a model must read as input
(`_raw_docs.jsonl` is metadata only). A live run therefore needs each document's `extracted_text`
(from the DB `document_uploads`, or a separately-provided anonymized source map) — a documented
prerequisite for the live phase, not needed for self-consistency.
"""
from __future__ import annotations

import os

from tests.accuracy.model_compare import gold_loader
from tests.accuracy.model_compare.extraction_gold import (
    ExtractionGoldReport,
    GroupReport,
    LanguageAggregate,
    _aggregate,
    self_consistency,
)


def _per_contract(groups: list[GroupReport]) -> dict[str, LanguageAggregate]:
    """Roll the per-document groups up to per-contract aggregates (micro-pooled)."""
    contracts = sorted({g.contract for g in groups})
    return {c: _aggregate([g for g in groups if g.contract == c], None) for c in contracts}


def print_report(report: ExtractionGoldReport, *, title: str = "Extraction vs Phase-8.3 gold") -> None:
    print("=" * 78)
    print(title)
    print("=" * 78)
    print(
        "NOTE: the old single-English-fixture 'boundary F1 = 1.0' baseline is STALE — the Phase-8.3 "
        "gold set (15 contracts, Arabic + English) is now the extraction reference. Arabic is the "
        "Phase-8.1 decision metric."
    )

    def _line(a: LanguageAggregate, label: str) -> None:
        print(
            f"{label:22} docs={a.n_documents:<3} contracts={a.n_contracts:<3} "
            f"P/R/F1(micro)={a.micro_precision}/{a.micro_recall}/{a.micro_f1}  "
            f"F1(macro)={a.macro_f1}  fidelity={a.mean_fidelity}  type={a.type_accuracy}  "
            f"gold#={a.gold_numbered} matched={a.matched} unnumbered={a.gold_unnumbered}"
        )

    print("-" * 78)
    print("PER LANGUAGE (Arabic is the decision metric):")
    for lang in ("ar", "en"):
        if lang in report.per_language:
            _line(report.per_language[lang], f"  {lang.upper()}")
    _line(report.overall, "  OVERALL")

    print("-" * 78)
    print("PER CONTRACT (document-pooled):")
    for name, agg in _per_contract(report.per_group).items():
        flag = "  ⚠ collisions/unnumbered" if (agg.micro_f1 < 1.0 or agg.gold_unnumbered) else ""
        print(
            f"  {name:16} [{agg.language}] F1={agg.micro_f1}  fidelity={agg.mean_fidelity}  "
            f"gold#={agg.gold_numbered} matched={agg.matched} unnumbered={agg.gold_unnumbered}{flag}"
        )
    print("=" * 78)


def run_self_consistency(gold_dir: str | None = None) -> ExtractionGoldReport:
    """FREE — feed the gold back as its own predictions. Perfect boundary/fidelity ⇒ scorer works."""
    gold = gold_loader.load_gold(gold_dir)
    report = self_consistency(gold["clauses"])
    print_report(report, title="SELF-CONSISTENCY (gold vs gold — FREE, no model, no billing)")
    ov = report.overall
    print(
        f"\nSELF-CONSISTENCY CHECK: overall micro F1={ov.micro_f1} fidelity={ov.mean_fidelity} "
        f"type={ov.type_accuracy} — expected ~1.0 (proves the scorer + language slicing)."
    )
    return report


def _run_live() -> None:  # pragma: no cover — billable, later phase, never run in Phase 0
    raise SystemExit(
        "LIVE bake-off is a later phase. It needs (1) RUN_EXTRACTION_BAKEOFF=1, (2) provider "
        "base_url + api_key, and (3) a source-text provider for each document (the gold set carries "
        "clause text, not the raw source document). See this module's docstring."
    )


if __name__ == "__main__":  # pragma: no cover
    if os.getenv("RUN_EXTRACTION_BAKEOFF") == "1":
        _run_live()
    else:
        # Default = the FREE self-consistency proof. Requires GOLD_DIR (real gold is not committed).
        run_self_consistency()
