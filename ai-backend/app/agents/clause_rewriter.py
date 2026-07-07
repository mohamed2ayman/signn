"""Clause Rewriter Agent — re-phrases a clause to reduce/remove a known risk.

Input : the original clause text (+ title) and the identified risk /
        recommendation for it.
Output: a re-phrased clause (title + content) in the SAME language as the
        source clause (Arabic in → Arabic out), plus a short rationale.

This is a Camp-1 analysis operation, so it routes through the single
``BaseAgent._call_model`` chokepoint with ``scrub=True`` (structured PII in the
clause — party names, amounts, IDs — is scrubbed outbound and restored inbound).
It NEVER calls the Anthropic client directly. Response parsing is fence-/
truncation-tolerant (lessons #166 / #200) — a bare ``json.loads`` on the model's
```json-fenced output is exactly the class of bug that shipped 0 results twice.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.agents.base_agent import BaseAgent


def _parse_rewrite_object(raw: str) -> dict[str, Any]:
    """Parse the model's single JSON rewrite object, fence-tolerant.

    Strips a leading ```json fence + preamble, isolates the outermost ``{...}``,
    and falls back to an empty dict on unparseable prose (the caller then raises
    a clear error rather than persisting garbage). Mirrors the proven
    fence-strip pattern in ``risk_analyzer._parse_risk_array``.
    """
    s = (raw or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```\s*$", "", s).strip()
    a = s.find("{")
    b = s.rfind("}")
    if a == -1 or b <= a:
        return {}
    try:
        out = json.loads(s[a : b + 1])
        return out if isinstance(out, dict) else {}
    except (json.JSONDecodeError, ValueError):
        return {}


SYSTEM_PROMPT = """\
You are an expert construction-contract drafter for the SIGN platform.

You are given ONE contract clause plus a description of a RISK it carries and a
recommended mitigation. Re-draft the clause so that the identified risk is
reduced or removed, while preserving the clause's original intent, obligations,
and defined terms wherever they are not the source of the risk.

HARD RULES:
- Respond in the SAME LANGUAGE as the input clause. If the clause is in Arabic,
  the rewritten clause MUST be in Arabic. If English, English. Never translate.
- Keep it a single clause — do not split it into multiple clauses or add
  numbering that was not there.
- Preserve any party roles / defined terms (e.g. "الطرف الأول", "the Contractor")
  exactly as written unless changing them is precisely what the recommendation
  requires.
- Do not invent facts (dates, amounts, names) that are not in the original
  clause. Apply the recommendation faithfully; do not go beyond it.
- Keep the drafting register formal and contractual.

Return ONLY a JSON object (no prose outside it) with exactly these keys:
- rewritten_title   : the clause title (echo the original if it should not change)
- rewritten_content : the full re-phrased clause body
- rationale         : one or two sentences, in ENGLISH, explaining what you
                      changed and how it lowers the risk
"""


class ClauseRewriterAgent(BaseAgent):
    """Re-phrases a single clause to mitigate an identified risk."""

    def rewrite(
        self,
        clause_text: str,
        clause_title: str | None = None,
        risk_description: str | None = None,
        recommendation: str | None = None,
    ) -> dict[str, Any]:
        """Re-phrase *clause_text* to reduce the described risk.

        Returns a dict with ``rewritten_title``, ``rewritten_content`` and
        ``rationale``. Raises ``ValueError`` if the model returns no usable
        rewrite (so the caller surfaces a failure rather than persisting an
        empty proposed clause).
        """
        user_content = "Re-draft the following contract clause.\n\n"
        if clause_title:
            user_content += f"## Original title\n{clause_title}\n\n"
        user_content += f"## Original clause\n{clause_text}\n\n"
        if risk_description:
            user_content += f"## Identified risk\n{risk_description}\n\n"
        if recommendation:
            user_content += f"## Recommended mitigation to apply\n{recommendation}\n\n"
        user_content += (
            "Return the re-phrased clause as the JSON object described in the "
            "system instructions, in the SAME language as the original clause."
        )

        message = self._call_model(
            scrub=True,  # Camp-1: structured-PII scrubbed (Slice 1)
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )

        raw_text = message.content[0].text
        parsed = _parse_rewrite_object(raw_text)
        content = (parsed.get("rewritten_content") or "").strip()
        if not content:
            raise ValueError("clause rewriter returned no rewritten_content")
        return {
            # Echo the original title when the model omits / blanks it.
            "rewritten_title": (parsed.get("rewritten_title") or clause_title or "").strip(),
            "rewritten_content": content,
            "rationale": (parsed.get("rationale") or "").strip(),
        }
