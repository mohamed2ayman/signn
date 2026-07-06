# Risk-correction UI placement — Investigation (Phase 8.3)

> **Status:** Investigation only (read-only). No code, no branch.
> **Question:** where/how should a human correct **risk** labels during 8.3
> annotation — extend the Risk Analysis tab, add a dropdown to the Clause Review
> screen, or both — and which gives the best *training* data for the least build?
> **Date:** 2026-07-04

---

## TL;DR — the hypothesis is half-right

The Risk Analysis tab **displays** everything richly, but **display ≠ edit**: today
it is edit-only for **status** (via two *conflict-resolution*-framed buttons). The
finding's **level and category are display-only** — there is **no UI to change
them**, and the backend L/I override that *could* change the level **exists but is
not wired to the frontend at all**. So "add editing to the Risk tab" is **not** the
cheap win it looks like — level editing must be wired, and **category editing does
not exist anywhere** (no endpoint).

Meanwhile, the thing 8.5 actually trains on (per approved **decision B**) is **one
risk level per clause** — which the **8.3 export snapshot already produces** with
`was_corrected` intact, **without touching the app or the 508 or PR #126.**

**Recommendation:** don't build an in-app risk editor for the gold set. Use the
**export-snapshot path** (option b's *semantics*, delivered read-only). If you
insist on in-app, the **review-screen overall-level dropdown (b)** is smaller and
safer than extending the Risk tab (a). Save per-finding editing (a) for a separate
"improve the risk pipeline" effort — it's not needed for the 8.5 gold and it pokes
the just-fixed write path.

---

## 1. Risk Analysis tab — what it renders and what's editable

**Location:** inline in `apps/sign/src/pages/app/ContractDetailPage.tsx` (there is no
standalone `RiskTab` component). Data via `riskAnalysisService.getByContract(id)` →
`GET /risk-analysis/contract/:id`; summary via `getRiskSummary`.

**Per-risk render** (`RiskCard`, ~lines 105–230): `RiskLevelBadge` (level),
`risk_category` (text), `status` badge, `description`, the AI `recommendation`
("AI Suggestion"), and `citation_source`. Rich — exactly as you saw.

**What's actually EDITABLE today — status only, and conflict-framed:**
- The only action controls appear **when `status === 'OPEN'`** and are two buttons:
  **"Accept Governing Value"** → `updateStatus(id, 'APPROVED')`, and **"Override"** →
  `updateStatus(id, 'MANUAL_ADJUSTED')` (`handleConflictAcceptGoverning` /
  `handleConflictOverride`, ~lines 418–434). These are built for **DOCUMENT_CONFLICT**
  resolution (accept the priority auto-resolution vs manually adjust) — **not** a
  label editor.
- **`risk_level`, `risk_category`, and L/I are DISPLAY-ONLY** — no dropdown, no edit
  control, no save path in the UI.

**The backend can already edit L/I (and it logs the original) — but the UI doesn't
call it:**
- `PATCH /risk-analysis/:id/override` (`OverrideRiskDto` = `likelihood` 1–5 +
  `impact` 1–5 + optional `note`) recomputes `risk_score`→`risk_level` and **writes
  an append-only `risk_analysis_override_log` row** (`previous_likelihood`/`impact`,
  `new_likelihood`/`impact`, `previous_source`, `user_id`, `note`). This is the
  **`was_corrected` signal for risk L/I — preserved for free** (original vs new).
- **BUT** `riskAnalysisService` (frontend) has **no `override` method** — the
  endpoint (Phase 7.17 B.3) was built and tested but **never surfaced in the UI**.
- **Category is NOT overridable** — there is no endpoint to change `risk_category`.
  Correcting the 39% `Uncategorized` would need a **new** write path + storage.

**Net:** the Risk tab is a rich *viewer* with a *status/conflict* editor. To make it
a *label* editor you must (i) **wire** the existing L/I override (to change level)
and (ii) **build** category editing (new endpoint + `was_corrected` storage).

---

## 2. Clause Review screen — the clause_type edit pattern (for reuse)

**Location:** `apps/sign/src/pages/app/ClauseReviewPage.tsx` → `ClauseReviewCard.tsx`;
route `contracts/:id/review`. Fast clause-by-clause flow with filter tabs, per-clause
Approve/Edit/Reject, and **bulk-approve-all**.

**Save path:** `PUT /…/review/clauses/:clauseId` → `updateClauseReview(clauseId,
{review_status, clause_type?, title?, content?}, userId)`:
```ts
clause.review_status = data.review_status;
clause.reviewed_by = userId; clause.reviewed_at = new Date();
if (data.clause_type !== undefined) clause.clause_type = data.clause_type;  // OVERWRITE
return this.clauseRepository.save(clause);
```
- **Field:** `clauses.clause_type` (varchar). **`was_corrected` is NOT preserved** —
  the edit **overwrites** the AI value; only `review_status = EDITED` + `reviewed_by`
  survive, so the *original AI label is lost* unless snapshotted first. (Contrast
  with risk L/I, which logs the original.)
- Bulk-approve: `POST /…/review/clauses/bulk-approve` sets APPROVED on many ids
  (fast accept).

**Reuse for risk:** a risk-level dropdown here would follow the same shape (a
`PUT` that sets a value + reviewer stamp). But — like clause_type — a naïve
overwrite would **lose `was_corrected`** unless the AI original is snapshotted.

---

## 3. THE DECISION — (a) Risk tab per-finding vs (b) review-screen overall level vs (c) both

First, the training-target fact that settles most of it: **8.5's gold unit (approved
decision B) is ONE risk level per clause** (the worst-finding severity). 8.5 does not
train on per-finding labels. So the *training data* wants (b)'s shape.

