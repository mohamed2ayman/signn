"""Shared base for every Claude agent — the single model-call chokepoint.

Consolidates the per-agent ``Anthropic(...)`` client + ``ANTHROPIC_MODEL`` wiring
that all 9 agents previously duplicated, and funnels every model call through ONE
method, ``_call_model``. That method is the seam where:

* (Slice 1, shipped) reversible structured-PII scrubbing wraps the outbound
  request / inbound response when a caller opts in with ``scrub=True``, and
* (future migration) additional backends plug in as new ``ModelProvider`` members
  (e.g. self-hosted SageMaker models) — a new provider branch, not a refactor.

TODAY only the Anthropic provider exists. With ``scrub=False`` (the default) it
is a faithful passthrough — the request sent to Anthropic and the value returned
are byte-identical to what each agent sent / received before this consolidation.

PII scrubbing (Slice 1) — opt-in per agent, greppable via ``scrub=True``:
the 8 Camp-1 agents (conversational, risk, compliance, conflict, obligations,
summarizer, diff, research) pass ``scrub=True``; ClauseExtractorAgent does NOT —
extraction stays unscrubbed BY DESIGN (BAA posture, decision D1), and the raw
path rejects ``scrub=True`` loudly. The token→value mapping is a local variable
inside one ``_call_model`` invocation — never logged, never persisted; logs
carry counts-by-type and placeholder NAMES only.
"""
from __future__ import annotations

import logging
from enum import Enum
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings
from app.services.pii_scrubber import PiiScrubber

logger = logging.getLogger(__name__)


class ModelProvider(str, Enum):
    """Backends the chokepoint can route to.

    Anthropic is the only provider today. The model-migration slice adds new
    members here (e.g. ``SAGEMAKER = "sagemaker"``) plus a matching branch in
    ``BaseAgent._call_model`` — agents themselves stay untouched.
    """

    ANTHROPIC = "anthropic"


