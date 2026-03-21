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
                "payment", "compliance", "force_majeure", "dispute_resolution")
- severity    : one of "low", "medium", "high", "critical"
- description : a clear, concise explanation of the risk written for a
                business user (not a lawyer)
- suggestion  : a concrete recommendation for mitigating the risk or
                alternative contract language

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
        user_content = "Analyse the following contract clauses for risks:\n\n"
        for clause in clauses:
            user_content += f"### Clause {clause.get('id', 'unknown')}\n{clause.get('text', '')}\n\n"

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