### (a) Per-finding editing in the Risk tab (level + category + status per finding)
- **Training value:** richest (per-finding), but **more than 8.5 consumes** — 8.5
  needs one clause-level label; per-finding correction mainly helps *pipeline quality*
  (prune boilerplate over-labeling, fix categories) — a different goal.
- **Build:** MEDIUM–HIGH. Level = wire the existing L/I override (but a "level
  dropdown" must map level→representative L/I, which is lossy; editing L/I directly
  is precise but slower). Category = **new endpoint + new storage** (doesn't exist).
  Status = already there.
- **Speed:** SLOW — 1,061 findings, one-at-a-time, per contract, no bulk.
- **Blast radius:** touches the production Risk tab UI **and** a new category-write
  path **near PR #126's `saveAiRiskAsRow`** — the riskiest surface to extend.

### (b) One "overall clause risk level" in the review screen
- **Training value:** **exactly 8.5's target** (one level per clause = worst-finding
  severity, decision B). Right shape.
- **Build:** LOW — one dropdown + one save. But needs a **home for the human overall
  level + the AI original** (`was_corrected`): a new `contract_clauses` field/migration
  if done in-app (mutates the 508), OR — better — **carried in the export snapshot,
  no DB change**.
- **Speed:** FAST — same clause-by-clause flow as clause_type; type + risk on one
  screen.
- **Cons:** flattens the multi-risk detail — but that detail isn't 8.5's target, and
  the per-finding context is still visible for the annotator to judge the one level.

### (c) Both
- Overall level in review (fast, 8.5-aligned) + per-finding edits in the tab (rich).
- **Build:** the most (a + b). Only worth it if you *also* want the pipeline-quality
  win now. For the gold set alone, it's over-build.

### Assessment
- **Best training data for the 8.5 gold, least build, least risk:** **(b)'s
  semantics** — one clause-level risk label. It matches decision B and is the smallest
  change.
- **"Easier screen to extend given what exists":** the **review screen** — it already
  has the fast flow + a clause-level edit-and-save pattern to copy. The **Risk tab is
  NOT easier**: it's display + status/conflict buttons, so level/category editing must
  be built from scratch (category) or wired (level) on the production risk surface.
- **Cleanest of all:** don't build an in-app editor for the gold — the **8.3 export
  snapshot already carries `ai_risk_level` (worst-finding severity) + the findings as
  context**, so annotating it (Label Studio or in-app-with-snapshot) *is* option (b)
  with `was_corrected` preserved and **zero app/DB change**.

---

## 4. Data storage — keeping AI-original vs human-corrected (`was_corrected`)

| Path | Original AI value preserved? | Mechanism |
|---|---|---|
| **Export snapshot (recommended)** | ✅ both type + risk | the export writes `ai_clause_type` + `ai_risk_level` into each task; gold = compare human vs AI. **No DB change.** |
| Risk **L/I override** (existing, unwired) | ✅ | `risk_analysis_override_log` (previous→new) — free `was_corrected` for level |
| Risk **category** edit | ❌ (nothing today) | would need a new endpoint + a log/column to store the original |
| Clause **overall-risk-level** in-app | ❌ (no field) | would need a new `contract_clauses` column + snapshot of the AI original |
| Clause **clause_type** edit (existing) | ❌ overwrite | `review_status=EDITED` flags it, but original is lost → snapshot needed |

