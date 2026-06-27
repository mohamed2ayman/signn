"""Live Arabic clause-extraction baseline runner (Phase 8.1).

Runs the REAL clause-extractor agent against the anonymized General Conditions
fixture, scores the output, and reports accuracy + token usage + estimated cost.

⚠️ Calls the real Anthropic API (~9 chunked calls on the 81k-char baseline) and
COSTS MONEY. It is NOT part of the unit CI. Run it deliberately:

    RUN_ACCURACY_SUITE=1 ANTHROPIC_API_KEY=... python -m tests.accuracy.run_accuracy

The harness pins temperature=0 for the run (production agents are unchanged —
they never set temperature). This is the §5 "temperature=0 in the harness only"
decision: it makes the baseline reproducible without altering live behaviour.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from tests.accuracy import pricing
from tests.accuracy.scorer import AccuracyReport, score_clause_extraction

_HERE = Path(__file__).parent
FIXTURE = _HERE / "fixtures" / "general_conditions_ar.txt"
GOLDEN = _HERE / "golden" / "general_conditions_ar.golden.json"


class _CreateRecorder:
    """Wraps ``messages.create`` to pin temperature=0 and tally token usage.

    Harness-only — never touches production code. Injected onto the agent's
    client instance for the duration of a single run.
    """

    def __init__(self, real_create):
        self._real = real_create
        self.input_tokens = 0
        self.output_tokens = 0
        self.calls = 0

    def __call__(self, **kwargs):
        kwargs.setdefault("temperature", 0)
        resp = self._real(**kwargs)
        usage = getattr(resp, "usage", None)
        if usage is not None:
            self.input_tokens += getattr(usage, "input_tokens", 0) or 0
            self.output_tokens += getattr(usage, "output_tokens", 0) or 0
        self.calls += 1
        return resp


def load_fixture() -> str:
    return FIXTURE.read_text(encoding="utf-8")


def load_golden() -> list[dict[str, Any]]:
    return json.loads(GOLDEN.read_text(encoding="utf-8"))["clauses"]


def run_baseline() -> dict[str, Any]:
    """Execute the live extraction + scoring. Returns a result dict."""
    # Lazy import so module import (and CI collection) never needs the SDK/key.
    from app.agents.clause_extractor import ClauseExtractorAgent

    source = load_fixture()
    golden = load_golden()

    agent = ClauseExtractorAgent()
    recorder = _CreateRecorder(agent._client.messages.create)
    agent._client.messages.create = recorder  # type: ignore[assignment]

    predicted = agent.extract(full_text=source, document_label="General Conditions")

    report: AccuracyReport = score_clause_extraction(predicted, golden, source)
    cost = pricing.estimate_cost_usd(
        agent._model, recorder.input_tokens, recorder.output_tokens
    )

    return {
        "model": agent._model,
        "api_calls": recorder.calls,
        "input_tokens": recorder.input_tokens,
        "output_tokens": recorder.output_tokens,
        "estimated_cost_usd": round(cost, 4),
        "report": report.to_dict(),
    }


def print_report(result: dict[str, Any]) -> None:
    r = result["report"]
    print("=" * 62)
    print("Arabic clause-extraction baseline — General Conditions")
    print("=" * 62)
    print(f"model                : {result['model']}")
    print(f"api_calls (chunks)   : {result['api_calls']}")
    print(f"tokens in/out        : {result['input_tokens']} / {result['output_tokens']}")
    print(f"estimated cost (USD) : {result['estimated_cost_usd']}  (verify pricing)")
    print("-" * 62)
    print(f"golden / predicted   : {r['golden_count']} / {r['predicted_count']}")
    print(f"matched              : {r['matched']}   duplicates: {r['duplicates']}")
    print(f"boundary P/R/F1      : {r['boundary_precision']} / {r['boundary_recall']} / {r['boundary_f1']}")
    print(f"clause_type accuracy : {r['type_accuracy']}")
    print(f"mean fidelity        : {r['mean_fidelity']}")
    print(f"missing articles     : {r['missing']}")
    print(f"spurious             : {r['spurious']}")
    print(f"low-fidelity matched : {r['low_fidelity']}")
    print("=" * 62)


if __name__ == "__main__":
    if os.getenv("RUN_ACCURACY_SUITE") != "1":
        raise SystemExit(
            "Refusing to run: set RUN_ACCURACY_SUITE=1 (this calls the paid "
            "Anthropic API). See the module docstring."
        )
    print_report(run_baseline())
