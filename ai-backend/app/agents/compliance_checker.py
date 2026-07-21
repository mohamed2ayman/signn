"""Compliance Checker Agent — multi-layer compliance analysis.

This is the brain behind SIGN's compliance monitoring (Phase 3.4). One
Claude call produces findings partitioned across four layers:

  - STANDARD     : compliance with the contract's standard form
                   (FIDIC Red 2017, NEC4, etc.)
  - JURISDICTION : conflicts/gaps against mandatory local law
                   (Egyptian Civil Code, UAE Muqawala, etc.)
  - PLAYBOOK     : deviations from the organisation's preferred positions
  - CONFLICT     : where the contract's governing-law choice creates
                   enforcement risk in the selected jurisdiction
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.base_agent import BaseAgent
from app.config.settings import get_settings
from app.utils.json_salvage import salvage_json_array

logger = logging.getLogger(__name__)

# Truncation fix — mirrors the audited PR #177 extraction pattern, adapted to
# compliance's shape (ONE non-chunked call, OBJECT-wrapped output). max_tokens
# is a CEILING billed per ACTUAL output token — raising it costs nothing when
# the response is short; it only stops finding-dense contracts being cut off.
# FLAT (not input-tiered): compliance output scales with the number of
# findings the model generates, not with verbatim input length.
_MAX_TOKENS = 16_000
# A max_tokens cut-off is an HTTP 200 with stop_reason == 'max_tokens', NOT an
# exception. On truncation we retry ONCE with doubled headroom before salvaging.
_RETRY_MAX_TOKENS = 32_000


SYSTEM_PROMPT = """\
You are SIGN's expert compliance analyst for construction contracts. Your
task is to evaluate a contract against four layers of compliance and return
a structured JSON list of findings.

INPUT YOU RECEIVE
- Contract metadata: contract_type (e.g. FIDIC_RED_BOOK_2017, NEC4_ECC),
  jurisdiction (ISO-2 country code or 'INTL').
- Clauses: array of {id, text, clause_ref?, document_label?, document_priority?}.
- Knowledge context partitioned into three named sections (any may be empty):
  - STANDARD knowledge: required clauses, deviation patterns, mandatory
    provisions of the contract's standard form
  - JURISDICTION knowledge: mandatory local-law provisions, conflict
    guides, dispute resolution norms for the jurisdiction
  - PLAYBOOK knowledge: organisation-specific preferred positions,
    minimum acceptable terms, previously rejected clauses

EVALUATION LAYERS

1. STANDARD layer — for the contract's contract_type:
   - Required clauses missing from the contract → MISSING_CLAUSE
   - Clauses that deviate from the standard form language → DEVIATION
   - Particular Conditions that modify General Conditions in a way that
     creates risk → DEVIATION (severity reflects the risk)

2. JURISDICTION layer — using JURISDICTION knowledge:
   - FIDIC/NEC clauses that conflict with mandatory local law
     → JURISDICTION_OVERRIDE
   - Local law provisions not addressed in the contract → MISSING_CLAUSE
   - Governing-law choice that is unenforceable in the jurisdiction
     → CONFLICT
   - Jurisdiction-specific mandatory requirements absent from contract
     → MISSING_CLAUSE

3. PLAYBOOK layer — using PLAYBOOK knowledge (skip entirely if empty):
   - Clauses deviating from organisation preferred positions
     → PLAYBOOK_DEVIATION
   - Clauses falling short of organisation minimum acceptable terms
     → PLAYBOOK_DEVIATION

4. CONFLICT layer:
   - Cross-document conflicts (when clauses from different documents
     contradict each other) → CONFLICT

OUTPUT SCHEMA

