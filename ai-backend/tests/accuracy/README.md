# Arabic Accuracy Suite (Phase 8.1)

A model-agnostic harness that measures **Arabic clause-extraction accuracy** on a
fixed baseline. It is the test tool the Phase 8 migration rule depends on:

> **Never migrate an AI model without first running the Arabic accuracy suite.**
> Migration is gated on Arabic accuracy holding/improving vs the
> `claude-sonnet-4-6` baseline. Cost is recorded for awareness, **not** a gate —
> quality wins. One prompt at a time; embeddings excluded.

This suite establishes the **baseline** for the clause-extraction prompt (the
Arabic-critical path). It does not compare or swap any model — that is Phase
8.4/8.5.

## Layout

| File | What it is |
|---|---|
| `fixtures/general_conditions_ar.txt` | Anonymized 81k-char / 9-chunk General Conditions baseline (the input). |
| `fixtures/general_conditions_ar.meta.json` | Provenance + anonymization summary (no real identifiers). |
| `golden/general_conditions_ar.golden.json` | Structural golden set: 37 articles (section_number + title + clause_type). |
| `scorer.py` | **Pure** scoring logic — no API. Unit-tested. Model-agnostic. |
| `pricing.py` | Token-cost constants (placeholder — verify before quoting $). |
| `run_accuracy.py` | Live runner: real extractor → score → token/cost report (gated). |
| `test_scorer.py` | Scorer unit tests (run in CI — no API). |
| `test_model_centralization.py` | Guards the single-source model id + golden/fixture integrity (CI). |
| `test_accuracy_clause_extraction.py` | The gated live test (skipped unless opted-in). |

## Running

**Unit tests (no API, run in CI automatically):**

```bash
cd ai-backend && pytest tests/accuracy/test_scorer.py tests/accuracy/test_model_centralization.py
```

**Live baseline (calls the paid Anthropic API — ~9 chunked calls):**

```bash
cd ai-backend
RUN_ACCURACY_SUITE=1 ANTHROPIC_API_KEY=... python -m tests.accuracy.run_accuracy
# or as a test:
RUN_ACCURACY_SUITE=1 ANTHROPIC_API_KEY=... pytest tests/accuracy/test_accuracy_clause_extraction.py -s
```

The live path is **never** run in unit CI (real API + cost), per the project rule
that CI is unit-test only. It pins `temperature=0` for reproducibility — only in
the harness; production agents are untouched.

## What is measured (v1)

- **clause count** vs the 37 golden articles
- **boundary precision / recall / F1** on the section-number set
- **missing / spurious / duplicate** articles — duplicates surface the model
  failing to skip the Table of Contents (the fixture repeats مادة 1..37 as a TOC
  at the end; a correct extraction yields 37, not 74)
- **clause_type accuracy** among matched clauses
- **verbatim fidelity** — predicted content is drawn from the source text
  (char-trigram containment), i.e. the model did not paraphrase / hallucinate

## Golden-set design + known limitations

- The golden set is **structural** (number + title + type), derived from the
  document's own in-body article headings. It deliberately stores **no verbatim
  content**, so fidelity is scored against the **source fixture**, not against a
  full golden transcription. Enriching the golden set with per-article verbatim
  spans is a future improvement.
- `clause_type` is a **curated best-effort** label over fuzzy categories; treat
  `type_accuracy` as a soft signal. The objective signals are count / boundary /
  fidelity.
- Anything beyond clause extraction (risk, compliance, chat, summary) is **out of
  scope for v1** — the scorer is built to extend, but those metrics (e.g. an
  LLM-judge rubric for chat) are deferred.

## Adding a new baseline

1. Anonymize the source (consistent placeholders; keep legal structure, public
   law refs, and standards/tool names intact).
2. Save the anonymized text under `fixtures/`.
3. Hand-verify the article structure → `golden/<name>.golden.json`.
4. Never commit the raw document, the raw extracted text, or the
   real→placeholder map.
