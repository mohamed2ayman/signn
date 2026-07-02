"""Shared base for every Claude agent — the single model-call chokepoint.

Consolidates the per-agent ``Anthropic(...)`` client + ``ANTHROPIC_MODEL`` wiring
that all 9 agents previously duplicated, and funnels every model call through ONE
method, ``_call_model``. That method is the seam where:

* (future slice) PII-scrubbing will wrap the outbound request / inbound response, and
* (future migration) additional backends plug in as new ``ModelProvider`` members
  (e.g. self-hosted SageMaker models) — a new provider branch, not a refactor.

TODAY only the Anthropic provider exists and it is a faithful passthrough — the
request sent to Anthropic and the value returned are byte-identical to what each
agent sent / received before this consolidation. No behaviour change.
"""
from __future__ import annotations

from enum import Enum
from typing import Any

from anthropic import Anthropic

from app.config.settings import get_settings


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

        ``model=self._model`` is injected here (the single centralized source).
        ``temperature=None`` (the default) is OMITTED from the API call — no
        agent sends one today, and injecting one would change the wire payload;
        it is included only when a caller explicitly sets it. Any extra per-call
        kwargs pass straight through unchanged.
        """
        if provider is ModelProvider.ANTHROPIC:
            call_kwargs: dict[str, Any] = dict(
                model=self._model,
                max_tokens=max_tokens,
                system=system,
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
            return endpoint(**call_kwargs)
        # Seam for the model migration: new providers add a branch above.
        raise NotImplementedError(f"model provider {provider!r} is not yet wired")
