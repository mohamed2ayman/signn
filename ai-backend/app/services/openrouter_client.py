"""OpenAI-compatible OpenRouter client for the Qwen clause-extraction provider.

This backs the ``ModelProvider.OPENROUTER`` branch of ``BaseAgent._call_model``
(Steps 1-2). It makes ONE OpenAI-style chat-completions call to OpenRouter with the
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

Transient failures (HTTP 429/5xx, or an HTTP-200 body carrying a nested provider
error code) are raised as ``anthropic.APIStatusError`` — the EXACT exception the
extractor's existing retry loop already catches. Step 2 does NOT add a retry loop
(Step 4 adds cost caps / structured logging). Connection / timeout failures raise
``anthropic.APIConnectionError``. The API key is NEVER logged.

Lives in ``app/services/`` (not ``app/agents/``) BY DESIGN: it is a transport
client, not an agent, so the model-centralization guard (which scans
``app/agents/*.py``) does not treat it as one.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# OpenRouter finish_reason → Anthropic stop_reason. Only "max_tokens" is special-
# cased by the extractor (truncation); everything else passes through unchanged.
_FINISH_TO_STOP = {"length": "max_tokens", "stop": "end_turn"}

# Statuses the extractor's retry loop treats as transient (kept here for reference;
# the loop owns the actual retry decision).
_TRANSIENT_STATUSES = frozenset({429, 500, 502, 503, 504, 529})


def _map_finish_reason(finish_reason: str | None) -> str | None:
    """OpenRouter finish_reason → Anthropic stop_reason (pass-through if unmapped)."""
    if finish_reason is None:
        return None
    return _FINISH_TO_STOP.get(finish_reason, finish_reason)


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

    ``usage_cost`` (USD, from OpenRouter's ``usage.cost``) is carried for the Step-4
    cost logging / ceiling; the current extractor caller does not read it yet.
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
    """One OpenAI-compatible OpenRouter call → an Anthropic-raw-shaped adapter."""
    import httpx
    from anthropic import APIConnectionError, APIStatusError

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
        "provider": provider_pin,      # pin provider + quant, NO fallbacks
        "usage": {"include": True},     # OpenRouter usage accounting → usage.cost
    }
    try:
        resp = httpx.post(
            url,
            headers={"Authorization": f"Bearer {api_key}"},  # key NEVER logged
            json=body,
            timeout=timeout,
        )
    except httpx.HTTPError as exc:  # connection / timeout — a transport failure
        request = getattr(exc, "request", None) or httpx.Request("POST", url)
        raise APIConnectionError(request=request) from exc

    # Non-200 HTTP → let the retry loop decide (retry 429/5xx vs raise) off the
    # SDK's exc.status_code, which it derives from the response.
    if resp.status_code != 200:
        raise APIStatusError(
            f"OpenRouter HTTP {resp.status_code}", response=resp, body=resp.text
        )

    data = resp.json()
    # OpenRouter can return HTTP 200 with a NESTED provider error (e.g. an upstream
    # 429). Surface the nested code as a real status via a synthetic response so a
    # nested 429/5xx is treated as transient (retryable), and a malformed 200 (no
    # choices) surfaces terminally rather than IndexError-ing below.
    err = data.get("error")
    if err is not None or "choices" not in data:
        code = err.get("code") if isinstance(err, dict) else None
        status_for_loop = code if isinstance(code, int) else resp.status_code
        synthetic = httpx.Response(
            status_code=status_for_loop, headers=resp.headers, request=resp.request
        )
        detail = json.dumps(err)[:200] if err is not None else "no choices in response"
        raise APIStatusError(
            f"OpenRouter provider error: {detail}", response=synthetic, body=data
        )

    choice = data["choices"][0]
    text = choice["message"].get("content") or ""
    stop_reason = _map_finish_reason(choice.get("finish_reason"))
    usage_cost = float((data.get("usage") or {}).get("cost") or 0.0)
    return OpenRouterRawResponse(
        resp.headers, _OpenRouterMessage(text, stop_reason), usage_cost
    )
