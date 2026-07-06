# Phase 8.3 — Annotation Setup (Label Studio) — Investigation Findings

> **Status:** Investigation only (read-only). No code, no tests, no branch.
> **Scope:** 8.3 ONLY — stand up Label Studio locally, configure two annotation
> projects (clause type + risk), and import existing extracted clauses **already
> AI-pre-labeled** so humans verify/correct instead of labeling from scratch.
> **Explicitly out of scope:** 8.2 (OCR/Textract), 8.4 (clause-classifier
> training), 8.5 (risk-classifier training), 8.6 (SageMaker). 8.3 produces the
> labeled dataset; it trains **nothing**.
> **Author:** Ayman | **Date:** 2026-06-28

---

## 0. Executive summary (grounded in repo code)

- **The pre-labels already exist in the DB — we do NOT need a fresh pre-labeling
  pass for the existing corpus.** Every AI-extracted clause is persisted with its
  `clause_type` **and** an extraction `confidence_score`
  (`document-processing.service.ts:892-898`, `source = AI_EXTRACTED`,
  `review_status = PENDING_REVIEW`). Every risk finding is persisted with
  `risk_category`, `risk_level`, and PMBOK `likelihood`/`impact`/`risk_score`
  (`risk-analysis.entity.ts`). So 8.3's pre-annotations are a **read-only DB
  export**, not a re-run of the AI.
- **Confidence routing is free for clauses** (`confidence_score` exists) but
  **risk findings carry no confidence field** — route clauses by confidence; for
  risk, review the whole (smaller) set or route by `likelihood_source = FALLBACK`.
- **Label vocabularies must be derived from what the system uses today**, not
  invented: clause type = the 17-value set the extractor emits; risk = the AI's
  4-level severity (`low/medium/high/critical`) which the DB folds to a 3-level
  `RiskLevel` enum + a 1-25 `risk_score`.
- **There is already an in-app clause-review flow** (`review_status`
  PENDING_REVIEW → APPROVED/EDITED/REJECTED + `clause_type` correction,
  `document-processing.service.ts:1173-1209`). Human-verified corrections from
  production are therefore a *second, free* source of gold labels — worth
  harvesting alongside Label Studio.
- **Entirely local. No AWS, no cloud, no new runtime coupling.** Label Studio
  runs in local Docker with a local data volume; the import is an offline
  read-only export script. (AWS only ever appears in 8.6/9.x — not here.)
- **Confidentiality is the main risk:** the clauses are real client/government
  contracts (e.g. the National Authority for Tunnels General Conditions used as
  the 8.1 baseline). Mirror the 8.1 stance — anonymize on export + keep the
  instance local.

---

## 1. Existing clause / label data (real fields)

### 1a. Clauses — `clauses` table → `Clause` entity (`backend/src/database/entities/clause.entity.ts`)

| Field | Type | Relevance to 8.3 |
|---|---|---|
| `id` | uuid | task key |
| `title` | varchar(500) | clause title (context for annotator) |
| `content` | text | **the clause text to annotate** (verbatim, per extractor) |
| `clause_type` | varchar(100), nullable | **clause-type pre-label** (free-form column; AI fills it from a fixed set — §3) |
| `confidence_score` | decimal(3,2), nullable | **extraction confidence 0.00–1.00** → confidence routing |
| `source` | enum `MANUAL` / `AI_EXTRACTED` / `AI_DRAFTED` | filter to `AI_EXTRACTED` for the dataset |
| `review_status` | enum `PENDING_REVIEW` / `APPROVED` / `REJECTED` / `EDITED` | existing human-review signal (gold-label source) |
| `reviewed_by` / `reviewed_at` | uuid / ts | who corrected, when |
| `organization_id` | uuid, nullable | tenant (confidentiality scoping) |
| `source_document_id` | uuid, nullable | provenance → source contract/doc |

### 1b. Per-contract placement — `contract_clauses` → `ContractClause` (`contract-clause.entity.ts`)

`section_number` (varchar 50), `order_index`, `is_proposed` (guest flag — exclude proposed), `customizations` jsonb. **Risk + obligations link here (per-contract instance), NOT to the bare `Clause`.**

### 1c. Risk — `risk_analyses` table → `RiskAnalysis` (`risk-analysis.entity.ts`)

