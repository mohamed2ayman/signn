"""Shared base for every Claude agent — the single Anthropic chokepoint.

Consolidates the per-agent ``Anthropic(...)`` client + ``ANTHROPIC_MODEL`` wiring
that all 9 agents previously duplicated, and funnels every ``messages.create``
call through ONE method, ``_call_anthropic``. That method is the seam where:

* (future slice) PII-scrubbing will wrap the outbound request / inbound response, and
* (future migration) the self-hosted-model backend can be swapped in.

TODAY it is a faithful passthrough — the request sent to Anthropic and the value
returned are byte-identical to what each agent sent / received before this
consolidation. No behaviour change.
"""
from __future__ import annotations

from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings


class BaseAgent:
    """Owns the Anthropic client + centralized model id for all agents."""

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

    def _call_anthropic(
        self,
        *,
        system: Any,
        messages: Any,
        max_tokens: int,
        raw: bool = False,
        **kwargs: Any,
    ) -> Any:
        """Single chokepoint for ``client.messages.create(...)``.

        ``raw=False`` (default; 8 agents): returns the parsed ``Message`` —
        identical to ``self._client.messages.create(...)`` before consolidation.

        ``raw=True`` (ClauseExtractorAgent only): returns the raw-response
        wrapper so the caller can read ``.headers`` (its rate-limit gate) BEFORE
        calling ``.parse()`` — identical to
        ``self._client.messages.with_raw_response.create(...)`` before.

        ``model=self._model`` is injected here (the single centralized source).
        No ``temperature`` is added — no agent sends one today, and injecting one
        would change the wire payload. Any extra per-call kwargs pass straight
        through unchanged.
        """
        endpoint = (
            self._client.messages.with_raw_response.create
            if raw
            else self._client.messages.create
        )
        return endpoint(
            model=self._model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            **kwargs,
        )