Return a JSON object exactly matching:
{
  "findings": [
    {
      "layer": "STANDARD" | "JURISDICTION" | "PLAYBOOK" | "CONFLICT",
      "clause_ref": "<source clause reference, e.g. '20.2.1'>" | null,
      "finding_type": "MISSING_CLAUSE" | "DEVIATION" | "CONFLICT"
                    | "JURISDICTION_OVERRIDE" | "PLAYBOOK_DEVIATION",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO",
      "requirement": "<what the standard / law / playbook requires>",
      "actual_text": "<excerpt of the contract clause if applicable>" | null,
      "recommendation": "<concrete action the user should take>",
      "knowledge_asset_ref": "<title/id of the knowledge asset that
                              justified this finding>" | null
    }
  ],
  "summary": {
    "total": <int>,
    "by_layer": { "STANDARD": <int>, "JURISDICTION": <int>,
                  "PLAYBOOK": <int>, "CONFLICT": <int> },
    "by_severity": { "CRITICAL": <int>, "HIGH": <int>, "MEDIUM": <int>,
                     "LOW": <int>, "INFO": <int> },
    "overall_status": "COMPLIANT" | "PARTIALLY_COMPLIANT" | "NON_COMPLIANT"
  }
}

OVERALL STATUS RULES
- COMPLIANT: 0 findings of severity CRITICAL or HIGH
- PARTIALLY_COMPLIANT: at least 1 HIGH but no CRITICAL findings
- NON_COMPLIANT: at least 1 CRITICAL finding

SEVERITY GUIDANCE
- CRITICAL: enforcement risk, financial exposure, mandatory law breach,
  fundamental missing protection (e.g. no insurance clause, no governing
  law, mandatory dispute resolution missing)
- HIGH: meaningful deviation that materially shifts risk to one party
- MEDIUM: deviation worth flagging but with limited financial impact
- LOW: minor wording variance
- INFO: observation only, no action required

