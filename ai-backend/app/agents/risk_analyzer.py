"""Risk Analyzer Agent -- identifies contractual risks in individual clauses."""

from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from app.agents.base_agent import BaseAgent
from app.config.settings import get_settings

logger = logging.getLogger(__name__)

# Issue 5 — small-batch coverage. The analyzer used to send ALL clauses in ONE
# call; the model then surfaced only the ~10-14 most salient risks (~36% clause
# coverage on Project9's 28). Splitting the clause list into small batches makes
# the model assess every clause in each batch (full coverage) at the cost of
# more calls. The batches run CONCURRENTLY (bounded) so total wall-clock stays
# close to the old single call — sequential batches took ~9-12 min for 28
# clauses (each Arabic risk call is ~60-90s) and blew past the backend poll
# window. Both constants are TUNABLE.
RISK_BATCH_SIZE = 4  # clauses per model call
# Concurrent batch calls per contract. The shared, thread-safe Anthropic
# rate-limit gate in BaseAgent._call_model (lesson #193) bounds real load, so
# the platform worst case is (Celery worker concurrency) × this.
RISK_BATCH_CONCURRENCY = 4


def _parse_risk_array(raw: str) -> list[dict[str, Any]]:
    """Parse the model's JSON risk array robustly + truncation-tolerant.

    The model wraps its output in a ```json markdown fence (and may add a
    preamble), which a bare ``json.loads`` chokes on — the historical cause of
    the risk path parsing 0 risks. It can also hit ``max_tokens`` mid-array, so
    the array has no closing ``]``. This mirrors the proven parser shipped in
    ``scripts/risk_prelabel_batch.py``: strip the fence, isolate the outermost
    ``[...]``, and — if that fails — decode complete objects one at a time and
    keep everything before the cutoff. Returns ``[]`` on unparseable prose.
    """
    s = (raw or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```\s*$", "", s).strip()
    a = s.find("[")
    if a == -1:
        return []
    # Fast path: a well-formed complete array (possibly with surrounding prose).
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
            break  # truncated / incomplete object — keep what completed
        if isinstance(obj, dict):
            objs.append(obj)
        i = end
    return objs

# ═══════════════════════════════════════════════════════════════════════════
# ⚠️  PHASE 7.17 PROMPT 1 — A.1 PROMPT UPDATE
#
# DO NOT MERGE TO PRODUCTION WITHOUT AYMAN SIGN-OFF on the Likelihood /
# Impact anchor language below. The anchors were synthesised from PMBOK +
# construction-law literature but have NOT been validated by a domain
# expert. Two acceptable paths until sign-off lands:
#
#   (a) feature-flag this prompt OFF in production (route prod AI traffic
#       to the previous prompt content);
#   (b) keep production pointing at the previous content via a config flag
#       while staging exercises the new prompt.
#
# The cost-percentage banding (1-5%, 5-15%, >15%), schedule-slip
# thresholds (<1 wk, 1-4 wks, 1-3 mo), and Impact=5 example scenarios
# (litigation / criminal exposure / safety incident) all need
# domain-expert review before they shape every L,I value the platform
# ever produces.
#
# This guard exists in the prompt file itself so any PR reviewer sees it
# before approving the merge — do not remove without the sign-off.
# ═══════════════════════════════════════════════════════════════════════════

SYSTEM_PROMPT = """\
You are an expert legal risk analyst for the SIGN contract management platform.

Your task is to analyse the contract clauses provided by the user and identify
potential risks within INDIVIDUAL CLAUSES.

SCOPE EXCLUSION: Do NOT return findings about contradictions or conflicts
between multiple documents. Cross-document conflicts are handled by a
separate analysis pipeline (the conflict-detection agent and the
pollAndSaveConflicts writer on the backend). Focus only on risks within
individual clauses of the current document. If you see what looks like a
cross-document contradiction, ignore it — the conflict pipeline will
catch it.

For every risk you find, return a JSON object with the following fields:

- clause_id      : the identifier of the clause where the risk was found
- risk_category  : the CLOSEST matching canonical category for the risk.
                   Choose ONE from this list (pick the nearest fit — do NOT
                   invent new names):
                   "Payment Terms", "Liability Cap", "Indemnification",
                   "Termination", "Confidentiality", "Intellectual Property",
                   "Compliance", "Contractual" (general contractual / legal
                   risks that fit no more specific label), "Notice Period",
                   "Delay", "Time", "Force Majeure", "Dispute Resolution",
                   "Performance Bond", "Quality", "Warranty", "Defects",
                   "Insurance", "Scope of Work", "Design", "Variations",
                   "Subcontracting". Only return "Uncategorized" if the risk
                   GENUINELY fits none of the above — most risks fit one of
                   these; explain in the description when you use it.
- likelihood     : integer 1-5 with these anchors:
                     1 = Rare           — would require an extraordinary
                                          chain of events
                     2 = Unlikely       — possible but not expected based
                                          on typical project conditions
                     3 = Possible       — could reasonably occur during
                                          the contract lifecycle
                     4 = Likely         — expected to occur given typical
                                          project dynamics
                     5 = Almost Certain — virtually inevitable absent
                                          specific mitigation
- impact         : integer 1-5 with these anchors:
                     1 = Insignificant  — minor inconvenience, no material
                                          consequence
                     2 = Minor          — small cost overrun, schedule slip
                                          under 1 week, or minor
                                          reputational concern
                     3 = Moderate       — meaningful cost (1-5% of contract
                                          value), schedule slip 1-4 weeks,
                                          or operational disruption
                     4 = Major          — significant cost (5-15% of
                                          contract value), schedule slip
                                          1-3 months, reputational damage,
                                          or contractual dispute likely
                     5 = Severe         — catastrophic cost (>15% of
                                          contract value), project failure,
                                          litigation, criminal/regulatory
                                          exposure, or safety incident
- severity       : one of "low", "medium", "high", "critical" — legacy
                   compatibility field. Derive from likelihood × impact
                   using these bands:
                     score = likelihood * impact
                     1-5   → "low"
                     6-14  → "medium"
                     15-20 → "high"
                     21-25 → "critical"
- description    : a clear, concise explanation of the risk written for
                   a business user (not a lawyer)
- suggestion     : a concrete recommendation for mitigating the risk or
                   alternative contract language

The likelihood and impact fields are the PRIMARY values — the platform
uses likelihood × impact to compute a 1-25 risk score that drives every
downstream surface (portfolio dashboards, sorting, drift detection).
Pick values deliberately against the anchor descriptions above; do not
default to 3 / 3 unless that genuinely reflects your assessment.

If additional knowledge context is provided, use it to calibrate your
assessment against the organisation's risk appetite and past precedents.

LANGUAGE — HARD RULE:
- Write the `description` and `suggestion` fields in the SAME LANGUAGE as the
  clause each risk is about. If the clause is in Arabic, that risk's
  `description` and `suggestion` MUST be in Arabic; if the clause is in
  English, they MUST be in English. Never translate the clause's language.
  The clauses below may be in different languages, so decide PER CLAUSE from
  that clause's own text.
- Keep `risk_category` as the canonical English key exactly as listed above —
  it is a fixed label, not prose; do NOT translate it.

Return your answer as a JSON array of risk objects.  Do NOT include any
text outside the JSON array.
"""


class RiskAnalyzerAgent(BaseAgent):
    """Analyses contract clauses and surfaces legal / commercial risks."""

    def __init__(self) -> None:
        super().__init__()
        # Per-stage model override (Step 3 cost work). Empty setting → keep the
        # centralized ANTHROPIC_MODEL (production unchanged). Mirrors the
        # party_extractor pattern; reads via settings, no hardcoded literal.
        _s = get_settings()
        self._model = _s.RISK_ANALYSIS_MODEL or _s.ANTHROPIC_MODEL

    def analyze(
        self,
        clauses: list[dict[str, Any]],
        knowledge_context: str | None = None,
    ) -> list[dict[str, Any]]:
        """Analyse *clauses* in small batches and return the aggregated risks.

        Issue 5 — the clause list is split into batches of ``RISK_BATCH_SIZE``,
        with ONE model call per batch, so the model assesses EVERY clause in the
        batch (full coverage) instead of self-selecting the most salient few
        from a single big call. Results are aggregated in batch order, so each
        risk's ``clause_id`` mapping stays correct. A batch that raises is retried
        once, then logged and skipped (a partial result beats a total failure);
        the skipped batches are surfaced on ``self.failed_batches`` and reported
        in the Celery job result.

        Parameters
        ----------
        clauses:
            Each dict should contain at least ``id`` and ``text`` keys.
        knowledge_context:
            Optional context from the organisation's knowledge base to help
            calibrate risk assessment.
        """
        self.failed_batches: list[dict[str, Any]] = []
        batches = [
            clauses[i : i + RISK_BATCH_SIZE]
            for i in range(0, len(clauses), RISK_BATCH_SIZE)
        ]
        if not batches:
            return []

        # Run batches CONCURRENTLY (bounded), collecting each into its own slot
        # so aggregation preserves batch order regardless of completion order.
        # _analyze_batch_with_retry never raises (it returns [] on failure), so
        # a single bad batch never sinks the run.
        results: list[list[dict[str, Any]]] = [[] for _ in batches]
        with ThreadPoolExecutor(max_workers=RISK_BATCH_CONCURRENCY) as executor:
            future_to_index = {
                executor.submit(
                    self._analyze_batch_with_retry,
                    batch,
                    batch_index,
                    len(batches),
                    knowledge_context,
                ): batch_index
                for batch_index, batch in enumerate(batches)
            }
            for future in future_to_index:
                results[future_to_index[future]] = future.result()

        aggregated: list[dict[str, Any]] = []
        for batch_risks in results:
            aggregated.extend(batch_risks)
        return aggregated

    def _analyze_batch_with_retry(
        self,
        batch: list[dict[str, Any]],
        batch_index: int,
        total_batches: int,
        knowledge_context: str | None,
    ) -> list[dict[str, Any]]:
        """Analyse ONE batch; retry once on any failure, then log + skip it."""
        last_err: Exception | None = None
        for _attempt in (1, 2):  # original try + one retry
            try:
                return self._analyze_batch(
                    batch, batch_index, total_batches, knowledge_context
                )
            except Exception as err:  # noqa: BLE001 — one bad batch must not sink the run
                last_err = err
        clause_ids = [c.get("id") for c in batch]
        logger.warning(
            "Risk batch %d/%d failed after retry (%s) — clauses %s skipped",
            batch_index + 1,
            total_batches,
            last_err,
            clause_ids,
        )
        self.failed_batches.append(
            {
                "batch_index": batch_index,
                "clause_ids": clause_ids,
                "error": str(last_err),
            }
        )
        return []

    def _analyze_batch(
        self,
        batch: list[dict[str, Any]],
        batch_index: int,
        total_batches: int,
        knowledge_context: str | None,
    ) -> list[dict[str, Any]]:
        """One model call for one batch of clauses; parse + return its risks."""
        user_content = self._build_batch_prompt(
            batch, batch_index, total_batches, knowledge_context
        )
        message = self._call_model(
            scrub=True,  # Camp-1: structured-PII scrubbed (Slice 1)
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
            # Prompt caching: the ~1.5k-tok SYSTEM_PROMPT is identical across
            # every batch of a run (batched + concurrent) — cache it so later
            # batches read at 0.1x. Wrap happens AFTER scrub (system has no PII).
            cache_system=True,
        )
        # Robust, fence-/truncation-tolerant parse; the _call_model chokepoint
        # is UNCHANGED — only the parsing of its response text.
        return _parse_risk_array(message.content[0].text)

    @staticmethod
    def _build_batch_prompt(
        batch: list[dict[str, Any]],
        batch_index: int,
        total_batches: int,
        knowledge_context: str | None,
    ) -> str:
        """Build one batch's user prompt — same spirit as the original single
        call, plus an explicit "assess EVERY clause" instruction. The old
        cross-document "compare all documents / detect conflicts" line is
        dropped on purpose: it contradicted the SYSTEM_PROMPT SCOPE EXCLUSION and
        cannot apply within a small batch (cross-document conflicts are a
        separate pipeline)."""
        user_content = (
            f"Analyse the following contract clauses for risks "
            f"(batch {batch_index + 1} of {total_batches}). Assess EVERY clause "
            f"below on its own merits — do not skip any. A clause may yield zero "
            f"risks ONLY if it is genuinely low-risk; do not force a finding, but "
            f"do not omit a clause that carries real risk.\n\n"
        )
        for clause in batch:
            header = f"### Clause {clause.get('id', 'unknown')}"
            doc_label = clause.get("document_label")
            if doc_label:
                header += (
                    f"  (document: {doc_label}, "
                    f"priority: {clause.get('document_priority', 0)})"
                )
            user_content += f"{header}\n{clause.get('text', '')}\n\n"

        if knowledge_context:
            user_content += (
                "### Organisation Knowledge Context\n"
                f"{knowledge_context}\n"
            )

        # Same-language reinforcement (Issue 4): write each risk's
        # description/suggestion in the language of the clause it is about;
        # keep risk_category as the English canonical key.
        user_content += (
            "\nWrite every risk's `description` and `suggestion` in the SAME "
            "language as the clause it refers to (Arabic clause → Arabic; "
            "English clause → English; never translate). Keep `risk_category` "
            "as the English canonical name.\n"
        )
        return user_content
