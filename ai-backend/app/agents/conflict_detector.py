"""Conflict Detector Agent -- detects cross-document conflicts using document priority."""

from __future__ import annotations

import json
import uuid
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings

SYSTEM_PROMPT = """\
You are an expert contract conflict detection agent for the SIGN platform,
specialised in construction contracts.

You receive clauses from MULTIPLE documents within the same contract, each
tagged with a document_id, document_label, and document_priority.

PRIORITY RULES (CRITICAL):
- Priority 1 = HIGHEST importance (always wins)
- Priority 2 = second most important
- Priority 3 = third most important
- And so on... LOWER number ALWAYS beats HIGHER number.
- There can be ANY number of documents (2, 3, 5, 10, etc.)

Your task is to find CONFLICTS or AMBIGUITIES between clauses from different
documents.  Common conflict types in construction contracts include:

- deadline_conflict    : different time periods for the same obligation
                         (e.g. "report within 5 days" vs "report within 9 days")
- value_conflict       : different monetary amounts, percentages, or quantities
                         for the same item (e.g. retention rate 5% vs 10%)
- scope_conflict       : contradictory scope definitions, responsibilities,
                         or deliverables between documents
- obligation_conflict  : contradictory obligations, duties, or requirements
                         imposed on the same party

HANDLING 3+ DOCUMENTS:
When a conflict exists across 3 or more documents (e.g. Document 1 says
"5 days", Document 3 says "7 days", Document 5 says "9 days"), you MUST:
- Create ONE conflict entry for the group
- document_a is ALWAYS the document with the LOWEST priority number (the winner)
- document_b is the document with the HIGHEST priority number (least important)
- List ALL intermediate conflicting documents and their values in the
  description field
- The governing_value comes from document_a (lowest priority number)
- The overridden_value should list ALL other values from ALL other documents

For EACH conflict found, return a JSON object with these fields:

- conflict_id              : a unique UUID you generate for this conflict
- type                     : one of "deadline_conflict", "value_conflict",
                             "scope_conflict", "obligation_conflict"
- description              : a clear, concise explanation of the conflict
                             written for a construction professional.
                             MUST mention ALL documents involved, not just two.
- document_a               : an object with the WINNING document's details
                             (the one with the LOWEST priority number):
    - id                   : document_id
    - label                : document_label
    - priority             : document_priority
    - clause_text          : the relevant text from this document
    - clause_id            : the clause identifier
- document_b               : an object with the LOWEST-priority document's
                             details (HIGHEST priority number — same structure)
- governing_value          : the value/text that takes precedence
                             (from the document with the LOWEST priority number)
- governing_reason         : a concise explanation of why this value governs
                             (e.g. "Contract Agreement has priority 1 which
                             takes precedence over all other documents")
- overridden_value         : ALL overridden values from ALL other documents,
                             comma-separated if multiple
                             (e.g. "7 days (General Conditions, priority 3),
                             9 days (Appendix, priority 5)")
- severity                 : one of "low", "medium", "high" based on the
                             potential impact of the conflict
- suggestion               : a concrete recommendation on how to resolve the
                             conflict (e.g. "Amend General Conditions clause
                             4.2 and Appendix clause 2.1 to align with the
                             Contract Agreement's 5-day reporting requirement")

Return a JSON object with two keys:
{
  "conflicts": [ ... array of conflict objects ... ],
  "summary": {
    "total": <number>,
    "by_severity": { "high": <n>, "medium": <n>, "low": <n> },
    "by_type": { "deadline_conflict": <n>, "value_conflict": <n>,
                 "scope_conflict": <n>, "obligation_conflict": <n> }
  }
}

If there are NO conflicts, return:
{ "conflicts": [], "summary": { "total": 0, "by_severity": {}, "by_type": {} } }

Do NOT include any text outside the JSON object.
"""


class ConflictDetectorAgent:
    """Detects conflicts between clauses from different documents
    using document priority to determine governing values."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def detect(self, clauses: list[dict[str, Any]]) -> dict[str, Any]:
        """Detect conflicts across clauses from multiple documents.

        Parameters
        ----------
        clauses:
            Each dict must contain ``id``, ``text``, ``document_id``,
            ``document_label``, and ``document_priority``.

        Returns
        -------
        dict[str, Any]
            A dict with ``conflicts`` list and ``summary`` object.
        """
        # Group clauses by document
        docs: dict[str, list[dict[str, Any]]] = {}
        for clause in clauses:
            doc_key = clause.get("document_id", "unknown")
            docs.setdefault(doc_key, []).append(clause)

        # Sort document groups by priority ASCENDING (priority 1 = most important first)
        sorted_docs = sorted(
            docs.items(),
            key=lambda item: item[1][0].get("document_priority", 0),
            reverse=False,
        )

        user_content = (
            "Analyse the following contract documents for conflicts "
            "and ambiguities between them.\n\n"
        )

        for doc_id, doc_clauses in sorted_docs:
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
            "Compare ALL clauses across ALL documents above. "
            "Identify every conflict or ambiguity where documents "
            "specify different values, deadlines, amounts, scopes, or "
            "obligations for the same matter.\n\n"
            "REMEMBER: Lower priority number = MORE important. "
            "Priority 1 ALWAYS wins over priority 2, 3, 4, etc. "
            "If 3+ documents conflict, group them into ONE conflict entry "
            "and list ALL conflicting values.\n"
        )

        message = self._client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8192,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        result: dict[str, Any] = json.loads(raw_text)
        return result
