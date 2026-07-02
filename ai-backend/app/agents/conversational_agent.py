"""Conversational Agent -- interactive Q&A about contracts with citations."""

from __future__ import annotations

import json
import re
from typing import Any

from app.agents.base_agent import BaseAgent

SYSTEM_PROMPT = """\
You are an expert legal assistant for the SIGN contract management platform.
You help users understand their contracts through natural conversation.

Guidelines:
- Answer questions accurately based on the contract context provided.
- When referencing specific parts of the contract, include citations.
- If a question cannot be answered from the available context, say so clearly.
- Keep your tone professional but accessible -- avoid unnecessary legal jargon.
- When unsure, express uncertainty rather than guessing.
- When legal passages are provided inside a <legal_context> block, ground your
  answer in them and cite the specific article by number when relevant
  (e.g., "per Article 217 of the Egyptian Civil Code"). If the provided
  passages do not address the question, answer from general knowledge and note
  that the corpus did not contain a specific reference. Do not force a citation
  when none of the passages are on point.

You MUST structure your response as a JSON object with two keys:

- "response"  : your answer as a string (may include markdown formatting)
- "citations" : an array of citation objects, each with:
    - clause_id  (string or null) : the clause ID referenced
    - text       (string)         : the exact text excerpt cited
    - source     (string)         : a label like "Clause 3.1" or the document
                                    section name

Do NOT include any text outside the JSON object.
"""


class ConversationalAgent(BaseAgent):
    """Interactive chat agent that answers questions about contracts."""

    def chat(
        self,
        message: str,
        contract_context: str | None = None,
        knowledge_context: str | None = None,
        history: list[dict[str, str]] | None = None,
        system_context: str | None = None,
    ) -> dict[str, Any]:
        """Send a conversational message and receive a response with citations.

        Parameters
        ----------
        message:
            The current user message.
        contract_context:
            The contract text or relevant excerpt for grounding answers.
        knowledge_context:
            Additional organisational knowledge base context.
        history:
            Previous conversation turns as ``{"role": ..., "content": ...}``
            dicts.
        system_context:
            Caller-supplied ambient context (e.g. a clause selected in Word).
            Appended to the system prompt rather than injected as a user
            message so the model treats it as background, not as the question.

        Returns
        -------
        dict[str, Any]
            A dict with ``response`` (str) and ``citations`` (list).
        """
        # Build the messages array from history + current message
        messages: list[dict[str, str]] = []

        if history:
            for entry in history:
                messages.append({
                    "role": entry["role"],
                    "content": entry["content"],
                })

        # Compose the current user message with context
        user_content_parts: list[str] = []

        if contract_context:
            user_content_parts.append(
                f"### Contract Context\n{contract_context}\n"
            )
        if knowledge_context:
            user_content_parts.append(
                f"### Knowledge Base Context\n{knowledge_context}\n"
            )
        user_content_parts.append(f"### User Question\n{message}")

        messages.append({
            "role": "user",
            "content": "\n".join(user_content_parts),
        })

        system_prompt = SYSTEM_PROMPT
        if system_context:
            system_prompt = (
                f"{SYSTEM_PROMPT}\n\n"
                f"### Ambient Context (caller-supplied)\n"
                f"The user is currently focused on the following text. Treat it "
                f"as background context for any question they ask, even if the "
                f"question is general:\n\n{system_context}"
            )

        response = self._call_model(
            max_tokens=4096,
            system=system_prompt,
            messages=messages,
        )

        raw_text = response.content[0].text
        return self._parse_response(raw_text)

    @staticmethod
    def _parse_response(raw_text: str) -> dict[str, Any]:
        """Parse the model's reply into {response, citations}, resiliently.

        The SYSTEM_PROMPT asks for strict JSON, but models frequently wrap it in
        a ```json ... ``` markdown fence (especially once a large legal_context
        block is present) or answer in prose. Naive json.loads then throws and
        the whole chat turn fails. Strip fences, try JSON, and fall back to
        treating the raw text as the response with no citations — chat must
        always return a usable answer.
        """
        text = raw_text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\s*\n?", "", text)
            text = re.sub(r"\n?```\s*$", "", text).strip()
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict) and "response" in parsed:
                parsed.setdefault("citations", [])
                return parsed
        except (json.JSONDecodeError, ValueError):
            pass
        # Prose (or non-conforming JSON) → wrap as the response.
        return {"response": raw_text.strip(), "citations": []}
