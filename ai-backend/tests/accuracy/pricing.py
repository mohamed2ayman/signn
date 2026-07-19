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


# Prompt-caching multipliers on the INPUT rate (Anthropic ephemeral cache):
#   cache write (cache_creation_input_tokens) = 1.25x the input rate,
#   cache read  (cache_read_input_tokens)     = 0.10x the input rate.
# Plain (uncached) input_tokens bill at 1.0x. Output is unaffected by caching.
CACHE_WRITE_MULTIPLIER = 1.25
CACHE_READ_MULTIPLIER = 0.10


def estimate_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    """Return an ESTIMATED USD cost for the given token counts (see module note).

    With prompt caching, Anthropic reports the cached prefix SEPARATELY from
    ``input_tokens`` (which then counts only the uncached remainder). Bill the
    cache-write portion at 1.25x and the cache-read portion at 0.10x the input
    rate so a report stays accurate whether or not caching was active. Callers
    that pass no cache counts (the pre-caching path) get the original result.
    """
    rates = PRICING_USD_PER_MTOK.get(model, _FALLBACK)
    billable_input = (
        input_tokens
        + cache_creation_tokens * CACHE_WRITE_MULTIPLIER
        + cache_read_tokens * CACHE_READ_MULTIPLIER
    )
    return (billable_input / 1_000_000) * rates["input"] + (
        output_tokens / 1_000_000
    ) * rates["output"]