class BaseAgent:
    """Owns the model client + centralized model id for all agents."""

    def __init__(self, *, max_retries: int | None = None) -> None:
        settings = get_settings()
        # Mirror the per-agent construction exactly. Only ClauseExtractorAgent
        # overrides max_retries (=0 — it owns a Retry-After-aware retry loop, so
        # the SDK's built-in retries must not multiply with it). Every other
        # agent takes the SDK default by NOT passing the kwarg.
        client_kwargs: dict[str, Any] = {"api_key": settings.ANTHROPIC_API_KEY}
        if max_retries is not None:
            client_kwargs["max_retries"] = max_retries
        self._client = Anthropic(**client_kwargs)
        self._model = settings.ANTHROPIC_MODEL

    def _call_model(
        self,
        *,
        provider: ModelProvider = ModelProvider.ANTHROPIC,
        system: Any,
        messages: Any,
        max_tokens: int,
        temperature: float | None = None,
        raw: bool = False,
        scrub: bool = False,
        cache_system: bool = False,
        **kwargs: Any,
    ) -> Any:
        """Single chokepoint for every model call.

        ``provider`` selects the backend; it defaults to Anthropic, and no agent
        passes it today. Non-Anthropic providers raise ``NotImplementedError`` —
        that branch is the deliberate seam the model migration extends.

        On the Anthropic path (all 9 agents today):

        ``raw=False`` (default; 8 agents): returns the parsed ``Message`` —
        identical to ``self._client.messages.create(...)`` before consolidation.

        ``raw=True`` (ClauseExtractorAgent only): returns the raw-response
        wrapper so the caller can read ``.headers`` (its rate-limit gate) BEFORE
        calling ``.parse()`` — identical to
        ``self._client.messages.with_raw_response.create(...)`` before.

        ``scrub=True`` (opt-in; the 8 Camp-1 agents): structured PII (emails,
        EG/SA/UAE/QA phones + national IDs, IBANs — Arabic-Indic digits
        included) is replaced with placeholders in ``system`` + ``messages``
        BEFORE the call, and the real values are restored into the response's
        text content AFTER. The mapping is a local variable of this invocation
        — it dies with the call and is never logged. ``scrub=True`` with
        ``raw=True`` raises ``ValueError``: the only raw caller is the clause
        extractor, and extraction is unscrubbed by design (BAA posture, D1).

        ``cache_system=True`` (opt-in; clause_extractor + risk_analyzer today):
        the (post-scrub) system prompt is sent as an Anthropic prompt-caching
        block — ``[{"type":"text","text":<system>,"cache_control":{"type":
        "ephemeral"}}]`` — so repeated calls with the SAME large system read the
        cached prefix at 0.1x instead of 1x (write once at 1.25x, 5-min TTL). It
        is applied AFTER scrubbing, so the cached bytes match what actually goes
        on the wire. Below the model's minimum cacheable size (1024 tok Sonnet /
        2048 tok Haiku) Anthropic silently ignores the block — no benefit, no
        harm. With ``cache_system=False`` (default) the ``system`` value is passed
        through UNCHANGED (same object) — byte-identical to before.

        ``model=self._model`` is injected here (the single centralized source).
        ``temperature=None`` (the default) is OMITTED from the API call — no
        agent sends one today, and injecting one would change the wire payload;
        it is included only when a caller explicitly sets it. Any extra per-call
        kwargs pass straight through unchanged.
        """
        if provider is ModelProvider.ANTHROPIC:
            if scrub and raw:
                raise ValueError(
                    "scrub not supported on raw path — extraction is "
                    "unscrubbed by design"
                )
            scrubber: PiiScrubber | None = None
            if scrub:
                scrubber = PiiScrubber()
                system = scrubber.scrub_system(system)
                messages = scrubber.scrub_messages(messages)
                if scrubber.has_pii:
                    # Counts by type only — NEVER values (pii_scrubber rule).
                    logger.info(
                        "pii_scrub: scrubbed %s before model call",
                        scrubber.counts_summary(),
                    )
            # Prompt caching (opt-in). Wrap the POST-SCRUB system prompt in an
            # ephemeral cache_control block so the cached bytes equal the wire
            # payload. When off (default), pass `system` through unchanged so the
            # payload is byte-identical to before (same object).
            system_param: Any = system
            if cache_system and isinstance(system, str) and system:
                system_param = [
                    {
                        "type": "text",
                        "text": system,
                        "cache_control": {"type": "ephemeral"},
                    }
                ]
            call_kwargs: dict[str, Any] = dict(
                model=self._model,
                max_tokens=max_tokens,
                system=system_param,
                messages=messages,
                **kwargs,
            )
            if temperature is not None:  # only sent when explicitly set
                call_kwargs["temperature"] = temperature
            endpoint = (
                self._client.messages.with_raw_response.create
                if raw
                else self._client.messages.create
            )
            response = endpoint(**call_kwargs)
            if scrubber is not None and scrubber.has_pii:
                self._restore_pii_in_response(response, scrubber)
            return response
        # Seam for the model migration: new providers add a branch above.
        raise NotImplementedError(f"model provider {provider!r} is not yet wired")

    @staticmethod
    def _restore_pii_in_response(response: Any, scrubber: PiiScrubber) -> None:
        """Restore real PII values into the response's text blocks, in place.

        Agents read ``message.content[i].text`` — that is exactly what gets
        restored. A placeholder surviving restore (e.g. the model mangled or
        invented a token) is a WARNING with placeholder NAMES only, never a
        failure: Camp-1 output is analysis, a survivor is cosmetic, not
        corruption.
        """
        survivors: set[str] = set()
        for block in getattr(response, "content", None) or []:
            text = getattr(block, "text", None)
            if isinstance(text, str):
                restored = scrubber.restore(text)
                block.text = restored
                survivors.update(scrubber.validate_restored(restored))
        if survivors:
            logger.warning(
                "pii_scrub: unrestored placeholders in model response: %s",
                ", ".join(sorted(survivors)),
            )
