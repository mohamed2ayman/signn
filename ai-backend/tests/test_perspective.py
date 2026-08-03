"""Feature #7 — perspective-aware risk + compliance: the proof gate.

Covers all three landmines + the ignore-invalid rule, for BOTH engines:
  * BYTE-IDENTICAL: perspective=None reproduces today's user_content exactly
    (the perspective block is the SOLE delta; absent when None).
  * CACHING: perspective is NEVER in the cached/system content — even when SET.
  * SET (valid code): the code lands in user_content, in the expected place.
  * INVALID/unknown code: normalized to None → byte-identical neutral path.
  * RE-PLUCK: a valid perspective REACHES each agent's model call.
  * SCRUB: a party-role CODE survives the PII scrubber untouched.
"""
from __future__ import annotations

from app.agents.compliance_checker import SYSTEM_PROMPT as COMPLIANCE_SYSTEM_PROMPT
from app.agents.compliance_checker import ComplianceCheckerAgent
from app.agents.perspective import VALID_PERSPECTIVE_ROLES, normalize_perspective
from app.agents.risk_analyzer import SYSTEM_PROMPT as RISK_SYSTEM_PROMPT
from app.agents.risk_analyzer import RiskAnalyzerAgent

_MOCK_TARGET = "app.agents.base_agent.Anthropic"
_BATCH = [{"id": "c1", "text": "Clause text."}]

# The EXACT block each engine appends for perspective="CONTRACTOR". Removing it
# from the SET output must yield the byte-identical neutral output.
RISK_BLOCK = (
    "### Analysis Perspective\n"
    "Assess these clauses from the perspective of the CONTRACTOR "
    "party — prioritise the risks that most affect that party's "
    "position. Do not omit risks to other parties.\n\n"
)
COMPLIANCE_BLOCK = (
    "## Analysis perspective\n"
    "Evaluate compliance from the perspective of the CONTRACTOR "
    "party — prioritise the findings that most affect that party's "
    "position. Do not omit findings relevant to other parties.\n\n"
)


# ── normalize_perspective (the ignore-invalid rule) ─────────────────────────
def test_normalize_valid_uppercases_and_trims():
    assert normalize_perspective("contractor") == "CONTRACTOR"
    assert normalize_perspective("  Employer ") == "EMPLOYER"
    assert normalize_perspective("CONTRACTOR") == "CONTRACTOR"
    # every active registry code round-trips
    for code in VALID_PERSPECTIVE_ROLES:
        assert normalize_perspective(code) == code


def test_normalize_invalid_none_empty_and_names_return_none():
    assert normalize_perspective(None) is None
    assert normalize_perspective("") is None
    assert normalize_perspective("   ") is None
    assert normalize_perspective("NOT_A_ROLE") is None
    assert normalize_perspective("Orascom Construction") is None  # a NAME → None
    assert normalize_perspective(123) is None  # non-string → None
    # inactive (1776) codes are intentionally NOT valid perspectives
    assert normalize_perspective("LENDER") is None


# ── RISK: byte-identity on the pure staticmethod ────────────────────────────
def test_risk_none_is_byte_identical():
    none_out = RiskAnalyzerAgent._build_batch_prompt(_BATCH, 0, 1, None, None)
    default_out = RiskAnalyzerAgent._build_batch_prompt(_BATCH, 0, 1, None)
    set_out = RiskAnalyzerAgent._build_batch_prompt(_BATCH, 0, 1, None, "CONTRACTOR")
    assert none_out == default_out  # explicit None == default param
    assert "Analysis Perspective" not in none_out  # marker entirely absent
    # BYTE-IDENTICAL: the perspective block is the SOLE difference; removing it
    # from the SET output yields exactly the neutral output.
    assert set_out.replace(RISK_BLOCK, "", 1) == none_out


def test_risk_perspective_set_lands_in_place():
    set_out = RiskAnalyzerAgent._build_batch_prompt(_BATCH, 0, 1, None, "CONTRACTOR")
    assert RISK_BLOCK in set_out
    # after the intro, before the first clause
    assert set_out.index("### Analysis Perspective") < set_out.index("### Clause c1")