**Key point:** the **snapshot-first** approach (my `export_tasks.py`, read-only)
solves `was_corrected` for **both** type and risk **without any schema change** — it
freezes the AI labels before any edit. That's the single cheapest fix and it's the
one that makes *any* annotation surface safe for training.

---

## 5. Effort / blast radius / won't-break guarantees

| Option | Build | Touches 508? | Touches PR #126 write path? | Notes |
|---|---|---|---|---|
| **Snapshot + annotate (rec)** | LOW (read-only export exists) | **No** (read-only) | **No** | zero risk; `was_corrected` for both labels |
| **(b) in-app overall level** | LOW–MED | **Yes** (new col + writes on the 508) | No (writes a clause col, not risk_analyses) | migration + write path on the 508 |
| **(a) Risk-tab per-finding** | MED–HIGH | Yes (edits risk_analyses rows) | **Yes** — new category write **near `saveAiRiskAsRow`** | riskiest; also needs a category endpoint |
| Wire existing **L/I override** only | LOW–MED | Yes (edits risk_analyses via the override service) | Indirect — separate tested path, not the writer | free `was_corrected`, but level-via-L/I is lossy |
| **(c) both** | HIGH | Yes | Yes | over-build for the gold |

- **Won't-break-508:** the snapshot path is **read-only** — cannot touch the 508.
  Any in-app editor (b/a) *does* write the 508 (new column or risk_analyses rows) and
  needs care + a migration.
- **Won't-break-PR-#126:** option (a)'s **category write** is the only path that
  lands near `saveAiRiskAsRow` / the `contract_clause_id` FK mapping just fixed —
  highest regression risk. The snapshot path and (b) don't touch it. The existing L/I
  override is a **separate, already-tested service** (not the writer), so wiring it is
  lower risk than a new category path.

---

## 6. Recommendation

1. **For the 8.5 gold set: use the read-only export snapshot, annotate one
   clause-level risk label per clause (decision B), diff against `ai_risk_level` for
   `was_corrected`.** No in-app editor, no schema change, no risk to the 508 or PR
   #126. This *is* option (b)'s semantics delivered the safe way.
2. **If you want the correction to live in the SIGN app** (so the app shows verified
   labels), pick **(b) — a single overall-risk-level dropdown on the review screen**
   (reuses the fast clause-by-clause flow + the clause_type save pattern), and add a
   `contract_clauses` column for the human overall level **plus** snapshot the AI
   original for `was_corrected`. Smaller and safer than the Risk tab.
3. **Do NOT extend the Risk tab (a) for the gold build.** It only *displays* richly;
   level/category aren't editable, category has no endpoint, and a new category-write
   sits right next to PR #126's just-fixed writer. Per-finding correction is a
   **separate "improve the risk pipeline" feature** (worth doing later — prune
   boilerplate over-labeling, fix `Uncategorized`), not part of building the 8.5 gold.
4. **Nice-to-have, independent of the gold:** wire the **already-built L/I override**
   (`PATCH :id/override`) into the Risk tab so risk findings become adjustable in-app
   with free audit history. That's a small, self-contained UX win — but it's for
   production risk-tuning, not the training set, and can wait.

**Reasoning in one line:** 8.5 trains on one level per clause; the snapshot export
already produces exactly that with `was_corrected` and zero blast radius — so the
best risk-correction "placement" for the gold is *the export + annotation*, not a new
editor, and if an editor is wanted, the review screen (b) beats the display-only Risk
tab (a).

---

## Appendix — code references
- Risk tab render + status-only edit: `apps/sign/src/pages/app/ContractDetailPage.tsx`
  (`RiskCard` ~105–230; `handleConflictAcceptGoverning`/`handleConflictOverride` ~418–434).
- Frontend risk service (no `override` method): `apps/sign/src/services/api/riskAnalysisService.ts`.
- L/I override (exists, logs original): `risk-analysis.controller.ts` `PATCH :id/override`,
  `dto/override-risk.dto.ts` (L/I + note), `risk-analysis-override-log.entity.ts`.
- Status edit: `risk-analysis.controller.ts` `PUT :id/status`.
- Clause_type edit (overwrite): `document-processing.service.ts` `updateClauseReview` (~1137–1163),
  `document-processing.controller.ts` `PUT review/clauses/:id`, `POST review/clauses/bulk-approve`.
- 8.3 export snapshot (read-only, carries `ai_clause_type`/`ai_risk_level`):
  `tools/label-studio/export_tasks.py`.
