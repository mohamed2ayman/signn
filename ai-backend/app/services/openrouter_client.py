"""OpenAI-compatible OpenRouter client for the Qwen clause-extraction provider.

This backs the ``ModelProvider.OPENROUTER`` branch of ``BaseAgent._call_model``
(Steps 1-4). It makes an OpenAI-style chat-completions call to OpenRouter with the
provider PIN (parasail/fp8, ``allow_fallbacks:false``) and returns an object that
QUACKS like the Anthropic *raw* response, so ``ClauseExtractorAgent
._call_api_with_retry`` consumes it UNCHANGED:

  * ``.parse().content[0].text``  → the model's text.
  * ``.parse().stop_reason``      → OpenRouter ``finish_reason`` mapped to the
    Anthropic vocabulary: ``"length" → "max_tokens"`` (so the extractor's
    truncation salvage + ``clause_extraction_incomplete`` flag still fire) and
    ``"stop" → "end_turn"``. Anything else passes through unchanged.
  * ``.headers``                  → the response headers (the rate-limit gate reads
    ``anthropic-ratelimit-*``, which OpenRouter lacks → a safe no-op).
  * ``.usage_cost``               → USD from OpenRouter's ``usage.cost`` (the
    extractor accumulates it against the per-document ceiling).

RETRY (Step 4) — the client is the SOLE error-retry authority for the OpenRouter
path: a SMALL bounded loop (``_MAX_ATTEMPTS`` = 3) on transient HTTP 429/5xx, an
HTTP-200 body with a nested transient provider code, and connection/timeout errors,
with short Retry-After-aware backoff. The provider PIN is in the body on EVERY
attempt (never falls back to a cheaper endpoint). On exhaustion (or a non-transient
error) it raises ``OpenRouterError`` — which the extractor's existing
``_call_api_with_retry`` loop does NOT catch, so it propagates WITHOUT re-retrying
(no second retry layer stacking on top; mirrors why the SDK's own retries are
pinned off). The API key is NEVER logged; contract text is NEVER logged.
"""
from __future__ import annotations

import json
import logging
import threading
from typing import Any

logger = logging.getLogger(__name__)

# OpenRouter finish_reason → Anthropic stop_reason. Only "max_tokens" is special-
# cased by the extractor (truncation); everything else passes through unchanged.
_FINISH_TO_STOP = {"length": "max_tokens", "stop": "end_turn"}

# Statuses treated as transient (retryable) — HTTP status OR a nested provider code.
_TRANSIENT_STATUSES = frozenset({429, 500, 502, 503, 504, 529})

# Bounded retry: a SMALL fixed number of attempts, short backoff, then a HARD STOP.
_MAX_ATTEMPTS = 3
_BASE_BACKOFF_S = 2.0
_MAX_BACKOFF_S = 16.0


class OpenRouterError(Exception):
    """Hard-stop OpenRouter failure (retries exhausted, or a non-retryable error).

    Deliberately NOT an ``anthropic.APIStatusError`` / ``APIConnectionError`` so the
    extractor's existing retry loop does not catch and re-retry it — the client owns
    the single, bounded OpenRouter retry loop.
    """


class CostCeilingExceeded(Exception):
    """Raised when a single document's cumulative OpenRouter cost blows the ceiling."""

    def __init__(self, spent: float, ceiling: float) -> None:
        self.spent = spent
        self.ceiling = ceiling
        super().__init__(
            f"OpenRouter clause-extraction cost ${spent:.4f} exceeded the "
            f"per-document ceiling ${ceiling:.2f}"
        )


class CostBudget:
    """Thread-safe per-DOCUMENT OpenRouter cost accumulator + ceiling.

    Shared across the parallel chunk threads: ``add`` accumulates each call's
    ``usage.cost``; ``raise_if_exceeded`` is the gate (called before a new chunk
    dispatches, and once more at the end of the document) — a blown budget raises
    ``CostCeilingExceeded``. Because parallel chunks bill concurrently, the overrun
    is bounded to at most the in-flight concurrency before the gate stops further
    dispatch.
    """

    def __init__(self, ceiling_usd: float) -> None:
        self._ceiling = float(ceiling_usd)
        self._spent = 0.0
        self._lock = threading.Lock()

    def add(self, cost_usd: float) -> None:
        with self._lock:
            self._spent += float(cost_usd or 0.0)

    @property
    def spent(self) -> float:
        with self._lock:
            return self._spent

    def raise_if_exceeded(self) -> None:
        with self._lock:
            spent, ceiling = self._spent, self._ceiling
        if spent > ceiling:
            raise CostCeilingExceeded(spent, ceiling)


def _map_finish_reason(finish_reason: str | None) -> str | None:
    """OpenRouter finish_reason → Anthropic stop_reason (pass-through if unmapped)."""
    if finish_reason is None:
        return None
    return _FINISH_TO_STOP.get(finish_reason, finish_reason)


def _backoff_seconds(attempt: int) -> float:
    return min(_BASE_BACKOFF_S * (2 ** (attempt - 1)), _MAX_BACKOFF_S)