| Field | Type | Relevance |
|---|---|---|
| `contract_clause_id` | uuid, nullable | links a finding to a ContractClause (a clause may have 0..N findings) |
| `risk_category` | varchar(100) | **risk-category pre-label** (free-form) |
| `risk_level` | enum `LOW` / `MEDIUM` / `HIGH` | **3-level** risk label (DB) |
| `likelihood` / `impact` | smallint 1–5 each | PMBOK L, I (Phase 7.17) |
| `risk_score` | smallint 1–25 (= L×I) | richest risk signal; 21–25 = "critical" band folded to HIGH |
| `likelihood_source` / `impact_source` | varchar(20) | provenance (`FALLBACK` = low trust → routing proxy) |
| `description` / `recommendation` | text | annotator context |
| `status` | OPEN/APPROVED/MANUAL_ADJUSTED/OBSERVED/REJECTED | review signal |
| — | — | **no `confidence` field on risk** |

**Key shape fact:** clause-type data is 1:1 with a clause; risk data is **finding-level** (0..N per clause). A clause-level risk label must be *derived* (see §3 / decision D4).

---

## 2. AI pre-labeling path

**Confirmed: reuse, don't re-run.** The agents already emit the labels and the
backend already persists them:

- **Clause type** — `ExtractedClauseItem{ title, content, clause_type, section_number, confidence }` (`ai-backend/app/models/schemas.py:365-372`) → persisted verbatim at `document-processing.service.ts:892-898` (`clause_type`, `confidence_score = ec.confidence`).
- **Risk** — `RiskItem{ clause_id, risk_type, severity, description, suggestion }` (`schemas.py:33-47`; severity = `low/medium/high/critical`, **no confidence**) → mapped to PMBOK via `backend/src/modules/risk-analysis/utils/severity-mapping.ts` (`mapSeverityToLikelihoodImpact` → L,I; `mapScoreToRiskLevel` → 3-level enum) and stored on `RiskAnalysis`.

So the **simplest path** is: an **offline read-only DB export** that joins
`clauses` (+ `contract_clauses` for section/contract, + `risk_analyses` for risk)
and emits Label Studio tasks with the stored labels as **predictions**
(pre-annotations). No AI re-invocation for the existing corpus.

**When a fresh pre-labeling pass *is* needed:** only for clauses that have a
`clause_type` but were **never risk-analyzed** (no `risk_analyses` row) and you
want a risk pre-label for them. That's a targeted re-run of the existing risk
agent over those clauses — optional, and only to widen coverage toward 500+.

**Confidence routing:**
- Clauses: sort ascending by `confidence_score` → low-confidence clauses to humans first (most likely wrong); high-confidence → spot-check. `NULL` confidence (older rows) routes as low.
- Risk: no confidence column → route by `likelihood_source/impact_source = FALLBACK` (the resolver's "no basis" tier) as the low-trust proxy, or simply review the entire risk set (lower volume than clauses).

**Free supplementary gold:** clauses already moved to `review_status = APPROVED`/`EDITED` with a human-set `clause_type` are *already verified* — harvest them directly as confirmed labels (no Label Studio pass needed for those).

---

## 3. Label Studio setup

**Stand-up (local Docker, per NEXT_PHASES 8.3 / 11.1):**
```
docker run -it -p 8080:8080 \
  -v <repo>/label-studio-data:/label-studio/data \
  heartexlabs/label-studio:latest
```
- **Data location:** the mounted `label-studio-data/` volume (SQLite + uploaded tasks) on the local/on-prem machine. Gitignore it — never commit annotation data. No external DB, no S3.
- **Connection to our clause data:** *decoupled* — an offline export script reads the SIGN Postgres (read-only) and writes a Label Studio import JSON file; a human imports it via UI/API. No live link between Label Studio and the SIGN DB (simplest, safest for v1). A live ML-backend integration is possible later but unnecessary for a one-time dataset build.

**Two projects, schemas derived from real usage:**

**Project A — Clause Type** (`<Choices>` single-select). The 17 values the
extractor actually emits (`ai-backend/app/agents/clause_extractor.py` SYSTEM_PROMPT):
`general, payment, liability, termination, indemnification, force_majeure,
dispute_resolution, confidentiality, compliance, insurance, warranty,
intellectual_property, scope_of_work, variations, defects, time, other`.
(Normalize stored values to lowercase — the live pipeline stores lowercase;
some test fixtures use uppercase.)

**Project B — Risk** (`<Choices>` single-select for level). Primary label =
the AI's **4-level severity** `low / medium / high / critical` (preserves the
critical band the 3-level DB enum collapses; the `risk_score` 1–25 carries it).
Show `risk_category`, `risk_score`, `description` as read-only context. Because
risk is finding-level, the task unit is a **clause** with a **derived** level
(decision D4) — default `low`/`none` for clauses with no finding.

