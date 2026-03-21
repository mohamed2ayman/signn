"""Clause Extractor Agent -- identifies and structures clauses from contract text."""

from __future__ import annotations

import json
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings

SYSTEM_PROMPT = """\
You are an expert contract clause extraction agent for the SIGN construction \
contract management platform.

Your task is to analyse the full text of a contract document and identify every \
distinct clause and sub-clause.  For each clause you find, return a JSON object \
with the following fields:

- title          : a short descriptive title for the clause (e.g. "Definitions \
                   and Interpretation", "Payment Terms", "Force Majeure")
- content        : the EXACT original text of the clause — do NOT paraphrase, \
                   summarise, or modify the text in any way
- clause_type    : categorise the clause as one of: "general", "payment", \
                   "liability", "termination", "indemnification", \
                   "force_majeure", "dispute_resolution", "confidentiality", \
                   "compliance", "insurance", "warranty", "intellectual_property", \
                   "scope_of_work", "variations", "defects", "time", "other"
- section_number : the section/clause number as it appears in the document \
                   (e.g. "1.1", "14.3", "GC-7.2").  If the document is \
                   unstructured and has no numbering, set to null
- confidence     : your confidence that this is a correctly identified and \
                   complete clause, from 0.0 to 1.0

Important guidelines:
1. Preserve the EXACT original text — never paraphrase or rewrite
2. Handle both structured contracts (e.g. FIDIC with numbered clauses) and \
   unstructured contracts (narrative form without numbering)
3. Do not merge separate clauses into one — each clause should be atomic
4. Do not split a single clause into multiple parts unless sub-clauses are \
   clearly distinct
5. Include ALL clauses — do not skip boilerplate, definitions, or schedules
6. For construction contracts, pay special attention to: scope of works, \
   variations, defects liability, time for completion, payment certificates, \
   retention, performance bonds, and dispute resolution

Return your answer as a JSON array of clause objects.  Do NOT include any text \
outside the JSON array.  If the document contains no identifiable clauses, \
return an empty array [].
"""


class ClauseExtractorAgent:
    """Extracts structured clauses from contract document text."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def extract(
        self,
        full_text: str,
        contract_type: str | None = None,
    ) -> list[dict[str, Any]]:
        """Extract clauses from *full_text*.

        Parameters
        ----------
        full_text:
            The complete text content of the contract document.
        contract_type:
            Optional hint about the contract type (e.g. "FIDIC_RED").

        Returns
        -------
        list[dict[str, Any]]
            A list of clause dicts matching the ``ExtractedClauseItem`` schema.
        """
        user_content = ""
        if contract_type:
            user_content += f"Contract type: {contract_type}\n\n"
        user_content += (
            "Extract all clauses from the following contract document:\n\n"
            "---BEGIN DOCUMENT---\n"
            f"{full_text}\n"
            "---END DOCUMENT---"
        )

        message = self._client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8192,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text

        # Handle cases where the response might have markdown fences
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            # Remove markdown code fences
            lines = cleaned.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            cleaned = "\n".join(lines)

        clauses: list[dict[str, Any]] = json.loads(cleaned)
        return clauses