Return ONLY the JSON object. No prose before or after.
"""


class ComplianceCheckerAgent(BaseAgent):
    """Single-call multi-layer compliance evaluator."""

    def __init__(self) -> None:
        super().__init__()
        # Per-stage model override (Step 3 cost work). Empty setting → keep the
        # centralized ANTHROPIC_MODEL (production unchanged). Mirrors the
        # party_extractor pattern; reads via settings, no hardcoded literal.
        _s = get_settings()
        self._model = _s.COMPLIANCE_MODEL or _s.ANTHROPIC_MODEL

    def check(
        self,
        *,
        contract_type: str | None,
        jurisdiction: str | None,
        clauses: list[dict[str, Any]],
        standard_knowledge: str | None = None,
        jurisdiction_knowledge: str | None = None,
        playbook_knowledge: str | None = None,
    ) -> dict[str, Any]:
        """Run a multi-layer compliance check and return structured findings.

        Returns a dict with keys ``findings`` and ``summary``.
        """
        sections: list[str] = []

        sections.append("## Contract metadata")
        sections.append(f"- contract_type: {contract_type or 'UNKNOWN'}")
        sections.append(f"- jurisdiction: {jurisdiction or 'UNSPECIFIED'}")
        sections.append("")

        sections.append("## Contract clauses")
        for clause in clauses:
            ref = clause.get("clause_ref") or clause.get("id", "unknown")
            label = clause.get("document_label")
            header = f"### Clause {ref}"
            if label:
                header += f"  ({label})"
            sections.append(header)
            sections.append(clause.get("text", "") or "")
            sections.append("")

        if standard_knowledge:
            sections.append("## STANDARD knowledge")
            sections.append(standard_knowledge.strip())
            sections.append("")
        if jurisdiction_knowledge:
            sections.append("## JURISDICTION knowledge")
            sections.append(jurisdiction_knowledge.strip())
            sections.append("")
        if playbook_knowledge:
            sections.append("## PLAYBOOK knowledge")
            sections.append(playbook_knowledge.strip())
            sections.append("")

        user_content = "\n".join(sections)

        message = self._call_model(
            scrub=True,  # Camp-1: structured-PII scrubbed (Slice 1)
            max_tokens=_MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
        truncated = getattr(message, "stop_reason", None) == "max_tokens"
        if truncated:
            # Retry once with doubled headroom. (No raw=True: stop_reason is on
            # the parsed message, and a single non-chunked call needs no
            # rate-limit-header access — do not blind-copy the extractor.)
            logger.warning(
                "Compliance response truncated at max_tokens=%d — retrying "
                "once with max_tokens=%d",
                _MAX_TOKENS,
                _RETRY_MAX_TOKENS,
            )
            message = self._call_model(
                scrub=True,  # Camp-1: structured-PII scrubbed (Slice 1)
                max_tokens=_RETRY_MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_content}],
            )
            truncated = getattr(message, "stop_reason", None) == "max_tokens"
            if truncated:
                logger.warning(
                    "Compliance response STILL truncated at max_tokens=%d — "
                    "salvaging partial findings and flagging the result "
                    "incomplete.",
                    _RETRY_MAX_TOKENS,
                )

        raw_text = message.content[0].text
        return self._parse_result(raw_text, truncated=truncated)

    def _parse_result(
        self, raw_text: str, *, truncated: bool
    ) -> dict[str, Any]:
        """Parse the model's object response; salvage instead of total loss.

        The old bare ``json.loads`` raised on a truncated response → the whole
        check FAILED with zero findings persisted (reasonless, and the user's
        retry burned a fresh metered reservation). Now a truncated/malformed
        response salvages the complete leading findings, recomputes the
        summary, and labels the result ``summary.incomplete = true`` —
        partial + flagged, never total loss. A response with NOTHING
        salvageable still raises: a loud failure beats fabricating an empty
        COMPLIANT result (that WOULD be a silent false-pass).
        """
        cleaned = raw_text
        # Strip code-fences just in case
        if cleaned.lstrip().startswith("```"):
            cleaned = (
                cleaned.strip().lstrip("`").lstrip("json").rstrip("`").strip()
            )
        try:
            result: dict[str, Any] = json.loads(cleaned)
        except json.JSONDecodeError:
            salvaged = self._salvage_findings(cleaned)
            if not salvaged:
                raise
            logger.warning(
                "Recovered %d compliance finding(s) from a truncated/partial "
                "response (the remainder was cut off / malformed).",
                len(salvaged),
            )
            result = {"findings": salvaged}
            truncated = True
        # Defensive defaults
        if not isinstance(result.get("findings"), list):
            result["findings"] = []
        if not isinstance(result.get("summary"), dict):
            result["summary"] = _recompute_summary(result["findings"])
        if truncated:
            # Charge-on-salvage is the decided posture: this result is a
            # SUCCESS (findings persisted, reservation committed) — labeled
            # incomplete so the UI can say so. Rides findings_summary jsonb
            # verbatim through persistFindings; no schema change.
            result["summary"]["incomplete"] = True
        return result

    @staticmethod
    def _salvage_findings(cleaned: str) -> list[dict[str, Any]]:
        """Salvage the inner ``findings`` array from a cut-off object response.

        Compliance output is OBJECT-wrapped (``{"findings": [...], "summary":
        {...}}``), unlike extraction/risk (bare arrays) — so anchor the shared
        array salvage on the ``"findings"`` key when present, else on the
        first ``[``.
        """
        key = cleaned.find('"findings"')
        return salvage_json_array(cleaned[key:] if key != -1 else cleaned)


def _recompute_summary(findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Rebuild the summary block from a (possibly salvaged) findings list.

    Mirrors the SYSTEM_PROMPT's OVERALL STATUS RULES: any CRITICAL →
    NON_COMPLIANT; else any HIGH → PARTIALLY_COMPLIANT; else COMPLIANT.
    """
    by_layer: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    for f in findings:
        layer = str(f.get("layer") or "STANDARD")
        severity = str(f.get("severity") or "MEDIUM")
        by_layer[layer] = by_layer.get(layer, 0) + 1
        by_severity[severity] = by_severity.get(severity, 0) + 1
    if by_severity.get("CRITICAL", 0) > 0:
        overall = "NON_COMPLIANT"
    elif by_severity.get("HIGH", 0) > 0:
        overall = "PARTIALLY_COMPLIANT"
    else:
        overall = "COMPLIANT"
    return {
        "total": len(findings),
        "by_layer": by_layer,
        "by_severity": by_severity,
        "overall_status": overall,
    }
