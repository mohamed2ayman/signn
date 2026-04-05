"""Obligations Extractor Agent -- extracts actionable obligations from clauses."""

from __future__ import annotations

import json
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings

SYSTEM_PROMPT = """\
You are an expert obligations extraction agent for the SIGN contract management
platform.

Given a set of contract clauses, extract every actionable obligation.  For each
obligation, return a JSON object with these fields:

- clause_id         : the identifier of the source clause
- obligation_type   : one of "payment", "delivery", "reporting", "compliance",
                      or "other"
- responsible_party : the party responsible for fulfilling the obligation
- description       : a clear, concise description of what must be done
- deadline          : the due date or period (string), or null if not specified
- recurrence        : the recurrence pattern (e.g. "monthly", "quarterly",
                      "annually"), or null if it is a one-time obligation

DOCUMENT PRIORITY AWARENESS:
When clauses include document metadata (document_id, document_label,
document_priority), also include these fields per obligation:

- document_id       : the ID of the source document
- document_label    : the label of the source document
- document_priority : the priority number of the source document

Priority 1 = HIGHEST importance. Lower number ALWAYS wins over higher number.

If multiple documents specify CONFLICTING values for the same obligation
(e.g. different deadlines for the same deliverable), use the value from
the document with the LOWEST priority number as the governing obligation,
but mention ALL conflicting values in the description so the user can see
every discrepancy across all documents.

If clauses do not include document metadata, omit these fields.

Return your answer as a JSON array of obligation objects.
Do NOT include any text outside the JSON array.
"""


class ObligationsExtractorAgent:
    """Scans contract clauses and extracts structured obligations."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def extract(self, clauses: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Extract obligations from *clauses*.

        Parameters
        ----------
        clauses:
            Each dict should contain at least ``id`` and ``text`` keys.
            May also include ``document_id``, ``document_label``, and
            ``document_priority`` for priority-aware extraction.

        Returns
        -------
        list[dict[str, Any]]
            A list of obligation dicts matching the ``ObligationItem`` schema.
        """
        has_doc_metadata = any(
            clause.get("document_id") for clause in clauses
        )

        user_content = "Extract all obligations from the following contract clauses:\n\n"

        if has_doc_metadata:
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
                "IMPORTANT: For conflicting deadlines or obligations across "
                "documents, use the value from the document with the LOWEST "
                "priority number (priority 1 always wins). List ALL conflicting "
                "values from all documents in the description.\n\n"
            )
        else:
            for clause in clauses:
                user_content += (
                    f"### Clause {clause.get('id', 'unknown')}\n"
                    f"{clause.get('text', '')}\n\n"
                )

        message = self._client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        obligations: list[dict[str, Any]] = json.loads(raw_text)
        return obligations
