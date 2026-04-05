"""Risk Analyzer Agent -- identifies contractual risks in individual clauses."""

from __future__ import annotations

import json
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings

SYSTEM_PROMPT = """\
You are an expert legal risk analyst for the SIGN contract management platform.

Your task is to analyse the contract clauses provided by the user and identify
potential risks.  For every risk you find, return a JSON object with the
following fields:

- clause_id   : the identifier of the clause where the risk was found
- risk_type   : a short category label (e.g. "liability", "termination",
                "indemnification", "intellectual_property", "confidentiality",
                "payment", "compliance", "force_majeure", "dispute_resolution",
                "document_conflict")
- severity    : one of "low", "medium", "high", "critical"
- description : a clear, concise explanation of the risk written for a
                business user (not a lawyer)
- suggestion  : a concrete recommendation for mitigating the risk or
                alternative contract language

DOCUMENT PRIORITY & CONFLICT DETECTION:
Priority 1 = HIGHEST importance. Lower number ALWAYS wins over higher number.
There can be any number of documents (2, 3, 5, 10+).

When clauses include document metadata (document_id, document_label,
document_priority), you MUST also check for CROSS-DOCUMENT CONFLICTS:

- If clauses from DIFFERENT documents specify conflicting values
  (e.g. different deadlines, payment terms, liability caps, notice periods),
  flag it as a "document_conflict" risk.
- For each conflict, include these additional fields:
  - document_id           : the document ID of the GOVERNING clause
                            (the one with the LOWEST priority number)
  - document_label        : the label of the governing document
  - conflicting_clause_id : the clause ID from a LOWER-importance document
  - conflicting_document_id    : the document ID of the overridden clause
  - conflicting_document_label : the label of the overridden document
  - governing_value       : the value that takes precedence
  - overridden_value      : the value being overridden
- Set severity based on how significant the discrepancy is.
- In the suggestion, explain which value governs and why, and recommend
  how to resolve the ambiguity (e.g. amend the lower-importance document).

If clauses do NOT include document metadata, perform standard risk analysis
without conflict detection.

If additional knowledge context is provided, use it to calibrate your
assessment against the organisation's risk appetite and past precedents.

Return your answer as a JSON array of risk objects.  Do NOT include any text
outside the JSON array.
"""


class RiskAnalyzerAgent:
    """Analyses contract clauses and surfaces legal / commercial risks."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def analyze(
        self,
        clauses: list[dict[str, Any]],
        knowledge_context: str | None = None,
    ) -> list[dict[str, Any]]:
        """Analyse *clauses* and return a list of identified risks.

        Parameters
        ----------
        clauses:
            Each dict should contain at least ``id`` and ``text`` keys.
        knowledge_context:
            Optional context from the organisation's knowledge base to help
            calibrate risk assessment.

        Returns
        -------
        list[dict[str, Any]]
            A list of risk dicts matching the ``RiskItem`` schema.
        """
        # Check if clauses carry document metadata
        has_doc_metadata = any(
            clause.get("document_id") for clause in clauses
        )

        user_content = "Analyse the following contract clauses for risks:\n\n"

        if has_doc_metadata:
            # Group clauses by document for clarity
            docs: dict[str, list[dict[str, Any]]] = {}
            for clause in clauses:
                doc_key = clause.get("document_id", "unknown")
                docs.setdefault(doc_key, []).append(clause)

            for doc_id, doc_clauses in docs.items():
                label = doc_clauses[0].get("document_label", "Unknown Document")
                priority = doc_clauses[0].get("document_priority", 0)
                user_content += (
                    f"## Document: {label} "
                    f"(ID: {doc_id}, Priority: {priority})\n\n"
                )
                for clause in doc_clauses:
                    user_content += (
                        f"### Clause {clause.get('id', 'unknown')}\n"
                        f"{clause.get('text', '')}\n\n"
                    )

            user_content += (
                "IMPORTANT: Compare clauses across ALL documents above and "
                "detect any conflicts or ambiguities. LOWER priority number "
                "means the document is MORE important (priority 1 always wins).\n\n"
            )
        else:
            for clause in clauses:
                user_content += (
                    f"### Clause {clause.get('id', 'unknown')}\n"
                    f"{clause.get('text', '')}\n\n"
                )

        if knowledge_context:
            user_content += (
                "### Organisation Knowledge Context\n"
                f"{knowledge_context}\n"
            )

        message = self._client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        risks: list[dict[str, Any]] = json.loads(raw_text)
        return risks
