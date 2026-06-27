# Phase 8.1 — AI Model Evaluation & Migration Path — Investigation Findings

> **Status:** Investigation only (read-only). No code, no tests, no branch.
> **Scope:** 8.1 ONLY — (1) prompt inventory, (2) Arabic accuracy test suite design,
> (3) per-prompt OSS replacement candidates, (4) scope/change map, (5) decisions.
> **Explicitly out of scope:** 8.2 (OCR/Textract), 8.3 (Label Studio), 8.4/8.5
> (fine-tuning + actually comparing/swapping models), 8.6 (SageMaker). 8.1 builds the
> inventory + the test tool + the written rule. It does NOT compare, swap, or migrate any model.
> **Author:** Ayman | **Date:** 2026-06-22

---

## 0. Executive summary (grounded in repo code)

- **Every Claude call lives in `ai-backend/app/agents/`.** There are **9 Claude agents**, each
  invoked **asynchronously** through a Celery task (`ai-backend/app/tasks.py`) dispatched from the
  NestJS `AiService` (`backend/src/modules/ai/ai.service.ts`) via HTTP `POST /agents/*` →
  `{ job_id, status }` → frontend polls `GET /agents/jobs/:id`. This matches **Architecture Rule 2
  (Async AI — no synchronous AI calls)**.
- **The model string `claude-sonnet-4-6` is hardcoded in 9 separate places.** There is **no central
  model config and no `ANTHROPIC_MODEL` env var** — `ai-backend/app/config/settings.py` exposes only
  `ANTHROPIC_API_KEY`.
- **Each prompt's text is an inline module-level `SYSTEM_PROMPT = """..."""` constant** in its agent
  file — not a template engine, not config, not DB.
- **The NestJS backend has NO Anthropic SDK** (`grep -i anthropic backend/package.json` → none).
  Confirms backend never calls Claude directly.