Each task displays the clause `content` (RTL-safe — Arabic) + `title` /
`section_number` / source as read-only context, with the AI label pre-selected.

---

## 4. Import / export flow

**IN (pre-annotations):** Label Studio import JSON, one task per clause:
```json
{
  "data": { "text": "<clause content>", "title": "...", "section_number": "...",
            "clause_db_id": "<uuid>", "ai_confidence": 0.87 },
  "predictions": [{
    "model_version": "claude-sonnet-4-6/pipeline",
    "result": [{ "from_name": "clause_type", "to_name": "text",
                 "type": "choices", "value": { "choices": ["payment"] } }]
  }]
}
```
Label Studio renders `predictions` as a pre-filled answer the annotator
accepts or changes. Risk tasks use the same shape with the risk `choices`.

**OUT (training-ready):** export Label Studio **JSON-MIN** (or CSV) → a small
transform to JSONL the trainer can read:
`{ "text": "...", "label": "payment", "source_clause_id": "...", "verified_by": "...", "was_corrected": true }`.
Keep `was_corrected` (annotation ≠ prediction) — it's the signal of where the
current AI is weak, valuable for 8.4/8.5.

**Target:** ≥ 500 verified examples per project (the 8.4/8.5 gate). Reaching it
fast = pre-fill everything + confidence-route review (§7 D8) + fold in the
already-`APPROVED`/`EDITED` clauses as pre-verified.

---

## 5. Confidentiality

The clauses are **real client/government contracts** (the 8.1 baseline is a
National Authority for Tunnels General Conditions). Same risk class as 8.1.

- **Recommended (mirror 8.1):** **anonymize clause text on export** — reuse the
  8.1 placeholder approach (party/project/location/person/amount/date →
  `[PARTY_A]`, `[PROJECT]`, …) — **and** run the Label Studio instance
  **strictly locally** (no cloud, bound to localhost). Belt-and-suspenders.
- **Why anonymization doesn't hurt the labels:** clause type and risk level
  depend on the *legal content*, not on party names/amounts — exactly the 8.1
  reasoning that let us anonymize the accuracy fixture without distorting the
  test. So the labeled dataset stays valid.
- **Where data sits:** only in the local `label-studio-data/` volume + the
  local export/JSONL files — all gitignored, never committed, never uploaded.
  The raw (un-anonymized) export must never be committed (8.1 rule).
