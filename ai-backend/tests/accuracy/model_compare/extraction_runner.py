"""Model-adapter seam for the extraction bake-off (Step 5 Phase 0) — SEAM ONLY, NO paid calls.

Defines the ``ExtractionModel`` interface the gold scorer consumes, plus an
``OpenAICompatExtractionModel`` for Together.ai / OpenRouter / Fireworks / Groq / DeepInfra (all
OpenAI-compatible → one adapter; only ``base_url`` + key differ). It reuses the PRODUCTION
``SYSTEM_PROMPT`` and the production chunking so a later run is apples-to-apples with Claude, and it
maps the OpenAI ``finish_reason == "length"`` back to the Anthropic ``max_tokens`` truncation signal
(per docs/step5-extraction-bakeoff-investigation.md §1d/§3 — without that mapping a truncated OSS
response is silently accepted → clause loss).

⚠️ PHASE 0 SAFETY: ``OpenAICompatExtractionModel.extract()`` is HARD-GUARDED — it raises unless
``enabled=True`` AND a real ``api_key`` is present. This phase performs **NO** network calls and
**NO** billing; only the pure request-building / response-parsing / truncation-mapping are exercised
(and unit-tested). Wiring a live run is a later, explicitly-opted-in phase.
"""
from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import Any

# Import-only (constructs nothing): reuse the production prompt + shared JSON salvage.
from app.agents.clause_extractor import SYSTEM_PROMPT
from app.utils.json_salvage import salvage_json_array


class ExtractionModel(ABC):
    """Produces a list of predicted clause dicts from a document's source text.

    The output shape matches the extractor / scorer: each clause a dict with at least
    ``section_number``, ``title``, ``content``, ``clause_type``. The gold scorer
    (``extraction_gold.score_gold_extraction``) consumes exactly this.
    """

    name: str = "base"

    @abstractmethod
    def extract(self, source_text: str, document_label: str | None = None) -> list[dict[str, Any]]:
        ...


def build_user_prefix(contract_type: str | None, document_label: str | None) -> str:
    """Mirror of ``ClauseExtractorAgent._build_user_prefix`` (kept in lock-step so the OSS model
    sees the SAME preamble Claude sees — apples-to-apples)."""
    prefix = ""
    if contract_type:
        prefix += f"Contract type: {contract_type}\n\n"
    if document_label:
        prefix += (
            f"Document label: {document_label}\n"
            "Note: Skip any cover pages, table of contents, or headers "
            "that may remain in the text. Extract only substantive "
            "contract clauses.\n\n"
        )
    return prefix


def parse_clause_array(raw_text: str) -> list[dict[str, Any]]:
    """Fence-/prose-/truncation-tolerant parse → clause list (mirrors ``_parse_json``'s behaviour,
    reusing the shared ``salvage_json_array``). Never raises — returns [] on nothing parseable."""
    cleaned = (raw_text or "").strip()
    if not cleaned:
        return []
    if cleaned.startswith("```"):
        cleaned = "\n".join(
            l for l in cleaned.split("\n") if not l.strip().startswith("```")
        ).strip()
    if cleaned.startswith("["):
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass
    a, b = cleaned.find("["), cleaned.rfind("]")
    if a != -1 and b > a:
        try:
            return json.loads(cleaned[a : b + 1])
        except json.JSONDecodeError:
            pass
    if a != -1:
        return salvage_json_array(cleaned)  # truncated array → keep the complete leading objects
    return []


def is_truncated(finish_reason: str | None) -> bool:
    """OpenAI ``finish_reason == "length"`` == Anthropic ``stop_reason == "max_tokens"`` — a
    truncation the caller MUST detect (else the tail clauses are silently dropped)."""
    return finish_reason == "length"