# ── RISK: caching + reach + ignore via analyze() with a mocked client ───────
def _run_risk(mocker, perspective):
    mock_cls = mocker.patch(_MOCK_TARGET)
    client = mock_cls.return_value
    msg = mocker.MagicMock()
    msg.content = [mocker.MagicMock(text="[]")]  # valid empty risk array
    msg.stop_reason = "end_turn"
    client.messages.create.return_value = msg
    agent = RiskAnalyzerAgent()
    agent.analyze(clauses=_BATCH, perspective=perspective)
    return client.messages.create.call_args.kwargs


def test_risk_cached_system_never_carries_perspective(mocker):
    # CACHING: risk wraps SYSTEM_PROMPT in a cache_control block; even with
    # perspective SET, the cached text is EXACTLY the raw constant — no leak.
    kw = _run_risk(mocker, "CONTRACTOR")
    system = kw["system"]
    assert isinstance(system, list)  # cache_system=True → wrapped
    assert system[0]["text"] == RISK_SYSTEM_PROMPT
    assert system[0]["cache_control"] == {"type": "ephemeral"}
    assert "CONTRACTOR" not in system[0]["text"]


def test_risk_valid_perspective_reaches_agent(mocker):
    kw = _run_risk(mocker, "CONTRACTOR")
    content = kw["messages"][0]["content"]
    assert "### Analysis Perspective" in content
    assert "CONTRACTOR" in content


def test_risk_invalid_perspective_ignored(mocker):
    kw = _run_risk(mocker, "NOT_A_ROLE")
    assert "Analysis Perspective" not in kw["messages"][0]["content"]


# ── COMPLIANCE: byte-identity + caching + reach + ignore ────────────────────
def _run_compliance(mocker, perspective):
    mock_cls = mocker.patch(_MOCK_TARGET)
    client = mock_cls.return_value
    msg = mocker.MagicMock()
    msg.content = [mocker.MagicMock(text="{}")]  # valid empty object result
    msg.stop_reason = "end_turn"
    client.messages.create.return_value = msg
    agent = ComplianceCheckerAgent()
    agent.check(
        contract_type=None,
        jurisdiction=None,
        clauses=_BATCH,
        perspective=perspective,
    )
    return client.messages.create.call_args.kwargs


def test_compliance_none_is_byte_identical(mocker):
    none_uc = _run_compliance(mocker, None)["messages"][0]["content"]
    set_uc = _run_compliance(mocker, "CONTRACTOR")["messages"][0]["content"]
    assert "Analysis perspective" not in none_uc  # marker entirely absent
    # BYTE-IDENTICAL: block is the SOLE delta.
    assert set_uc.replace(COMPLIANCE_BLOCK, "", 1) == none_uc


def test_compliance_cached_system_never_carries_perspective(mocker):
    # Compliance doesn't cache, but prove perspective is not in `system` either.
    kw = _run_compliance(mocker, "CONTRACTOR")
    assert kw["system"] == COMPLIANCE_SYSTEM_PROMPT  # raw constant, unchanged
    assert "CONTRACTOR" not in kw["system"]


def test_compliance_valid_perspective_reaches_and_places(mocker):
    uc = _run_compliance(mocker, "CONTRACTOR")["messages"][0]["content"]
    assert COMPLIANCE_BLOCK in uc
    assert uc.index("## Analysis perspective") < uc.index("## Contract clauses")


def test_compliance_invalid_perspective_ignored(mocker):
    uc = _run_compliance(mocker, "NOT_A_ROLE")["messages"][0]["content"]
    assert "Analysis perspective" not in uc


# ── SCRUB: a party-role CODE survives the PII scrubber ──────────────────────
def test_perspective_code_survives_the_scrubber():
    from app.services.pii_scrubber import PiiScrubber

    scrubber = PiiScrubber()
    messages = [
        {"role": "user", "content": "Assess from the perspective of the CONTRACTOR party."}
    ]
    scrubbed = scrubber.scrub_messages(messages)
    # A role CODE is not structured PII (email/phone/ID/IBAN) → untouched.
    assert "CONTRACTOR" in scrubbed[0]["content"]