- **SOC2/GDPR alignment:** this matches Phase 10.3 ("no full PII to external
  surfaces"); a local instance + anonymized text keeps the dataset clean for
  when 8.6 eventually moves training to SageMaker.

---

## 6. Scope + change map

**Greenfield (new, self-contained):**
- Label Studio Docker run + labeling-config XML for the 2 projects.
- A read-only **export script** (DB → anonymized Label Studio import JSON) — naturally lives in `ai-backend/` (Python, near the 8.1 harness) or a small `tools/` script; reuses an 8.1-style anonymizer.
- An **export→JSONL transform** for the reviewed results.
- `label-studio-data/` + export artifacts added to `.gitignore`.

**Touches existing code:** **none required.** The export reads existing tables
read-only; no entity/migration/endpoint changes. (Optional, separate: a tiny
read endpoint to pull clauses+labels instead of direct DB read — not needed for
v1.)

**Risks / dependencies / blockers:**
- **Confidentiality** (above) — the dominant control.
- **Data volume / coverage** — do we have ≥ 500 AI-extracted clauses with labels in the dev DB? Needs a quick count; if short, widen with more ingested contracts (anonymized) — not an AWS dependency.
- **Risk unit-of-annotation** — finding-level → clause-level derivation (D4) must be decided before the risk export.
- **`clause_type` is free-form varchar** — stored values may have case/spelling drift; normalize against the 17-value set on export.
- **No AWS, no cloud, no production coupling** — confirmed; 8.3 is fully local.

---

## 7. Decisions for you (each with a recommendation)

1. **Reuse stored labels vs fresh pre-labeling pass.**
   **Rec:** Reuse the DB-stored `clause_type`/`confidence_score` + risk
   `level`/`score` as pre-annotations; run a fresh risk pass *only* for clauses
   lacking a risk row if coverage needs it. *Rationale: the pipeline already
   persists them — cheapest path to pre-filled tasks.*

2. **Clause-type label schema.**
   **Rec:** the 17-value extractor set (lowercase-normalized). *Rationale:
   matches what the model emits and the DB stores; inventing categories breaks
   alignment with the 8.4 trainer.*

3. **Risk label schema.**
   **Rec:** 4-level severity `low/medium/high/critical` as the class, with
   `risk_score`/L/I shown as context. *Rationale: matches AI output and keeps
   the "critical" band the 3-level DB enum loses.*

4. **Risk unit-of-annotation (finding-level → clause-level).**
   **Rec:** clause-level label = the **worst (max `risk_score`) finding** for
   that clause; clauses with no finding → `low`/`none`. *Rationale: 8.5's target
   is "classify a clause's risk," which needs one label per clause.*

5. **Where Label Studio data lives.**
   **Rec:** local Docker volume on a controlled local/on-prem machine,
   localhost-bound; never cloud. *Rationale: real contract data; 8.3 needs no
   AWS or shared infra.*

6. **Confidentiality handling.**
   **Rec:** anonymize clause text on export (reuse 8.1 placeholders) **and** keep
   the instance local; never commit raw exports. *Rationale: the dataset outlives
   the session and feeds 8.4/8.5/8.6; anonymize once at the source, labels stay
   valid.*

7. **Import / export format.**
   **Rec:** import Label Studio JSON with `predictions`; export JSON-MIN →
   transform to JSONL `{text, label, source_clause_id, was_corrected}`.
   *Rationale: native pre-annotation support in + clean training-ready out.*

8. **Review depth (full review vs spot-check).**
   **Rec:** confidence-routed — full human review of low-confidence clauses + the
   entire risk set; spot-check ~10–20% of high-confidence clauses; fold in
   already-`APPROVED`/`EDITED` clauses as pre-verified. *Rationale: concentrate
   effort where the AI is weakest; reach 500+ fastest.*

9. **Connection method (offline export vs live ML backend).**
   **Rec:** offline read-only export script for v1; no live ML-backend coupling.
   *Rationale: simplest, read-only, no new runtime surface for a one-time build.*

10. **Source corpus for the dataset.**
    **Rec:** `AI_EXTRACTED` clauses from the existing corpus, plus the
    already-anonymized 8.1 General Conditions fixture as a known-good seed.
    *Rationale: they already carry pre-labels and the 8.1 fixture is a vetted
    anonymized starting point.*

11. **Where the export/transform scripts live.**
    **Rec:** `ai-backend/` (Python, alongside the 8.1 `tests/accuracy/`
    anonymizer) or a small `tools/` dir; gitignore the data + raw exports.
    *Rationale: reuse the 8.1 anonymizer; keep ML-dataset tooling together.*

---

## 8. Appendix — exact code references
- Clause storage: `backend/src/database/entities/clause.entity.ts` (`clause_type`, `confidence_score`, `source`, `review_status`).
- Per-contract placement: `backend/src/database/entities/contract-clause.entity.ts` (`section_number`, `is_proposed`).
- Risk storage: `backend/src/database/entities/risk-analysis.entity.ts` (`risk_category`, `risk_level`, `likelihood`/`impact`/`risk_score`, `*_source`).
- Clause persistence from AI: `backend/src/modules/document-processing/document-processing.service.ts:874-898` (clause_type + confidence_score + AI_EXTRACTED + PENDING_REVIEW).
- In-app clause review/correction: `document-processing.service.ts:1173-1209`, `document-processing.controller.ts:130-133`.
- Risk severity mapping: `backend/src/modules/risk-analysis/utils/severity-mapping.ts` (`mapSeverityToLikelihoodImpact`, `mapScoreToRiskLevel`).
- AI output schemas: `ai-backend/app/models/schemas.py` — `ExtractedClauseItem` (L365), `RiskItem` (L33).
- Clause-type vocabulary (17 values): `ai-backend/app/agents/clause_extractor.py` SYSTEM_PROMPT.
- No Label Studio config exists yet (greenfield); no AWS references in scope.