def _retry_after_seconds(resp: Any) -> float | None:
    try:
        ra = resp.headers.get("retry-after")
        return float(ra) if ra else None
    except Exception:  # noqa: BLE001 — a malformed header must never break retry
        return None


class _TextBlock:
    """Mimics an Anthropic content block: exposes ``.text``."""

    __slots__ = ("text",)

    def __init__(self, text: str) -> None:
        self.text = text


class _OpenRouterMessage:
    """Mimics an Anthropic ``Message``: ``.content[0].text`` + ``.stop_reason``."""

    __slots__ = ("content", "stop_reason")

    def __init__(self, text: str, stop_reason: str | None) -> None:
        self.content = [_TextBlock(text)]
        self.stop_reason = stop_reason


class OpenRouterRawResponse:
    """Mimics the Anthropic ``with_raw_response`` object: ``.headers`` + ``.parse()``.

    ``usage_cost`` (USD, from OpenRouter's ``usage.cost``) is read by the extractor
    and accumulated against the per-document ceiling.
    """

    __slots__ = ("headers", "usage_cost", "_message")

    def __init__(self, headers: Any, message: _OpenRouterMessage, usage_cost: float) -> None:
        self.headers = headers
        self.usage_cost = usage_cost
        self._message = message

    def parse(self) -> _OpenRouterMessage:
        return self._message


def call_openrouter(
    *,
    system: Any,
    messages: Any,
    max_tokens: int,
    temperature: float,
    api_key: str,
    base_url: str,
    model: str,
    provider_pin: dict,
    timeout: float = 180.0,
) -> OpenRouterRawResponse:
    """One OpenAI-compatible OpenRouter call (bounded-retried) → an adapter response."""
    import time

    import httpx

    if not api_key:
        # A clear, key-free error beats an opaque 401 surfacing downstream.
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set — the 'qwen' clause-extraction provider "
            "cannot run. Set it in ai-backend/.env."
        )

    url = f"{base_url.rstrip('/')}/chat/completions"
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "system", "content": system}, *messages],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "provider": provider_pin,      # pin provider + quant, NO fallbacks — EVERY attempt
        "usage": {"include": True},     # OpenRouter usage accounting → usage.cost
    }

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        # --- transport ---
        try:
            resp = httpx.post(
                url,
                headers={"Authorization": f"Bearer {api_key}"},  # key NEVER logged
                json=body,
                timeout=timeout,
            )
        except httpx.HTTPError as exc:  # connection / timeout — transient
            if attempt < _MAX_ATTEMPTS:
                logger.warning(
                    "openrouter transient connection error (attempt %d/%d): %s",
                    attempt, _MAX_ATTEMPTS, type(exc).__name__,
                )
                time.sleep(_backoff_seconds(attempt))
                continue
            raise OpenRouterError(
                f"connection error after {attempt} attempt(s): {type(exc).__name__}"
            ) from exc

        # --- transient HTTP status → retry ---
        if resp.status_code in _TRANSIENT_STATUSES:
            if attempt < _MAX_ATTEMPTS:
                logger.warning(
                    "openrouter transient HTTP %d (attempt %d/%d) — retrying",
                    resp.status_code, attempt, _MAX_ATTEMPTS,
                )
                time.sleep(_retry_after_seconds(resp) or _backoff_seconds(attempt))
                continue
            raise OpenRouterError(
                f"transient HTTP {resp.status_code} after {attempt} attempt(s)"
            )

        # --- non-transient HTTP failure → hard stop (no retry) ---
        if resp.status_code != 200:
            raise OpenRouterError(
                f"HTTP {resp.status_code} (non-retryable): {resp.text[:160]}"
            )

        data = resp.json()
        # OpenRouter can 200 with a NESTED provider error (e.g. an upstream 429).
        err = data.get("error")
        if err is not None or "choices" not in data:
            code = err.get("code") if isinstance(err, dict) else None
            if isinstance(code, int) and code in _TRANSIENT_STATUSES:
                if attempt < _MAX_ATTEMPTS:
                    logger.warning(
                        "openrouter transient nested code %d (attempt %d/%d) — retrying",
                        code, attempt, _MAX_ATTEMPTS,
                    )
                    time.sleep(_backoff_seconds(attempt))
                    continue
                raise OpenRouterError(
                    f"nested transient provider code {code} after {attempt} attempt(s)"
                )
            detail = json.dumps(err)[:160] if err is not None else "no choices in response"
            raise OpenRouterError(f"provider error (non-retryable): {detail}")

        # --- success ---
        choice = data["choices"][0]
        text = choice["message"].get("content") or ""
        finish = choice.get("finish_reason")
        usage_cost = float((data.get("usage") or {}).get("cost") or 0.0)
        # Structured cost log — greppable, no key, no contract text.
        logger.info(
            "openrouter_clause_call ok cost_usd=%.6f model=%s finish=%s attempt=%d",
            usage_cost, model, finish, attempt,
        )
        return OpenRouterRawResponse(
            resp.headers, _OpenRouterMessage(text, _map_finish_reason(finish)), usage_cost
        )

    # Defensive — the loop always returns or raises above.
    raise OpenRouterError("OpenRouter retry loop exited without a result")