- **There is NO committed "General Conditions" (81k chars / 9 chunks) fixture** anywhere in the repo.
  The 81k doc is referenced in prompts, lessons (#5, #18), and `NEXT_PHASES.md` as a *real-world test
  document used during clause-extraction debugging* — it is not checked in. The only Arabic document
  in-repo is `docs/law-131-1948.pdf` (Egyptian Civil Code, used for the Phase 7.27 legal corpus). The
  other `.docx` files are English legal-policy documents. **→ The Arabic accuracy baseline and its
  golden set do not exist yet; building them is the bulk of 8.1's real work.**
- **Only `clause_extractor` chunks input and only `clause_extractor` retries** the API. The other 8
  agents make a single `messages.create(...)` call with no retry (failures bubble to the Celery
  task's `except` → `{status: "failed"}`).
- **No agent sets `temperature`** → outputs are non-deterministic, which matters for a scoring harness.
- **Embeddings are OpenAI `text-embedding-3-small`, not Claude** (KB + legal corpus). Adjacent to the
  inventory but a separate, locked decision (re-embedding migration required to change) — see §5 D8.

---

## 1. Prompt inventory (from real code)

All 9 prompts: model = `claude-sonnet-4-6`; client = `Anthropic(api_key=settings.ANTHROPIC_API_KEY)`
constructed in each agent's `__init__`; prompt text = inline `SYSTEM_PROMPT` module constant; sync/async
= **async (Celery)**; dispatched from `backend/src/modules/ai/ai.service.ts`.

| # | Agent file (`ai-backend/app/agents/`) | Celery task (`tasks.py`) | FastAPI route | What the prompt does | `max_tokens` | Input shape | Chunking | Retry | Arabic-sensitivity |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `clause_extractor.py` (`extract`, API call L569) | `run_extract_clauses` (L171, soft 1800s/hard 2400s) | `/agents/extract-clauses` | Extract every clause as structured JSON (title, content verbatim, clause_type, section_number, confidence) | **Tiered**: 16k (<10k chars) / 24k (<20k) / 32k (≥20k) — `_calculate_max_tokens` L540 | `full_text` (whole document) | **YES** — ≤30k chars single call; >30k split on مادة/البند/Article boundaries into ≤15k chunks (`_split_on_article_boundaries`) | **YES** — 4 attempts, 30/60/120s backoff on 429/5xx/529 (`_call_api_with_retry` L558) | **CRITICAL** — Arabic clause-boundary detection, RTL, definitions formatting; the canonical Arabic path |
| 2 | `risk_analyzer.py` (`analyze` L121, call L187) | `run_risk_analysis` (L33) | `/agents/risk-analysis` | PMBOK 5×5 risk scoring (Likelihood × Impact) per clause + knowledge-grounded rationale | 4096 | `clauses[]` + optional `knowledge_context` (string) | no | no | **HIGH** — reasons over Arabic clause text |
| 3 | `compliance_checker.py` (`check` L122, call L169) | `run_compliance_check` (L188) | `/agents/compliance-check` | Multi-layer compliance findings vs standard/jurisdiction/playbook knowledge | 8192 | `clauses[]` + 3 knowledge buckets (`standard_/jurisdiction_/playbook_knowledge`), joined into one user message | no | no | **HIGH** + legal — Arabic clauses + MENA law |
| 4 | `conflict_detector.py` (`detect` L109, call L166) | `run_conflict_detection` (L91) | `/agents/detect-conflicts` | Detect conflicts between clauses across documents (priority-aware) | 8192 | `clauses[]` (with document_label/priority) | no | no | **HIGH** — cross-document Arabic reasoning |
| 5 | `obligations_extractor.py` (`extract` L58, call L112) | `run_extract_obligations` (L78) | `/agents/extract-obligations` | Extract obligations (party, type, timeframe, amount, criticality) from clauses | 4096 | `clauses[]` | no | no | **HIGH** — structured extraction from Arabic |
| 6 | `summarizer.py` (`summarize` L50, call L65) | `run_summarize` (L49) | `/agents/summarize` | 17-element structured contract summary | 4096 | `full_text` injected **directly** into the user message — **NO chunking** (latent risk for very large docs) | no | no | **MEDIUM** — abstractive summary tolerates more |
| 7 | `diff_analyzer.py` (`analyze_diff` L49, call L78) | `run_diff_analysis` (L62) | `/agents/diff` | Analyze differences between two clause sets (version diff) | 4096 | `original_clauses[]` + `modified_clauses[]` | no | no | **MEDIUM** |
| 8 | `conversational_agent.py` (`chat` L50, call L119) | `run_chat` (L104) | `/agents/chat` | AI assistant Q&A with citations; grounds on `<legal_context>` block (Phase 7.27); strict-JSON with fence-strip + prose fallback (`_parse_response` L129) | 4096 | `message` + optional `contract_context` + `knowledge_context` + `history[]` + `system_context` | no | no | **HIGH** — Arabic legal Q&A; cites Civil Code articles |
| 9 | `research_agent.py` (`research` L45, call L74) | `run_research` (L123) | `/agents/research` | Discover legal assets by keywords + jurisdiction | 4096 | `keywords[]` + optional `jurisdiction` (short input) | no | no | **LOW** — mostly English keywords |

**Non-Claude AI calls (adjacent, listed for completeness — NOT Claude prompts):**

| Site | Model | Sync/async | Purpose |
|---|---|---|---|
| `tasks.py` `run_embed_legal_chunks` (L244) + `run_ingest_legal_document` (L345) | OpenAI `text-embedding-3-small` | async (Celery) | Legal corpus chunk embeddings (psycopg2 → pgvector) |
| `ai-backend/app/services/embedding_service.py` (L37); `routers/agents.py` `embed-query` (L350) | OpenAI `text-embedding-3-small` | **synchronous** (the one sync AI call; `ai.service.ts` `embedQuery` L290) | KB ingest + legal retrieval query embedding |
| `run_extract_text` → `text_extractor_factory` | Tesseract OCR (Phase 9.1c, `OCR_PROVIDER`/`TEXT_EXTRACTOR` abstraction already exists) | async (Celery) | PDF/scan text extraction — **this is 8.2's territory, out of 8.1 scope** |

---

## 2. Arabic accuracy baseline

### Where the baseline doc actually is
- **Not in the repo.** No fixture matches "General Conditions / 81k / 9 chunks." The phrase appears only
  in prompt text, comments, and `lessons.md` (#5: large-doc chunking; #18: Celery time-limit). It is a
  developer's real-world test document.
- In-repo Arabic material that *could* seed a baseline: `docs/law-131-1948.pdf` (Egyptian Civil Code —
  already used and verified GREEN in Phase 7.27, 1107 chunks / 980 articles). This is **legal-corpus**
  data (retrieval), not a **clause-extraction** golden set, but it is a committed, license-clean Arabic
  source we control.

### How chunking works today (so the harness mirrors production)
- Clause extraction: `len(full_text) <= 30_000` → single call; else `_split_on_article_boundaries`
  (cut at مادة/البند/Article starts, ≤15k chars, oversized articles sub-split at N-M/N/M then `\n\n`
  with 200-char overlap, tiny <500-char chunks merged, mid-article chunks get prev heading prepended).
  The "9 chunks" figure for the 81k doc is the output of exactly this path.

### Recommended shape of the Arabic accuracy test suite (8.1 deliverable, design-only here)
The suite is a **model-agnostic evaluation harness** that runs a prompt against a fixed input and scores
the output against a hand-verified golden set. v1 should focus on **clause extraction** (the
Arabic-critical, most-measurable path), with hooks to extend to other prompts later.

- **What to measure (v1, clause extraction):**
  - **Clause-boundary recall/precision** — did it find all مادة/البند boundaries, no spurious clauses
    (cross-references, TOC entries) — directly tests the Arabic guidelines in the prompt.
  - **Clause count** vs golden (the "30 clauses → 30 objects" completeness rule).
  - **`section_number` match rate** (exact string).
  - **`clause_type` accuracy** (label agreement vs golden).
  - **Exact-text fidelity** — content must be verbatim, not paraphrased (normalized string match /
    high token-overlap threshold; this is a hard requirement in the prompt).
  - **Arabic integrity checks** — no mojibake / no LTR reordering / definitions formatted as `- term: …`.
- **What to measure (later extensions, separate metrics):** risk → (L, I, score, category) agreement
  vs golden; obligations → field-level precision/recall; chat/summary → rubric or LLM-judge (subjective,
  defer).
- **Golden-set format:** `*.golden.json` — an array of expected clause objects (title, content,
  clause_type, section_number) keyed to a stored source text, hand-verified, with a documented labeling
  protocol so it's reproducible and auditable.
- **Where it lives:** `ai-backend/tests/accuracy/` (Python, can import the agents directly), but **gated
  out of the unit CI** — it needs a real `ANTHROPIC_API_KEY` and costs money, which violates
  CLAUDE.md's "CI is unit-test ONLY — never real Anthropic API." Mark it (e.g. a pytest marker /
  env flag) so it runs manually or on a scheduled/opt-in job, never in the PR unit lane.
- **Determinism:** pin `temperature=0` in the **harness** invocation path (production agents are
  unchanged) and/or run N samples to bound run-to-run variance — otherwise scores are noisy.
- **Token/cost capture:** record `response.usage.input_tokens`/`output_tokens` per run so the cost rule
  (§5 D6) has real numbers; compute Claude $ from a pricing constant.

---

## 3. Per-prompt replacement candidates (eventual trial targets — NOT for 8.1 to swap)

Arabic capability is the gating factor for SIGN's moat. Standout MENA-aligned OSS family: **Jais**
(MBZUAI/G42, Abu Dhabi — Arabic-native) and **Qwen2.5** (strong multilingual incl. Arabic, reliable
structured output). Cohere **Command-R/R+** is RAG/citation-oriented. Llama-3.x is weaker on Arabic.
For eventual classification heads (8.4/8.5): legal-BERT/ContractBERT + AraBERT for Arabic.

| # | Prompt | Candidate OSS class (eventual trial) | One-line reason | Difficulty |
|---|---|---|---|---|
| 1 | Clause extraction | Qwen2.5-72B-Instruct **or** Jais-30b/70b | Needs long-context Arabic + reliable verbatim JSON + boundary nuance — the hardest to replace | **HARD** |
| 2 | Risk scoring (L×I) | Qwen2.5-72B / Llama-3.3-70B | Requires reasoning + Arabic; label agreement is testable but reasoning quality is the risk | **HARD** |
| 3 | Compliance (multi-layer) | Command-R+ (RAG-tuned) / Qwen2.5-72B | Long legal context + grounded findings; citation discipline matters | **HARD** |
| 4 | Conflict detection | Qwen2.5-72B | Cross-document Arabic reasoning with priority logic | **HARD** |
| 5 | Obligations extraction | Qwen2.5-32B/72B (later fine-tune in 8.4/8.5) | Structured extraction is more tractable than open reasoning | **REALISTIC** |
| 6 | Summarizer | Qwen2.5-32B / Command-R | Abstractive summary is forgiving; lower stakes | **REALISTIC** |
| 7 | Diff analyzer | Qwen2.5-32B | Bounded clause-pair comparison | **REALISTIC** |
| 8 | Conversational chat | Qwen2.5-72B / Command-R+ | Arabic legal Q&A + citations; RAG-tuned models fit the `<legal_context>` pattern | **REALISTIC→HARD** |
| 9 | Research agent | Qwen2.5-14B/32B / Llama-3.1-8B | Short English-keyword input, low stakes — easiest win | **REALISTIC** |
| (adj.) | Embeddings (OpenAI) | BGE-M3 / multilingual-e5-large | Strong multilingual incl. Arabic; self-hostable — but re-embedding migration required | **REALISTIC (separate effort)** |

> These are *candidates to trial in 8.4/8.5*, recorded here as the inventory tags. 8.1 does not test,
> rank, or select any of them.

### §3 update — team's current leaning (2026-06-22)

The team is now leaning toward the following specific replacements, **to be confirmed/tested in
8.4/8.5 (NOT in 8.1)**. These are the **current preference**, chosen so **all data stays inside our
AWS** (self-hosted) — **not yet selected or tested**:

| Capability | Current-leaning candidate | Hosting |
|---|---|---|
| Clause classification | **ContractBERT** | self-hosted on SageMaker |
| Risk classification | **ContractBERT (fine-tuned)** | self-hosted on SageMaker |
| Risk explanation generation | **Mistral 7B** *or* **DeepSeek-R1-Distill-Qwen-32B** | self-hosted |
| Arabic / bilingual contracts | **LEGAL-XLM-RoBERTa** | self-hosted on SageMaker |

These sit alongside the general candidate classes in the table above; the deciding factor remains
Arabic accuracy on the baseline (see §6), measured before any switch.

---

## 4. Scope + change map

**Greenfield (new artifacts):**
- This findings doc (`docs/phase-8.1-investigation.md`).
- The Arabic accuracy harness (`ai-backend/tests/accuracy/`) — new, CI-opt-out.
- The golden set(s) + source text fixtures — **new and the largest real effort** (sourcing + human labeling).
- The written migration rule (drafted in §6 below; promoted to CLAUDE.md/NEXT_PHASES only at the doc-update step on your instruction).

**Touches existing code (only if you choose to):**
- *Optional, recommend deferring:* centralizing the hardcoded `claude-sonnet-4-6` string (×9) into one
  constant/env var. This is a cheap future enabler for an actual swap but is **8.4/8.5 work**, not 8.1.
  8.1's tagging can be doc-only.
- The harness will *import* the agent classes read-only; it does not modify them.

**Risks / dependencies / blockers:**
- **No golden set exists** — the dominant cost. Requires real, labeled Arabic construction contracts.
- **Confidentiality (Phase 10 / SOC 2):** the real 81k General Conditions doc may be client/government
  data. Committing raw client contract text to the repo is a PII/confidentiality risk. (See §5 D9.)
- **Non-determinism:** no `temperature` set anywhere → scoring noise unless the harness pins it.
- **Cost:** running the suite hits the real paid Claude API; must stay out of unit CI.
- **Embeddings are locked:** different embedding models produce non-comparable vectors → any change is a
  coordinated re-embedding migration, out of 8.1.
- **Summarizer has no chunking** — a latent large-document risk noted for the inventory; not an 8.1 fix.

---

## 5. Decisions for you (each with one recommendation)

1. **Golden-set / baseline source.**
   **Recommendation:** source the real 81k General Conditions doc for the *clause-extraction* baseline,
   but only commit a **de-identified** copy + its golden JSON; additionally adopt the already-committed
   `docs/law-131-1948.pdf` as a public, license-clean Arabic secondary baseline.
   *Rationale:* reproducible CI/eval without leaking client data, plus a fallback we already control.

2. **Primary metric focus for v1.**
   **Recommendation:** make clause-extraction structural metrics (boundary precision/recall, clause
   count, `clause_type` accuracy, `section_number` match, verbatim-text fidelity) the v1 baseline; defer
   subjective chat/summary quality to a later LLM-judge rubric.
   *Rationale:* clause extraction is the Arabic-critical path and the most objectively measurable.

3. **Golden ground-truth format & storage.**
   **Recommendation:** `ai-backend/tests/accuracy/golden/<doc>.golden.json` (array of expected clause
   objects) + stored source text + a written labeling protocol.
   *Rationale:* matches the agent's output schema; auditable and diffable.

4. **Where the harness lives + CI posture.**
   **Recommendation:** `ai-backend/tests/accuracy/`, pytest-runnable, **gated out of the unit CI**
   behind a marker/env flag (real API + cost); run manually or on an opt-in/scheduled job.
   *Rationale:* honors CLAUDE.md "CI is unit-test only, never real Anthropic API," while keeping the
   harness next to the agents it imports.

5. **How to tag prompts with their intended replacement.**
   **Recommendation:** doc-only for 8.1 — the §3 inventory table is the tag. Do **not** add a
   model-config indirection or touch the 9 agent files yet.
   *Rationale:* 8.1 is inventory + tool + rule, not a refactor; centralizing the model string belongs to
   the first real migration (8.4/8.5).

6. **How to measure cost.**
   **Recommendation:** instrument the harness to capture per-prompt `usage.input_tokens/output_tokens`,
   compute Claude $ from a pricing constant now; express the OSS comparison as $/1k-docs at a target
   throughput later (during 8.4/8.5 trials).
   *Rationale:* the cost half of the migration rule needs real token data; instrument now, compare later.

7. **Determinism in the harness.**
   **Recommendation:** pin `temperature=0` in the eval harness invocation path only (production agents
   unchanged), and record run-to-run variance on a sample.
   *Rationale:* stable, reproducible baseline scores.

8. **Is OpenAI embeddings in 8.1 scope?**
   **Recommendation:** list it in the inventory as adjacent, but **exclude** it from 8.1's Claude→OSS
   migration scope (it's a separate, locked decision requiring a re-embedding migration).
   *Rationale:* keep 8.1 focused on Claude prompts.

9. **Confidentiality of the real Arabic baseline doc (Phase 10 alignment).**
   **Recommendation:** never commit raw client/government contract text; commit only de-identified
   source + abstract golden data, and prefer the public Egyptian Civil Code PDF for the shareable
   baseline.
   *Rationale:* aligns with Phase 10 data-compliance and the MENA privacy posture.

---

## 6. Draft of the written migration rule (for your review — not yet promoted to CLAUDE.md)

> **AI model migration rule (Phase 8).** No Claude prompt may be migrated to a replacement model unless
> (a) the Arabic accuracy test suite has been run against the candidate on the agreed baseline, AND
> (b) the candidate's Arabic accuracy holds or improves versus the `claude-sonnet-4-6` baseline.
> **Quality (Arabic accuracy) is the deciding factor.** Cost (API or self-hosted GPU $/1k-docs at
> target throughput) is **recorded and considered for awareness, but is NOT a blocker** — quality wins.
> **Hard rule: never migrate a model without first running the Arabic accuracy test suite.** Migrate one
> prompt at a time; the embeddings model is excluded (changing it requires a coordinated re-embedding
> migration).

*(Promotion of this rule into CLAUDE.md + marking 8.1 progress in NEXT_PHASES.md happens only at the
doc-update step, on your explicit instruction.)*

---

## 7. Appendix — exact code references

- Agents dir: `ai-backend/app/agents/` — `clause_extractor.py`, `risk_analyzer.py`,
  `compliance_checker.py`, `conflict_detector.py`, `obligations_extractor.py`, `summarizer.py`,
  `diff_analyzer.py`, `conversational_agent.py`, `research_agent.py`.
- Celery tasks: `ai-backend/app/tasks.py` (global limits soft 300s/hard 600s L27-28; clause-extract
  override soft 1800/hard 2400 L168-169; legal-ingest override L482-483).
- Config: `ai-backend/app/config/settings.py` — `ANTHROPIC_API_KEY` (L16), `OPENAI_API_KEY` (L17);
  **no model field**.
- NestJS bridge: `backend/src/modules/ai/ai.service.ts` — `trigger*` (POST → `{job_id,status}`),
  `getJobStatus` (L189), `embedQuery` (L290, the only sync AI call).
- Hardcoded `model="claude-sonnet-4-6"`: clause_extractor L570, summarizer L65, compliance_checker L170,
  conflict_detector L166, risk_analyzer L187, conversational_agent L120, research_agent L74,
  obligations_extractor L112, diff_analyzer L78.
- No committed 81k baseline: `Glob **/*.{docx,pdf}` → only English legal policies + `docs/law-131-1948.pdf`.
- Backend has no Anthropic SDK: `grep -i anthropic backend/package.json` → none.
