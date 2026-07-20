"""Model-comparison harness (cost-optimization Step 3).

Runs a stage (risk / compliance) with a chosen model over a subset of the
Phase 8.3 gold contracts, capturing per-run tokens + cost, and scores risk
output against the HUMAN-VERIFIED gold (never raw AI pre-labels — lesson #244).
Designed to also drive Step 5's extraction bake-off (swap stage + model).

Data locality: the real gold text is NOT vendored into the repo — `gold_loader`
reads it from a runtime directory (``GOLD_DIR`` env / explicit path). Unit tests
use a tiny SYNTHETIC fixture, never real contract content.
"""
