"""Feature #7 — party-role PERSPECTIVE validation (v1).

A perspective is a party-role CODE from the party_roles registry (EMPLOYER,
CONTRACTOR, …) used to FRAME risk/compliance analysis from that party's
viewpoint. It must be a CODE, never a company NAME: a code survives the PII
scrubber untouched (structured-PII only today; a future NER pass would mangle a
name), and it is enumerable/stable.

IGNORE-invalid, never reject: a bad viewpoint hint must NEVER fail an analysis
run. An unknown / empty / None value normalizes to None → the agent's
``if perspective:`` guard skips → user_content is byte-identical to the neutral
(no-perspective) path.

The 11 ACTIVE launch codes (migration 1770000000001). The 11 inactive codes
(1776, is_active=FALSE) are intentionally excluded. NOTE (follow-up): this list
mirrors the DB registry; the AUTHORITATIVE validation belongs at the NestJS
boundary against ``party_roles WHERE is_active=true`` once a caller is wired —
this Python set is the v1 defense-in-depth backstop.
"""
from __future__ import annotations

VALID_PERSPECTIVE_ROLES = frozenset(
    {
        "EMPLOYER",
        "CONTRACTOR",
        "ENGINEERING_CONSULTANT",
        "DESIGN_CONSULTANT",
        "COST_CONSULTANT",
        "SUBCONTRACTOR",
        "SUPPLIER",
        "ENGINEER",
        "GRANTOR",
        "BENEFICIARY",
        "OTHER",
    }
)


def normalize_perspective(value: object) -> str | None:
    """Canonical party-role CODE if valid, else None (IGNORE-invalid, no raise)."""
    if not isinstance(value, str):
        return None
    code = value.strip().upper()
    return code if code in VALID_PERSPECTIVE_ROLES else None