class OpenAICompatExtractionModel(ExtractionModel):
    """Extraction via an OpenAI-compatible chat-completions endpoint (Together.ai etc.).

    Built now, NOT run now. ``extract()`` is guarded; the request-building
    (``build_payload``), parsing (``parse_clause_array``), and truncation mapping (``is_truncated``)
    are pure and unit-tested without a network.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model_id: str,
        max_output_tokens: int = 16_384,   # clamp to the provider ceiling (e.g. OpenRouter Qwen3)
        request_timeout: float = 120.0,
        enabled: bool = False,             # Phase-0 kill-switch — no paid calls until flipped
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self.model_id = model_id
        self.max_output_tokens = int(max_output_tokens)
        self.request_timeout = request_timeout
        self._enabled = bool(enabled)
        self.name = f"openai-compat:{model_id}"
        # Token usage tallied from each OpenAI-style response (for cost). Never holds the key.
        self.usage = {"prompt_tokens": 0, "completion_tokens": 0, "calls": 0, "truncated_calls": 0}

    # ---- pure, testable (no network) ------------------------------------------------
    def build_payload(
        self,
        chunk_text: str,
        *,
        max_tokens: int,
        contract_type: str | None = None,
        document_label: str | None = None,
    ) -> dict[str, Any]:
        """The OpenAI chat-completions request body — same SYSTEM_PROMPT + preamble Claude gets,
        ``temperature=0`` (harness reproducibility), max_tokens clamped to the provider ceiling."""
        user = build_user_prefix(contract_type, document_label) + chunk_text
        return {
            "model": self.model_id,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
            "max_tokens": min(int(max_tokens), self.max_output_tokens),
            "temperature": 0,
        }

    # ---- guarded, run-time only (NOT reached in Phase 0) ----------------------------
    def _assert_runnable(self) -> None:
        if not self._enabled or not self._api_key:
            raise RuntimeError(
                "OpenAICompatExtractionModel is DISABLED (Phase 0: no paid calls). "
                "Set enabled=True + a real api_key to run a billable extraction."
            )

    def _post_chunk(self, payload: dict[str, Any]) -> tuple[str, str | None]:
        """POST one chunk → (content_text, finish_reason). Lazy httpx import; run-time only."""
        self._assert_runnable()
        import httpx  # lazy — never imported in Phase 0 tests

        resp = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json=payload,
            timeout=self.request_timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        u = data.get("usage") or {}
        self.usage["prompt_tokens"] += int(u.get("prompt_tokens") or 0)
        self.usage["completion_tokens"] += int(u.get("completion_tokens") or 0)
        self.usage["calls"] += 1
        choice = data["choices"][0]
        finish = choice.get("finish_reason")
        if is_truncated(finish):
            self.usage["truncated_calls"] += 1
        return choice["message"]["content"], finish

    def extract(self, source_text: str, document_label: str | None = None) -> list[dict[str, Any]]:
        """Chunk (reusing the PRODUCTION chunking) → post each chunk → parse+merge. GUARDED.

        Reuses ``ClauseExtractorAgent``'s real chunk splitter so the OSS model is fed the exact same
        chunks Claude is. Instantiated lazily and ONLY when enabled — never in Phase 0.
        """
        self._assert_runnable()
        if len(source_text) <= 30_000:
            chunks = [source_text]
        else:
            # Reuse the PRODUCTION chunk splitter (pure text ops, no model call) only when needed.
            from app.agents.clause_extractor import ClauseExtractorAgent
            splitter = ClauseExtractorAgent()
            raw = splitter._split_on_article_boundaries(source_text)
            chunks = splitter._merge_small_chunks(raw)

        out: list[dict[str, Any]] = []
        total = len(chunks)
        for i, chunk in enumerate(chunks, start=1):
            instr = (
                f"CHUNK {i} OF {total}:\nOnly extract clauses that START in this chunk.\n\n"
                if total > 1 else ""
            )
            payload = self.build_payload(
                instr + chunk, max_tokens=self.max_output_tokens, document_label=document_label
            )
            content, finish = self._post_chunk(payload)
            clauses = parse_clause_array(content)
            if is_truncated(finish):
                # A truncated chunk — the tail is lost; a real run would retry with more headroom
                # and/or flag the document (mirrors the extractor's FIX-C). Recorded, not silent.
                clauses = clauses  # keep the salvaged leading clauses
            out.extend(clauses)
        return out


class GoldEchoExtractionModel(ExtractionModel):
    """FREE self-consistency model — 'extracts' by echoing the gold clauses as predictions.

    No network, no billing. Proves the runner→scorer wiring end-to-end. It matches a document by
    ``document_label`` against the gold groups it was given.
    """

    name = "gold-echo"

    def __init__(self, gold_clauses: list[dict[str, Any]]) -> None:
        from tests.accuracy.model_compare.extraction_gold import predicted_from_gold, group_by_document
        self._by_doc = {
            doc: predicted_from_gold(group)
            for (_contract, doc), group in group_by_document(gold_clauses).items()
        }

    def extract(self, source_text: str, document_label: str | None = None) -> list[dict[str, Any]]:
        return list(self._by_doc.get(document_label or "", []))
