"""Summarizer Agent -- produces a structured summary of a full contract."""

from __future__ import annotations

import json
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings

SYSTEM_PROMPT = """\
You are an expert legal document summariser for the SIGN contract management
platform.

Given the full text of a contract, produce a structured summary containing
exactly the following 17 keys.  If a particular element is not present in the
contract, set its value to null.

1.  title                    - The title or name of the agreement.
2.  parties                  - List of parties involved with their roles.
3.  effective_date           - When the contract comes into effect.
4.  expiration_date          - When the contract expires or terminates.
5.  contract_type            - Category (e.g. NDA, SaaS, Employment, etc.).
6.  governing_law            - Applicable law / legal system.
7.  jurisdiction             - Courts or arbitration body with jurisdiction.
8.  purpose                  - High-level purpose of the agreement.
9.  key_terms                - Most important commercial terms.
10. payment_terms            - Payment amounts, schedules, currencies.
11. termination_conditions   - Conditions under which the contract can end.
12. renewal_terms            - Auto-renewal, notice periods, etc.
13. confidentiality          - Confidentiality or NDA provisions.
14. indemnification          - Indemnification clauses.
15. limitation_of_liability  - Liability caps and exclusions.
16. dispute_resolution       - How disputes are resolved.
17. special_provisions       - Any unusual or noteworthy clauses.

Return your answer as a single JSON object with these 17 keys.
Do NOT include any text outside the JSON object.
"""


class SummarizerAgent:
    """Produces a structured 17-element summary of a contract."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def summarize(self, full_text: str) -> dict[str, Any]:
        """Summarise *full_text* and return a dict with 17 key elements.

        Parameters
        ----------
        full_text:
            The complete contract text.

        Returns
        -------
        dict[str, Any]
            A dict whose keys match the 17 summary elements described in the
            system prompt.
        """
        message = self._client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Please summarise the following contract:\n\n"
                        f"{full_text}"
                    ),
                }
            ],
        )

        raw_text = message.content[0].text
        summary: dict[str, Any] = json.loads(raw_text)
        return summary
