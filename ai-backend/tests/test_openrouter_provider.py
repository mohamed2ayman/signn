"""Tests for the Qwen/OpenRouter clause-extraction provider (Steps 1-2).

Every HTTP call is MOCKED — no network, no billing. Covers: the request body (pin +
system + temperature 0), the finish_reason→stop_reason adapter, the typed error
raises the extractor's retry loop already catches, the _call_model routing, and the
default (Anthropic) path staying untouched.
"""
import httpx
import pytest
from anthropic import APIConnectionError, APIStatusError

from app.agents.base_agent import BaseAgent, ModelProvider
from app.services.openrouter_client import _map_finish_reason, call_openrouter

PIN = {"order": ["parasail"], "quantizations": ["fp8"], "allow_fallbacks": False}


def _resp(status=200, body=None, headers=None):
    req = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    return httpx.Response(status, json=body, headers=headers or {}, request=req)


def _patch_post(monkeypatch, response=None, capture=None, raise_exc=None):
    def fake_post(url, headers=None, json=None, timeout=None):
        if capture is not None:
            capture.update(url=url, headers=headers, json=json, timeout=timeout)
        if raise_exc is not None:
            raise raise_exc
        return response

    monkeypatch.setattr(httpx, "post", fake_post)


def _ok(content="[]", finish="stop", cost=0.0):
    return _resp(body={
        "choices": [{"message": {"content": content}, "finish_reason": finish}],
        "usage": {"cost": cost},
        "provider": "Parasail",
    })


def _call(api_key="sk-test", **over):
    kw = dict(
        system="SYS-PROMPT", messages=[{"role": "user", "content": "DOC"}],
        max_tokens=28000, temperature=0, api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
        model="qwen/qwen3-235b-a22b-2507", provider_pin=PIN,
    )
    kw.update(over)
    return call_openrouter(**kw)


# ── request body ────────────────────────────────────────────────────────────
def test_request_body_has_pin_system_and_temperature_zero(monkeypatch):
    cap = {}
    _patch_post(monkeypatch, _ok(), capture=cap)
    _call()
    b = cap["json"]
    assert b["provider"] == PIN
    assert b["provider"]["allow_fallbacks"] is False
    assert b["messages"][0] == {"role": "system", "content": "SYS-PROMPT"}
    assert b["messages"][1]["content"] == "DOC"
    assert b["temperature"] == 0
    assert b["model"] == "qwen/qwen3-235b-a22b-2507"
    assert b["max_tokens"] == 28000
    assert b["usage"] == {"include": True}
    # key rides ONLY the Authorization header, never the body
    assert cap["headers"]["Authorization"] == "Bearer sk-test"
    assert "sk-test" not in str(b)


# ── finish_reason → stop_reason adapter ──────────────────────────────────────
def test_finish_reason_length_maps_to_max_tokens(monkeypatch):
    _patch_post(monkeypatch, _ok(content="[partial", finish="length", cost=0.01))
    msg = _call().parse()
    assert msg.content[0].text == "[partial"
    assert msg.stop_reason == "max_tokens"  # length → max_tokens (truncation salvage fires)


def test_finish_reason_stop_maps_to_end_turn(monkeypatch):
    _patch_post(monkeypatch, _ok(finish="stop"))
    assert _call().parse().stop_reason == "end_turn"


def test_map_finish_reason_unit():
    assert _map_finish_reason("length") == "max_tokens"
    assert _map_finish_reason("stop") == "end_turn"
    assert _map_finish_reason("content_filter") == "content_filter"  # pass-through
    assert _map_finish_reason(None) is None


def test_usage_cost_captured(monkeypatch):
    _patch_post(monkeypatch, _ok(cost=0.0123))
    assert _call().usage_cost == pytest.approx(0.0123)


# ── typed errors the retry loop already catches ──────────────────────────────
def test_http_429_raises_apistatuserror(monkeypatch):
    _patch_post(monkeypatch, _resp(status=429, body={"error": "rate limited"}))
    with pytest.raises(APIStatusError) as ei:
        _call()
    assert ei.value.status_code == 429  # loop retries 429/5xx off this


def test_http_500_raises_apistatuserror(monkeypatch):
    _patch_post(monkeypatch, _resp(status=500, body={"error": "server"}))
    with pytest.raises(APIStatusError) as ei:
        _call()
    assert ei.value.status_code == 500


def test_nested_200_error_surfaces_nested_code(monkeypatch):
    # HTTP 200 body carrying an upstream 429 — the exact shape seen in the bake-off.
    _patch_post(monkeypatch, _resp(status=200, body={
        "error": {"message": "Provider returned error", "code": 429}}))
    with pytest.raises(APIStatusError) as ei:
        _call()
    assert ei.value.status_code == 429  # nested code surfaced so the loop can retry


def test_connection_error_raises_apiconnectionerror(monkeypatch):
    boom = httpx.ConnectError("boom", request=httpx.Request("POST", "https://x"))
    _patch_post(monkeypatch, raise_exc=boom)
    with pytest.raises(APIConnectionError):
        _call()


def test_missing_key_raises_clear_error():
    with pytest.raises(RuntimeError) as ei:
        call_openrouter(system="S", messages=[], max_tokens=1, temperature=0,
                        api_key="", base_url="b", model="m", provider_pin=PIN)
    assert "OPENROUTER_API_KEY" in str(ei.value)


# ── _call_model routing ──────────────────────────────────────────────────────
def test_call_model_routes_openrouter_to_client(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "app.services.openrouter_client.call_openrouter",
        lambda **kw: captured.update(kw) or "SENTINEL",
    )
    agent = BaseAgent()
    out = agent._call_model(
        provider=ModelProvider.OPENROUTER, system="S",
        messages=[{"role": "user", "content": "D"}], max_tokens=123,
    )
    assert out == "SENTINEL"
    assert captured["model"] == "qwen/qwen3-235b-a22b-2507"   # from settings
    assert captured["provider_pin"]["allow_fallbacks"] is False
    assert captured["temperature"] == 0   # None → 0
    assert captured["max_tokens"] == 123


def test_call_model_anthropic_default_is_unchanged(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(
        "app.services.openrouter_client.call_openrouter",
        lambda **kw: called.__setitem__("n", called["n"] + 1),
    )
    agent = BaseAgent()
    fake_msg = type("M", (), {"content": [type("B", (), {"text": "ok"})()],
                              "stop_reason": "end_turn"})()
    monkeypatch.setattr(agent._client.messages, "create", lambda **kw: fake_msg)
    out = agent._call_model(system="S", messages=[{"role": "user", "content": "D"}],
                            max_tokens=10)  # provider defaults to ANTHROPIC
    assert out is fake_msg
    assert called["n"] == 0   # OpenRouter is NEVER touched on the default path


def test_scrub_rejected_on_openrouter():
    agent = BaseAgent()
    with pytest.raises(ValueError):
        agent._call_model(provider=ModelProvider.OPENROUTER, system="S",
                          messages=[], max_tokens=1, scrub=True)
