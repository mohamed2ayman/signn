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

        Returns
        -------
        list[dict[str, Any]]
            A list of obligation dicts matching the ``ObligationItem`` schema.
        """
        user_content = "Extract all obligations from the following contract clauses:\n\n"
        for clause in clauses:
            user_content += f"### Clause {clause.get('id', 'unknown')}\n{clause.get('text', '')}\n\n"

        message = self._client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        obligations: list[dict[str, Any]] = json.loads(raw_text)
        return obligations
