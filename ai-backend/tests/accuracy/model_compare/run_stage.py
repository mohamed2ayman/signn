"""Run ONE stage with ONE model over a payload, capturing tokens + cost.

`run_stage(stage, model, payload, ...)` dispatches to the risk / compliance /
extraction agent, forces `agent._model = model` (the harness override — NO
production change), installs the shared usage recorder, runs, and returns a
`StageResult` with token counts + estimated cost. The SAME entry point serves
Step 3 (risk / compliance) and Step 5 (extraction) — swap `stage` + `model`.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

from tests.accuracy import pricing
from tests.accuracy.run_accuracy import _CreateRecorder, _UsageTally


class _LockedTally(_UsageTally):
    """Thread-safe tally — risk runs its batches CONCURRENTLY, so the recorder's
    counters are touched from multiple threads. run_accuracy's tally is
    single-threaded (extraction driver); here we lock.

    Note: the shared ``_CreateRecorder`` bumps ``self._tally.calls`` UNLOCKED
    (a read-modify-write we can't make atomic from a subclass), so that field
    can undercount under concurrency. We keep our OWN lock-guarded
    ``usage_events`` counter (one per recorded response) and report THAT as the
    call count — tokens/cost already go through the locked ``add_usage`` and are
    unaffected."""

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self.usage_events = 0

    def add_usage(self, usage) -> None:
        with self._lock:
            self.usage_events += 1          # count BEFORE the None-guard in super()
            super().add_usage(usage)


@dataclass
class StageResult:
    stage: str
    model: str
    contract: str
    outputs: Any
    input_tokens: int
    output_tokens: int
    cache_creation_tokens: int
    cache_read_tokens: int
    calls: int
    cost_usd: float


def _install_recorder(agent, tally: _UsageTally) -> None:
    """Wrap BOTH the plain and raw create endpoints so the recorder covers
    risk/compliance (plain) AND extraction (raw, Step 5). Capture the real
    callables BEFORE reassigning."""
    real_plain = agent._client.messages.create
    agent._client.messages.create = _CreateRecorder(real_plain, tally)  # type: ignore[assignment]
    try:
        real_raw = agent._client.messages.with_raw_response.create
        agent._client.messages.with_raw_response.create = _CreateRecorder(  # type: ignore[assignment]
            real_raw, tally, raw=True
        )
    except Exception:  # noqa: BLE001 — some clients may not expose it; plain is enough
        pass


def run_stage(
    stage: str,
    model: str,
    payload: Any,
    *,
    contract: str = "",
    contract_type: str | None = None,
    jurisdiction: str | None = "EG",
    knowledge: Any = None,
) -> StageResult:
    """Run *stage* with *model*.

    payload:
      - risk / compliance → the clause list ({id, text, clause_ref, document_label}).
      - extraction        → the full document text (str).
    knowledge:
      - risk       → optional knowledge_context string.
      - compliance → optional {standard, jurisdiction, playbook} dict.
      For the Step-3 benchmark this is None (empty KB) so both models see the
      SAME context — a fair model-vs-model read (production adds real KB context).
    """
    tally = _LockedTally()

    if stage == "risk":
        from app.agents.risk_analyzer import RiskAnalyzerAgent

        agent = RiskAnalyzerAgent()
        agent._model = model
        _install_recorder(agent, tally)
        outputs = agent.analyze(payload, knowledge if isinstance(knowledge, str) else None)

    elif stage == "compliance":
        from app.agents.compliance_checker import ComplianceCheckerAgent

        k = knowledge if isinstance(knowledge, dict) else {}
        agent = ComplianceCheckerAgent()
        agent._model = model
        _install_recorder(agent, tally)
        outputs = agent.check(
            contract_type=contract_type,
            jurisdiction=jurisdiction,
            clauses=payload,
            standard_knowledge=k.get("standard"),
            jurisdiction_knowledge=k.get("jurisdiction"),
            playbook_knowledge=k.get("playbook"),
        )

    elif stage == "extraction":
        # Step 5 reuse — extraction consumes the full document text.
        from app.agents.clause_extractor import ClauseExtractorAgent

        agent = ClauseExtractorAgent()
        agent._model = model
        _install_recorder(agent, tally)
        outputs = agent.extract(full_text=payload, document_label=contract or None)

    else:
        raise ValueError(f"unknown stage {stage!r} (risk | compliance | extraction)")

    cost = pricing.estimate_cost_usd(
        model,
        tally.input_tokens,
        tally.output_tokens,
        tally.cache_creation_tokens,
        tally.cache_read_tokens,
    )
    return StageResult(
        stage=stage, model=model, contract=contract, outputs=outputs,
        input_tokens=tally.input_tokens, output_tokens=tally.output_tokens,
        cache_creation_tokens=tally.cache_creation_tokens,
        cache_read_tokens=tally.cache_read_tokens,
        calls=tally.usage_events, cost_usd=round(cost, 6),
    )
