# Risk Pre-Labeling Pass — Investigation (Phase 8.3 prep)

**Status:** Investigation only. No code, no execution, no API calls. Read-only DB
inspection + real-code mapping. Produces a plan + options for decision.

**Goal:** put an AI risk pre-label on the 508-clause corpus so Label Studio
annotators *correct* rather than label from scratch — the way `clause_type` +
`confidence_score` are already populated. `risk_analyses` is currently EMPTY (0 rows).

---

## TL;DR

- **The capability already exists**: `RiskAnalyzerAgent` (ai-backend) + a full
  writer (`saveAiRiskAsRow`) that maps AI output → `risk_analyses` rows with
  likelihood/impact/score/category. It works today — it's just **only wired into
  `finalizeReview`**, which needs APPROVED clauses and charges a meter.
- **Why the table is empty**: all 508 clauses are `review_status = PENDING_REVIEW`.
  The only risk trigger (`finalizeReview`) loads only `APPROVED`/`EDITED` clauses →
  it has never run on this corpus.
- **Recommended approach**: a **dedicated batch pass (Option B)** that reuses the
  risk *agent* + the *writer's mapping logic*, scoped to risk only — bypassing the
  review-gating, the FINALIZE_REVIEW meter charge, and the obligations/conflict
  side-effects that `finalizeReview` bundles in.
