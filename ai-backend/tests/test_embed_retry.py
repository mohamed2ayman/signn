"""Phase E follow-up — tests for embed_batch_with_retry().

The ingestion task embeds chunks in ~22 sequential OpenAI batch calls.  A single
transient network blip used to fail the whole 70s ingestion.  embed_batch_with_retry
absorbs transient errors (connection/timeout/rate-limit) with bounded exponential
backoff while re-raising deterministic errors (400/401/403/404) immediately.

time.sleep is patched to a no-op so the backoff waits don't slow the suite.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import openai
import pytest

from app.tasks import embed_batch_with_retry, _EMBED_RETRY_BACKOFFS


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _make_client(side_effects):
    """Build a fake OpenAI client whose embeddings.create() follows side_effects.

    side_effects: a list where each element is either an Exception (raised) or a
    return value (returned).
    """
    client = MagicMock()
    client.embeddings.create = MagicMock(side_effect=side_effects)
    return client


def _ok_response(n_vectors: int = 1):
    """A stand-in OpenAI response with .data[i].embedding."""
    resp = MagicMock()
    resp.data = [MagicMock(embedding=[0.1, 0.2, 0.3]) for _ in range(n_vectors)]
    return resp


def _conn_error() -> openai.APIConnectionError:
    return openai.APIConnectionError(request=httpx.Request("POST", "http://ai/embed"))


def _bad_request_error() -> openai.BadRequestError:
    req = httpx.Request("POST", "http://ai/embed")
    resp = httpx.Response(400, request=req)
    return openai.BadRequestError("bad input", response=resp, body=None)


# ─── Tests ───────────────────────────────────────────────────────────────────


def test_retries_transient_then_succeeds(mocker):
    """Two APIConnectionErrors then success → succeeds on the 3rd attempt."""
    sleep = mocker.patch("time.sleep")
    client = _make_client([_conn_error(), _conn_error(), _ok_response(1)])

    result = embed_batch_with_retry(client, ["chunk text"])

    assert result == [[0.1, 0.2, 0.3]]
    assert client.embeddings.create.call_count == 3  # 1 + 2 retries
    assert sleep.call_count == 2  # waited before attempts 2 and 3


def test_deterministic_error_fails_immediately_no_retry(mocker):
    """A BadRequestError (400) must NOT be retried — fails on attempt 1."""
    sleep = mocker.patch("time.sleep")
    client = _make_client([_bad_request_error()])

    with pytest.raises(openai.BadRequestError):
        embed_batch_with_retry(client, ["chunk text"])

    assert client.embeddings.create.call_count == 1  # no retry
    assert sleep.call_count == 0  # no backoff for deterministic errors


def test_exhausts_all_attempts_on_persistent_transient_error(mocker):
    """APIConnectionError on every attempt → raises after the final attempt."""
    sleep = mocker.patch("time.sleep")
    total_attempts = len(_EMBED_RETRY_BACKOFFS) + 1  # 1 immediate + 3 retries = 4
    client = _make_client([_conn_error() for _ in range(total_attempts)])

    with pytest.raises(openai.APIConnectionError):
        embed_batch_with_retry(client, ["chunk text"])

    assert client.embeddings.create.call_count == total_attempts  # 4
    assert sleep.call_count == len(_EMBED_RETRY_BACKOFFS)  # 3 backoff waits
