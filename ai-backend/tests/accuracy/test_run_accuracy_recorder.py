"""CI-safe regression tests for the accuracy-harness recorder (no API/key).

Guards the raw-path bug the adversarial review caught: the recorder must be
installed PER endpoint (plain vs with_raw_response) so the clause extractor's
raw path — which reads ``.headers`` and calls ``.parse()`` on the returned
object — never receives a plain ``Message``. The live accuracy test that would
otherwise exercise this is gated behind RUN_ACCURACY_SUITE=1, so this reproduces
the scenario with a mocked client and asserts (a) no crash and (b) cache-token
usage is tallied on the raw path.
"""
from __future__ import annotations

from app.agents.clause_extractor import ClauseExtractorAgent
from tests.accuracy.run_accuracy import _CreateRecorder, _RawResponseProxy, _UsageTally

_MOCK_TARGET = "app.agents.base_agent.Anthropic"


def _fake_message(text: str, usage=None):
    block = type("B", (), {"text": text})()
    msg = type("M", (), {})()
    msg.content = [block]
    msg.usage = usage
    return msg


def _fake_usage(**kw):
    return type("U", (), kw)()


def test_raw_slot_returns_proxy_exposing_headers_and_parse():
    tally = _UsageTally()
    usage = _fake_usage(
        input_tokens=10, output_tokens=5,
        cache_creation_input_tokens=8000, cache_read_input_tokens=0,
    )
    real_wrapper = type("Raw", (), {})()
    real_wrapper.headers = {"anthropic-ratelimit-requests-remaining": "100"}
    real_wrapper.parse = lambda *a, **k: _fake_message("[]", usage)

    rec = _CreateRecorder(lambda **kw: real_wrapper, tally, raw=True)
    out = rec(system="s", messages=[], max_tokens=1)

    assert isinstance(out, _RawResponseProxy)
    assert out.headers == real_wrapper.headers          # .headers forwarded
    msg = out.parse()                                    # .parse works…
    assert msg.content[0].text == "[]"
    assert tally.calls == 1
    assert tally.cache_creation_tokens == 8000          # …and tallied on parse
    assert tally.input_tokens == 10 and tally.output_tokens == 5


def test_plain_slot_tallies_usage_directly():
    tally = _UsageTally()
    usage = _fake_usage(input_tokens=7, output_tokens=3,
                        cache_creation_input_tokens=0, cache_read_input_tokens=1000)
    rec = _CreateRecorder(lambda **kw: _fake_message("{}", usage), tally, raw=False)
    rec(system="s", messages=[], max_tokens=1)
    assert tally.input_tokens == 7 and tally.cache_read_tokens == 1000


def test_clause_extractor_raw_path_through_recorders_does_not_crash(mocker):
    """Reproduces run_baseline's install pattern: with the FIXED per-endpoint
    recorders the clause extractor's raw path runs end-to-end (no AttributeError)
    and the raw usage — including cache tokens — is tallied."""
    client = mocker.patch(_MOCK_TARGET).return_value
    usage = _fake_usage(
        input_tokens=20, output_tokens=8,
        cache_creation_input_tokens=8039, cache_read_input_tokens=0,
    )
    real_wrapper = type("Raw", (), {})()
    real_wrapper.headers = {}
    real_wrapper.parse = lambda *a, **k: _fake_message("[]", usage)
    client.messages.with_raw_response.create = lambda **kw: real_wrapper

    agent = ClauseExtractorAgent()
    tally = _UsageTally()
    real_plain = agent._client.messages.create
    real_raw = agent._client.messages.with_raw_response.create
    agent._client.messages.create = _CreateRecorder(real_plain, tally)
    agent._client.messages.with_raw_response.create = _CreateRecorder(real_raw, tally, raw=True)

    # Must NOT raise (the bug raised AttributeError on .headers/.parse).
    result = agent.extract(full_text="مادة (1): تعريفات\nنص المادة.", document_label="GC")
    assert result == []                       # parsed "[]" → no clauses
    assert tally.calls >= 1
    assert tally.cache_creation_tokens == 8039   # raw-path cache usage captured