- **Cost/time**: small — ~**42–51 API calls** (batched ~10–12 clauses/call, bounded
  by the agent's `max_tokens=4096`), **~$3–6** on Sonnet, **~5–15 min**. One-time.
- **Two decisions you must make first** (both surfaced below): (1) the agent's
  free-text categories (`Payment Terms`, `Indemnification`, …) **do not match** the
  8 seeded taxonomy rows (`Cost and Payment Risks`, …) → today they'd all store as
  **`Uncategorized`**; (2) the L/I anchor language is **explicitly unvalidated**
  (Ayman sign-off banner) — arguably fine (even ideal) for pre-labels, but you
  should know.
- **Blast radius**: INSERT-only into `risk_analyses`; reads clauses, never mutates
  them or `clause_type`. Fully verifiable.

---

## 1. The existing risk-analysis capability

### The agent — `ai-backend/app/agents/risk_analyzer.py`
`RiskAnalyzerAgent.analyze(clauses, knowledge_context=None)`:
- Input: a **list** of clause dicts (each `{id, text, [document_id, document_label,
  document_priority]}`).
- One `_call_model(scrub=True, max_tokens=4096, system=SYSTEM_PROMPT, …)` call for
  the whole batch (PII-scrubbed). Returns a JSON **array of risk objects**.
- **A "risk label" (per-risk output schema):**
  | field | meaning |
  |---|---|
  | `clause_id` | which clause the risk is on |
  | `risk_category` | free-text canonical name (prompt suggests `Performance Bond`, `Liability Cap`, `Payment Terms`, `Indemnification`, `Termination`, `Notice Period`, `Force Majeure`, `Dispute Resolution`, `Confidentiality`, `Intellectual Property`, else `Uncategorized`) |
  | `likelihood` | **integer 1–5** (Rare→Almost Certain, anchored) |
  | `impact` | **integer 1–5** (Insignificant→Severe, anchored) |
  | `severity` | `low`/`medium`/`high`/`critical` — legacy, derived from L×I |
  | `description` | business-user explanation |
  | `suggestion` | mitigation recommendation |
- **L×I is the primary signal** — the platform computes a **1–25 risk score** that
  drives dashboards/sorting/drift.
- **⚠️ Prompt guard (top of file):** "DO NOT MERGE TO PRODUCTION WITHOUT AYMAN
  SIGN-OFF on the Likelihood/Impact anchor language" — the cost-%, schedule-slip,
  and Impact=5 anchors were synthesised from PMBOK + construction-law lit and are
  **not domain-expert validated**. See §6.

### How it's wired today (the ONLY caller)
```
document-processing.service.ts :: finalizeReview()
  → loads contract_clauses WHERE clause.review_status IN (APPROVED, EDITED)
  → ai.service.triggerRiskAnalysis({contract_id, clauses, org_id})
      → POST ai-backend /agents/risk-analysis
          → Celery tasks.run_risk_analysis → RiskAnalyzerAgent.analyze()
  → pollAndSaveRisks(contractId, jobId, orgId, reservationId)   [background, 60×3s]
      → saveAiRiskAsRow(...) per returned risk   ← THE WRITER
```
`finalizeReview` is the review-finalize step. It **also** reserves the
`FINALIZE_REVIEW` meter, and triggers **obligation extraction** + **conflict
detection** in the same burst (one-charge model). There is **no** standalone
"analyze risk for these clauses" entry point that writes rows — the writer is
private to `document-processing.service.ts`.

### The writer — `saveAiRiskAsRow` (document-processing.service.ts:1614)
Per AI risk it: validates payload (needs `clause_id` + `description` + `likelihood`
OR `severity`) → validates `risk_category` against **active `risk_categories`**
(no match → `Uncategorized` + audit log) → `riskResolver.resolveDefaults()` for
`likelihood_source`/`impact_source`/`platform_default_ref_id` → picks final L,I
(valid AI L,I → use them; else `mapSeverityToLikelihoodImpact`, source=`FALLBACK`)
→ `mapScoreToRiskLevel(L×I)` for legacy `risk_level` → `repo.create(...).save()`
(the `@BeforeInsert` hook computes `risk_score = L×I`).

**Reuse note:** this writer is exactly what we want, but it's a **private method**
on `DocumentProcessingService`. A batch either (a) calls `finalizeReview`
(Option A, heavy), (b) extracts the writer into a small shared service the batch
can call (cleanest for Option B), or (c) re-implements the mapping (drift risk).

---

## 2. The `risk_analyses` table schema

`backend/src/database/entities/risk-analysis.entity.ts`. A complete row:

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `contract_id` | uuid **required** | FK → contract |
| `contract_clause_id` | uuid **nullable** | FK → `contract_clauses` — **this is the clause link** |
| `risk_category` | varchar(100) | validated vs taxonomy or `Uncategorized` |
| `risk_level` | enum `LOW`/`MEDIUM`/`HIGH` | legacy; derived from score |
| `description` | text required | |
| `recommendation` | text nullable | ← agent `suggestion` |
| `likelihood` | smallint 1–5 (CHECK), default 3 | |
| `impact` | smallint 1–5 (CHECK), default 3 | |
| `risk_score` | smallint 1–25 | **auto** via `@BeforeInsert/@BeforeUpdate` = L×I |
| `likelihood_source` / `impact_source` | varchar(20) | `RiskSourceType`, default `FALLBACK` |
| `status` | varchar(50) default `OPEN` | |
| `platform_default_ref_id` | uuid nullable | citation ref |
| `handled_by`/`handled_at`, `last_overridden_by`/`at`, `created_at` | | |

**Clause-link caveat (confirm before building):** the writer stores
`aiRisk.clause_id` **directly into `contract_clause_id`**. In `finalizeReview` the
payload `id` is `cc.clause.id` (**`clauses.id`**, not the `contract_clauses.id`
junction key). So today's rows link by `clauses.id` sitting in the
`contract_clause_id` column. For a batch, decide the join key deliberately —
either match existing behavior (send `clauses.id`) or send the true
`contract_clauses.id`. For Label Studio, `clauses.id` is the natural per-clause key.

---

## 3. Running it as a BATCH over all 508 (read-only on clauses)

**What a batch must do:** read the 508 clauses (id + content, + optional doc
metadata) → chunk into batches → call the risk agent per batch → INSERT
`risk_analyses` rows via the writer mapping. **No clause mutation.**

**Why the existing `finalizeReview` path can't be used as-is** (3 blockers):
1. **Review gate** — it loads only `APPROVED`/`EDITED` clauses; **all 508 are
   `PENDING_REVIEW`** (confirmed). It would load 0. Approving them to force it =
   an unwanted mutation of `review_status` + wrong semantics.
2. **Meter charge** — it reserves `FINALIZE_REVIEW` per contract (billing side-effect).
3. **Bundled side-effects** — it also fires obligation extraction + conflict
   detection (extra AI cost + writes we don't want for a risk-only pass).

⇒ A **dedicated batch that bypasses the review gate + metering + bundled agents**
is required (Option B). It only needs the risk agent + the writer mapping.

**Batching constraint:** the agent caps output at `max_tokens=4096`. A big contract
(85 clauses) in one call would truncate the risk array. Keep batches small
(~10–12 clauses/call) so the per-batch risk output fits well under 4096 tokens.
Batch **within a contract** (so `contract_id` + doc metadata are consistent per call).

---

## 4. Cost + time estimate

- **Model:** `ANTHROPIC_MODEL` default `claude-sonnet-4-6` (all agents read
  `self._model`). Sonnet pricing ≈ $3/M input, $15/M output.
- **Calls:** batches of ~10–12 clauses → **~42–51 calls** for 508 clauses.
- **Tokens (rough):** input ≈ Σ clause tokens (~508 × ~800) + 42× system prompt
  (~1.5k) ≈ **~450–500k input**; output ≈ 42–51 × ~2–3k ≈ **~100–150k output**.
- **Cost:** ≈ **$1.5 input + $2–3 output ≈ $3–6 total.** Even 3× off is < $20.
  **One-time. Small credit hit — but it IS real Anthropic spend, so it's gated on
  your go-ahead + a valid `ANTHROPIC_API_KEY`.**
- **Time:** ~42–51 calls at ~10–20s each ⇒ **~5–15 min** depending on concurrency.
- **Parallel infra reuse:** the clause-extraction parallel harness
  (`ThreadPoolExecutor` + `_RateLimitGate`, `CLAUSE_EXTRACT_CONCURRENCY`) lives in
  `clause_extractor.py` and is **NOT shared** by `RiskAnalyzerAgent` (its
  `analyze()` is a single blocking call). A batch either runs calls **sequentially**
  (simplest, still only ~10 min) or wraps them in a small parallel loop. The
  live-header rate-limit gate would have to be added if you parallelize hard;
  sequential avoids that entirely.

---

## 5. Options for HOW to run it

### Option A — per-contract `finalizeReview` (reuse the whole existing path)
Approve all clauses, then call `finalizeReview` for each of the 15 contracts.
- **Pros:** zero new mapping code — reuses the exact production writer + resolver.
- **Cons:** must flip 508 clauses to `APPROVED` (mutation we don't want); **charges
  the FINALIZE_REVIEW meter** 15×; **also runs obligations + conflict detection**
  (extra cost + writes); entangled with metering reconcile logic. **Not recommended.**

### Option B — dedicated risk-only batch (reuse agent + writer mapping) ✅ RECOMMENDED
A one-off NestJS command / script (or a thin internal endpoint) that: loads the 508
clauses read-only, batches within each contract, calls the risk agent (via the
existing FastAPI `/agents/risk-analysis` or the Celery task), and writes rows using
the **same mapping** as `saveAiRiskAsRow` — ideally by first **extracting that
private writer into a small `RiskWriterService`** both `finalizeReview` and the
batch call (no logic duplication, no drift).
- **Pros:** scoped to risk; **no review mutation, no meter charge, no
  obligations/conflict**; runs over **all** clauses regardless of `review_status`;
  full control of batch size (avoids `max_tokens` truncation); re-runnable.
- **Cons:** needs new (small) code — a batch driver + (ideally) the writer
  extraction. Must decide the clause-link key (§2 caveat).

### Option C — direct FastAPI + manual SQL write
Call `/agents/risk-analysis` directly, write rows with a script/SQL.
- **Pros:** no NestJS involvement, fastest to hack.
- **Cons:** **re-implements** category validation + resolver + `risk_level` mapping
  outside the app → drift + wrong `*_source` attribution; bypasses the
  `@BeforeInsert` score hook unless replicated. **Not recommended** (throws away the
  writer that's the whole value).

**Recommendation: Option B**, with the writer extracted into a shared service so
the batch and production `finalizeReview` share one mapping. Run **sequentially**,
small batches, over all 508.

---

## 6. Quality / consistency concerns

1. **Category taxonomy MISMATCH (decision needed).** The agent's prompt suggests
   fine categories (`Payment Terms`, `Indemnification`, `Liability Cap`, …) but the
   **8 seeded `risk_categories` are broad** (`Cost and Payment Risks`,
   `Contractual and Legal Risks`, `Design and Scope Risks`, `Dispute Resolution
   Risks`, `Force Majeure Risks`, `Performance and Quality Risks`, `Subcontracting
   Risks`, `Time and Delay Risks`). The writer validates against these → **today
   almost every AI category would store as `Uncategorized`** (original value
   audit-logged). L/I/severity/description/suggestion still populate. **Choose:**
   (a) accept `Uncategorized` (annotators set the category — fine for pre-labeling),
   (b) align the agent prompt to emit the 8 taxonomy names, or (c) expand the
   taxonomy to the finer set. Recommend (a) for the pass + revisit taxonomy in 8.3.
2. **Unvalidated L/I anchors.** The Ayman sign-off banner means L/I values are
   provisional. **For pre-labeling this is acceptable — even ideal**: annotators
   correct L/I, and their corrections can *become* the domain validation the banner
   asks for. Flag it so nobody treats the raw scores as authoritative.
3. **`risk_category_platform_defaults` is empty (0 rows)** → the resolver returns
   `FALLBACK` for `likelihood_source`/`impact_source` and null `platform_default_ref`.
   Harmless for pre-labels (provenance only); note it so the sources aren't
   misread as "methodology-backed."
4. **0..N risks per clause, not 1:1.** Unlike `clause_type` (exactly one per
   clause), risk is a *set*: a boilerplate/general clause may get **0** risks; a
   liability/indemnity clause may get several. ⇒ **"a risk pre-label on every
   clause" is not literally guaranteed** — some clauses will have none, and the
   Label Studio task design must decide whether "no risk" is itself a label. Expect
   the sparse-type clauses (definitions, interpretation, correspondence) to yield 0.
5. **No per-risk model "confidence".** `clause_type` has `confidence_score`; the
   risk agent emits **no confidence** — the analog is `risk_score` (L×I, 1–25).
   If Label Studio expects a confidence to sort pre-labels, use `risk_score`.
6. **Arabic / English / bilingual.** Sonnet handles Arabic clause text directly
   (the corpus is ~84% Arabic). **Project13's 13 bilingual clauses** hold both
   languages in one clause → longer (more tokens), and the agent may key its risk
   off either language; still analyzable, just heavier. Consistency across a
   batch depends on batch composition (mixing languages in one call is fine).
7. **LLM variance.** Same clause can score slightly differently run-to-run. Small
   batches + a fixed pass (no re-runs mixed in) keep it consistent enough for a
   *starting point* — which is all a pre-label needs.

---

## 7. Blast radius + how to verify

**Blast radius (Option B):** INSERT-only into `risk_analyses` (+ best-effort
`audit_logs` rows for unknown categories). **Reads** `clauses` / `contract_clauses`;
**never updates** them, never touches `clause_type`, `confidence_score`, or
`review_status`. No clause is modified, deleted, or re-typed.

**Pre-flight (before the run):**
- `ANTHROPIC_API_KEY` present + `ANTHROPIC_MODEL` = intended model.
- Snapshot: `SELECT COUNT(*), <clause_type histogram>, <review_status histogram>`
  on clauses (to prove they're unchanged after).
- Decide category handling (§6.1) and clause-link key (§2 caveat).

**Verify after (deterministic):**
- `risk_analyses` went **0 → N** (N ≈ number of risks found; expect < 508 total on
  the 0..N shape, some clauses none, some several).
- Clauses **unchanged**: count still 508, `clause_type` histogram identical,
  `review_status` still all `PENDING_REVIEW`, 0 orphans.
- Every risk row: `risk_score = likelihood × impact`, `likelihood`/`impact` ∈ [1,5],
  `risk_level` consistent with score band.
- Each risk's `contract_clause_id` resolves to a real clause in the same contract.

**Spot-check quality (before trusting the whole batch):** pull ~8–10 rows spanning
- a known high-risk clause (liability / indemnity / termination),
- a payment clause (price/adjustment),
- a pure-boilerplate clause (definitions) → expect **0 risks** (good sign),
- an **Arabic-only** clause,
- a **Project13 bilingual** clause,
and eyeball: is the category sensible, is L/I defensible against the clause text, is
the description accurate and in plain language? If the sample looks right, trust the
batch; if L/I is systematically off (e.g. everything 3/3), that's the unvalidated-
anchor risk (§6.2) surfacing — worth a prompt tweak before a full run.

---

## Recommended plan (for decision)

1. **Decide category handling** (§6.1) — recommend accept `Uncategorized` for the
   pass, revisit taxonomy alignment in Label Studio setup.
2. **Extract `saveAiRiskAsRow` into a shared `RiskWriterService`** (small, no
   behavior change) so batch + `finalizeReview` share one mapping.
3. **Build a risk-only batch driver (Option B)** — read 508 clauses, batch ~10–12
   per call within each contract, call the risk agent, write via the shared writer.
   No review mutation, no meter, no obligations/conflict.
4. **Dry-run on ONE contract first** (e.g. Project8, 15 clauses) → spot-check per §7
   → then run the full 508.
5. **Gate the live run** on your go-ahead + fresh `ANTHROPIC_API_KEY` (real spend,
   ~$3–6).

**Open decisions for you:** (a) category handling; (b) clause-link key
(`clauses.id` vs `contract_clauses.id`); (c) accept the unvalidated L/I anchors for
pre-labeling (recommend yes); (d) sequential vs parallel batch (recommend sequential
— it's only ~10 min).

**Scope note:** this pass writes AI risk pre-labels only. Label Studio project/task
design (how a clause + its 0..N risks are presented for correction) is the *next*
step, not covered here.
