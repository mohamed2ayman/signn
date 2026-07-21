"""Shared JSON-array salvage for truncated / malformed model output.

A model response cut off at ``max_tokens`` is a valid JSON *prefix*: a full
``json.loads`` fails, but every array object before the cut is complete. This
module holds the ONE salvage implementation shared by the clause extractor,
the risk analyzer, and the compliance checker — previously the same loop was
inlined in risk_analyzer (``_parse_risk_array``) and mirrored in
clause_extractor (the FIX C block); a third copy for compliance would have
tripled the drift risk (the lesson #194 family).
"""
from __future__ import annotations

import json
from typing import Any


def salvage_json_array(text: str) -> list[dict[str, Any]]:
    """Salvage the complete leading objects of a (possibly truncated) JSON array.

    Starting at the first ``[`` in ``text``, decode objects one at a time with
    ``json.JSONDecoder.raw_decode`` and keep everything before the first
    incomplete one. Non-dict array items are skipped. Returns ``[]`` when no
    ``[`` is present or nothing parses. Pure — no logging, no side effects;
    callers own their own flagging/telemetry.
    """
    start = text.find("[")
    if start == -1:
        return []
    decoder = json.JSONDecoder()
    i = start + 1
    n = len(text)
    out: list[dict[str, Any]] = []
    while i < n:
        while i < n and text[i] in " \t\r\n,":
            i += 1
        if i >= n or text[i] == "]":
            break
        try:
            obj, end = decoder.raw_decode(text, i)
        except (json.JSONDecodeError, ValueError):
            break  # truncated / incomplete object — keep what completed
        if isinstance(obj, dict):
            out.append(obj)
        i = end
    return out
