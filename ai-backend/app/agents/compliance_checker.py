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
from typing import Any

from app.agents.base_agent import BaseAgent


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

        message = self._call_anthropic(
            max_tokens=8192,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        # Strip code-fences just in case
        if raw_text.lstrip().startswith("```"):
            raw_text = raw_text.strip().lstrip("`").lstrip("json").rstrip("`").strip()
        result: dict[str, Any] = json.loads(raw_text)
        # Defensive defaults
        result.setdefault("findings", [])
        result.setdefault(
            "summary",
            {
                "total": len(result.get("findings", [])),
                "by_layer": {},
                "by_severity": {},
                "overall_status": "COMPLIANT",
            },
        )
        return result
