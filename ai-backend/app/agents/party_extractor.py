"""Party Extractor Agent — regex-fallback for contract-party names.

The NestJS backend extracts contract parties from a document's PREAMBLE window
with a deterministic regex (Arabic classic + English). When that regex yields
fewer than two parties (English preambles, bilingual layouts, OCR-mangled or
otherwise non-standard blocks), it calls this agent as a cheap, bounded fallback
on the SAME preamble window. See docs/parties-extraction-bug-investigation.md.

Design notes:
- Routes through the single ``BaseAgent._call_model`` chokepoint, like every
  agent. It uses a CHEAPER model (``settings.PARTY_EXTRACT_MODEL``, Haiku) than
  the centralized Sonnet — a bounded preamble → two names does not need Sonnet.
  The model id is read from settings (no hardcoded literal — the guard test in
  tests/accuracy/test_model_centralization.py stays green).
- ``scrub=False`` DELIBERATELY: the party names ARE the extraction target, so
  scrubbing them out would defeat the task. This mirrors the ClauseExtractorAgent
  posture (extraction is unscrubbed by design; BAA / zero-retention covers it).
- Response parsing is fence-/truncation-tolerant (lessons #166 / #200) — a bare
  ``json.loads`` on ```json-fenced output is exactly the recurring 0-result bug.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.agents.base_agent import BaseAgent
from app.config.settings import get_settings


def _parse_parties_object(raw: str) -> dict[str, Any]:
    """Parse the model's single JSON object, fence-tolerant. Empty dict on junk."""
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
You extract the TWO contracting parties from the PREAMBLE of a construction
contract. The preamble is the recitals block that names who is entering into the
agreement (Arabic contracts open with "تم الاتفاق بين كل من: … (طرف أول) و …";
English contracts open with "… BETWEEN … (First Party) and … (Second Party)").

Return ONLY a JSON object with exactly these keys:
- first_party  : the FULL legal name of the first party (the party labelled
                 "الطرف الأول" / "First Party" / "of the first part"), or null.
- second_party : the FULL legal name of the second party ("الطرف الثاني" /
                 "Second Party" / "of the second part"), or null.

HARD RULES:
- Return the ENTITY / COMPANY / AUTHORITY name only — NOT the representative
  person, address, title, phone, or role label. Strip trailing "ويمثلها …",
  "ومقرها …", "represented by …", "whose address …".
- Preserve the name in its ORIGINAL language and script (Arabic stays Arabic).
- Do NOT invent a party. If a party is not named in this text, return null for
  it. If neither is named, return null for both.
- Output the JSON object and nothing else.
"""


class PartyExtractorAgent(BaseAgent):
    """Extract {first_party, second_party} from a preamble window (Haiku)."""

    def __init__(self) -> None:
        super().__init__()
        # Use the cheaper party-extraction model, not the centralized Sonnet.
        # Read from settings — no hardcoded model literal (guard-test safe).
        self._model = get_settings().PARTY_EXTRACT_MODEL

    def extract(self, preamble_text: str) -> dict[str, Any]:
        """Return {"first_party": str|None, "second_party": str|None}.

        Never raises for a "no parties found" outcome — returns nulls. Raises
        only on a hard model error (the NestJS caller catches and keeps its
        regex result).
        """
        text = (preamble_text or "").strip()
        if not text:
            return {"first_party": None, "second_party": None}

        message = self._call_model(
            scrub=False,  # parties ARE the target — scrubbing them defeats the task
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Extract the two contracting parties from this preamble:\n\n"
                        f"{text}"
                    ),
                }
            ],
        )

        parsed = _parse_parties_object(message.content[0].text)

        def _clean(v: Any) -> str | None:
            if not isinstance(v, str):
                return None
            s = v.strip()
            return s if s else None

        return {
            "first_party": _clean(parsed.get("first_party")),
            "second_party": _clean(parsed.get("second_party")),
        }
