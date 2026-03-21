"""Diff Analyzer Agent -- compares two versions of contract clauses."""

from __future__ import annotations

import json
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings

SYSTEM_PROMPT = """\
You are an expert contract diff analyser for the SIGN contract management
platform.

You will receive two sets of clauses: the **original** version and the
**modified** version.  Your job is to:

1. Identify every change between the two versions.
2. Classify each change as "added", "removed", or "modified".
3. Assess the significance of each change as "low", "medium", or "high".
4. Provide a plain-language explanation of what the change means.
5. Produce a high-level narrative summary of all changes combined.

Return your answer as a JSON object with two keys:

- "changes": an array of objects, each with:
    - clause_id       (string)
    - change_type     ("added" | "removed" | "modified")
    - original_text   (string or null)
    - modified_text   (string or null)
    - significance    ("low" | "medium" | "high")
    - explanation     (string)

- "summary": a single string providing an overall narrative summary of the
  differences.

Do NOT include any text outside the JSON object.
"""


class DiffAnalyzerAgent:
    """Compares original and modified contract clauses and reports changes."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def analyze_diff(
        self,
        original_clauses: list[dict[str, Any]],
        modified_clauses: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Compare *original_clauses* with *modified_clauses*.

        Parameters
        ----------
        original_clauses:
            List of clause dicts (with ``id`` and ``text``) for the original
            version.
        modified_clauses:
            List of clause dicts for the modified version.

        Returns
        -------
        dict[str, Any]
            A dict with ``changes`` (list) and ``summary`` (str).
        """
        user_content = "## Original Clauses\n\n"
        for clause in original_clauses:
            user_content += f"### Clause {clause.get('id', 'unknown')}\n{clause.get('text', '')}\n\n"

        user_content += "## Modified Clauses\n\n"
        for clause in modified_clauses:
            user_content += f"### Clause {clause.get('id', 'unknown')}\n{clause.get('text', '')}\n\n"

        message = self._client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        result: dict[str, Any] = json.loads(raw_text)
        return result
