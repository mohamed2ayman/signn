"""Token pricing for cost instrumentation (Phase 8.1).

Cost is captured for AWARENESS — per the Phase 8.1 migration rule, cost is NOT a
hard gate; quality (Arabic accuracy) is the deciding factor. These numbers are
recorded so a future open-source comparison (8.4/8.5) has a Claude baseline.

⚠️ VERIFY before quoting: model prices change. Confirm the current USD-per-
million-token rates for the active model at https://www.anthropic.com/pricing
and update the table below. The values here are placeholders for the harness to
run end-to-end; treat any reported $ figure as an ESTIMATE until verified.
"""
from __future__ import annotations

# USD per 1,000,000 tokens. PLACEHOLDER — verify against current pricing.
PRICING_USD_PER_MTOK: dict[str, dict[str, float]] = {
    "claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
}

# Used when the active model id is not in the table above.
_FALLBACK = {"input": 3.00, "output": 15.00}


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return an ESTIMATED USD cost for the given token counts (see module note)."""
    rates = PRICING_USD_PER_MTOK.get(model, _FALLBACK)
    return (input_tokens / 1_000_000) * rates["input"] + (
        output_tokens / 1_000_000
    ) * rates["output"]
