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


class _UsageTally:
    """Shared token counters accumulated across a run (plain + raw endpoints).

    Tallies the prompt-caching usage fields
    (``cache_creation_input_tokens`` / ``cache_read_input_tokens``) alongside the
    plain input/output so the cost estimate stays accurate now that clause
    extraction caches its system prompt.
    """

    def __init__(self) -> None:
        self.input_tokens = 0
        self.output_tokens = 0
        self.cache_creation_tokens = 0
        self.cache_read_tokens = 0
        self.calls = 0

    def add_usage(self, usage) -> None:
        if usage is None:
            return
        self.input_tokens += getattr(usage, "input_tokens", 0) or 0
        self.output_tokens += getattr(usage, "output_tokens", 0) or 0
        self.cache_creation_tokens += getattr(usage, "cache_creation_input_tokens", 0) or 0
        self.cache_read_tokens += getattr(usage, "cache_read_input_tokens", 0) or 0


class _RawResponseProxy:
    """Forwards a raw-response wrapper's interface, tallying usage on ``.parse()``.

    The clause extractor's raw path reads ``.headers`` (rate-limit gate) and
    ``.parse()`` on the wrapper — so the recorder for the raw slot MUST return an
    object that still exposes both, backed by the REAL wrapper. Usage is tallied
    on the SAME ``.parse()`` the extractor consumes (no double parse). Anything
    else (attrs the SDK may add) is delegated to the wrapper.
    """

    def __init__(self, wrapper, tally: _UsageTally) -> None:
        self._wrapper = wrapper
        self._tally = tally

    @property
    def headers(self):
        return self._wrapper.headers

    def parse(self, *args, **kwargs):
        message = self._wrapper.parse(*args, **kwargs)
        try:
            self._tally.add_usage(getattr(message, "usage", None))
        except Exception:  # noqa: BLE001 — instrumentation must never throw
            pass
        return message

    def __getattr__(self, name):  # delegate unknown attrs to the real wrapper
        return getattr(self._wrapper, name)


class _CreateRecorder:
    """Wraps a create endpoint to pin temperature=0 and tally token usage.

    Harness-only — never touches production code. Injected onto the agent's client
    for the duration of a single run. Because the clause extractor uses the RAW
    endpoint (``with_raw_response.create``), install ONE recorder per endpoint,
    each bound to its OWN real callable and SHARING a ``_UsageTally``:

      * plain slot (``raw=False``) → returns the real ``Message`` and tallies
        ``resp.usage`` directly;
      * raw slot (``raw=True``) → wraps the real raw response in
        ``_RawResponseProxy`` so ``.headers`` / ``.parse()`` still work AND usage
        is tallied on parse.

    Binding a raw-slot recorder to the plain ``create`` (the earlier bug) returns
    a ``Message`` where the extractor expects a raw wrapper → ``AttributeError``.
    """

    def __init__(self, real_create, tally: _UsageTally, *, raw: bool = False):
        self._real = real_create
        self._tally = tally
        self._raw = raw

    def __call__(self, **kwargs):
        kwargs.setdefault("temperature", 0)
        resp = self._real(**kwargs)
        self._tally.calls += 1
        if self._raw:
            return _RawResponseProxy(resp, self._tally)
        self._tally.add_usage(getattr(resp, "usage", None))
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
    tally = _UsageTally()
    # Clause extraction runs the RAW endpoint (rate-limit header gate). Install ONE
    # recorder PER endpoint, each bound to its OWN real callable and sharing the
    # tally. Capture the real callables BEFORE reassigning. The raw recorder must
    # return the real wrapper (via proxy) so the extractor's .headers/.parse() work.
    real_plain = agent._client.messages.create
    real_raw = agent._client.messages.with_raw_response.create
    agent._client.messages.create = _CreateRecorder(real_plain, tally)  # type: ignore[assignment]
    agent._client.messages.with_raw_response.create = _CreateRecorder(  # type: ignore[assignment]
        real_raw, tally, raw=True
    )

    predicted = agent.extract(full_text=source, document_label="General Conditions")

    report: AccuracyReport = score_clause_extraction(predicted, golden, source)
    cost = pricing.estimate_cost_usd(
        agent._model,
        tally.input_tokens,
        tally.output_tokens,
        tally.cache_creation_tokens,
        tally.cache_read_tokens,
    )

    return {
        "model": agent._model,
        "api_calls": tally.calls,
        "input_tokens": tally.input_tokens,
        "output_tokens": tally.output_tokens,
        "cache_creation_tokens": tally.cache_creation_tokens,
        "cache_read_tokens": tally.cache_read_tokens,
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
    print(
        f"cache write/read tok : {result.get('cache_creation_tokens', 0)} / "
        f"{result.get('cache_read_tokens', 0)}  (write 1.25x, read 0.1x)"
    )
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
