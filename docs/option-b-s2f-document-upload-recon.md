# Option B — S2f: DocumentUpload bucket (wall-then-scope) — Phase 0 recon

Branch: `feature/option-b-s2f-document-upload` (off `main` @ `5491dd1`).
Prereqs confirmed present on the base:
- S2c (`ObligationScopedRepository`), S2d (`RiskScopedRepository`), S2e
  (`Notice`/`Claim`/`SubContract` scoped repos) — all registered in
  `scoped-repository.module.ts`.
- Processor sweep (#69, `findAcrossAllOrgs` passthrough) present.
- `1755000000002-AddReservationIdToDocumentUploads.ts` (upload_extraction
  metering reservation linkage) present.

DocumentUpload was the one drift-four entity **STOPPED** in S2e. The module
doc comment records the reason verbatim: its `updateExtractedText` path gates
on the denormalized `organization_id` column only, with no `findInOrg` wall to
layer under, so absorbing it would be a denorm→canonical SWAP, not a two-layer
add. This bucket does it correctly: **(1) wall the gap, THEN (2) scope.**

---

## A. Entity shape (canonical root is clean)

`document_uploads` (`backend/src/database/entities/document-upload.entity.ts`):
- `contract_id uuid NOT NULL` → `@ManyToOne(() => Contract)` → `Contract.project`
  → `project.organization_id`. **Clean canonical contract root.**
- `organization_id uuid NOT NULL` → denormalized drift column (non-authoritative).
- `reservation_id uuid NULL` → upload_extraction metering attribution (no FK).

Canonical resolution path: `document.contract_id → Contract → Project → Org`
(identical hop-shape to `RiskAnalysis`/`Obligation`). The denorm
`organization_id` is the drift column — exactly the column the gap relies on.

---

## B. Every DocumentUpload read / by-id-load site

Service: `backend/src/modules/document-processing/document-processing.service.ts`
(`documentUploadRepository` is the only handle; injected `@InjectRepository`).

| # | Site (line) | Method | Kind | Current gate | Scope |
|---|---|---|---|---|---|
| 1 | 250 `findOne({id})` | `pollAndAdvance(docId, orgId)` | by-id load | **walled** — `findInOrg(doc.contract_id, orgId)` after load (Tier 2) | request-scoped, **metering-coupled** (commit/release) |
| 2 | 629 `find({contract_id})` | `getDocuments(contractId, orgId)` | list | **walled** — `findInOrg(contractId, orgId)` before load (Tier 2) | request-scoped, clean |
| 3 | 644 `findOne({id})` | `getDocumentStatus(docId, orgId)` | by-id load | **walled** — `findInOrg(doc.contract_id, orgId)` after load | request-scoped, **DEAD** (no caller) |
| 4 | 664 `findOne({id, organization_id})` | `updateExtractedText(docId, orgId, text)` | by-id load + write | **DENORM-ONLY** — `organization_id = orgId`, NO `findInOrg` | request-scoped, **THE GAP** |
| 5 | 702 `findOne({id})` | `reprocess(docId, orgId)` | by-id load | **walled** — `findInOrg(doc.contract_id, orgId)` after load (Tier 1) | request-scoped, **metering-coupled** (release prior + reserve new) |

The remaining `documentUploadRepository` usages (163 `create`, 178/226/234/280/
322/335/386/555/563/671/794 `save`) are **writes on an already-loaded or
freshly-created entity** — not load sites. They stay on the bare repo (the
scoped repo is a load chokepoint; saves operate on the loaded entity, exactly as
S2c-2 obligations `update`/`complete` save the scoped-then-loaded row).

`uploadAndProcess` (85) **creates** a doc (no by-id load) behind the Tier 1 wall
+ metering reserve — nothing to scope.

### B.1 `updateExtractedText` — the gap, quoted (service.ts:659-672)

```ts
async updateExtractedText(docId: string, orgId: string, text: string): Promise<DocumentUpload> {
  const doc = await this.documentUploadRepository.findOne({
    where: { id: docId, organization_id: orgId },   // ← DENORM gate ONLY
  });
  if (!doc) {
    throw new NotFoundException('Document not found');
  }
  doc.extracted_text = text;
  return this.documentUploadRepository.save(doc);
}
```

Confirmed: gates ONLY on the denormalized `organization_id = orgId`. There is
**no `contractAccess.findInOrg`** anywhere in this method. Its controller route
`PUT /contracts/:contractId/documents/:docId/extracted-text`
(`document-processing.controller.ts:90`) is **live** (no other backend method
named so). It is the only request-scoped DocumentUpload mutation whose tenancy
authority is the drift column.

---

## C. The metering coupling — pollAndAdvance & reprocess

The `upload_extraction` reserve→extract→reconcile lifecycle (reservation_id) is
load-bearing, proven live against real Postgres (PR #53). The two by-id reads
that live inside the async reconcile:

- **`pollAndAdvance(docId, orgId)`** — `findOne({id})` (250) → wall (260) → reads
  `doc.processing_status` / `doc.processing_job_id`, advances the pipeline, and
  on terminal SUCCESS calls `commitReservationOnSuccess(doc)` (393) / on terminal
  FAILURE / parked-HUMAN_REVIEW calls `releaseReservationOnFailure(doc)`
  (285, 329).
- **`reprocess(docId, orgId)`** — `findOne({id})` (702) → wall (710) → releases
  any prior reservation (739) → `metering.reserve(...)` new (746) → overwrites
  `doc.reservation_id` (793) → save → `startTextExtraction`.

**Is the by-id load mechanically separable from reserve/commit/release?**
Mechanically, *yes* — the metering helpers
(`releaseReservationOnFailure(doc)` / `commitReservationOnSuccess(doc)`) read
only `doc.reservation_id` and `doc.id` (verified at service.ts:1540-1608); the
reserve in reprocess reads `doc.contract_id` / `doc.uploaded_by`. The loaded
entity's shape is identical whether loaded via bare `findOne` or via the scoped
repo (the scoped query `innerJoin`s for filtering, not selecting — all columns
present). The tenancy check (`findInOrg`) is a *separate* call, NOT fused into
the metering state machine.

**But the practical entanglement is the metering TEST SURFACE.** The
`upload_extraction` reserve/commit/release assertions live in
`document-processing.service.access-wall.spec.ts` (the reprocess "release-prior
fix" test at lines 269-347 mocks `documentUploadRepository.findOne` to return a
doc carrying `reservation_id: OLD_RES`, then asserts the release→reserve
ordering and that the persisted doc carries `NEW_RES`). Scoping reprocess's load
would force that mock off `documentUploadRepository.findOne` and onto the scoped
repo — i.e. **editing the metering spec's load mocking**, which the bucket
mandate forbids ("keep every metering spec byte-identical green"). Same hazard
for `pollAndAdvance` (its reconcile branches are exercised through the same
construction surface).

**DECISION: STOP-defer scoping `pollAndAdvance` and `reprocess`.** Both are
ALREADY walled (`findInOrg` on the canonical `doc.contract_id`), so they have no
Phase-1 gap. Scoping them is gated on the metering-byte-identical constraint and
is not worth risking the load-bearing reservation lifecycle for a second
defense-in-depth layer on already-walled paths. They are explicitly out of scope
for this bucket; a future bucket can scope them together with a deliberate
re-aim of the upload_extraction metering spec.

---

## D. `getDocumentStatus` — DEAD

The **service** method `getDocumentStatus` (service.ts:643) has **zero
callers**. The controller route `GET …/documents/:docId/status`
(controller.ts:69) is named `getDocumentStatus` but calls
`pollAndAdvance(docId, orgId)`, not the service method. The reads-access-wall
spec already documents it as "the dead-code path (defence in depth)…controller
routes go through pollAndAdvance." → **Do NOT wire it.** Flagged for removal in a
separate cleanup (out of scope here — removing it would also touch the
reads-access-wall spec's dead-code coverage; not a tenancy change).

---

## E. System / no-orgId coupling check

No DocumentUpload read is shared with a no-orgId / system caller. The document
*processing pipeline* (`startTextExtraction`, `startClauseExtraction`,
`pollAndSaveRisks`, `pollAndSaveConflicts`, `createClausesFromExtraction`)
operates on an already-loaded `doc` passed in by the request-scoped entry points
— it does not perform its own by-id DocumentUpload load. There is no background
sweeper reading `document_uploads` (unlike the obligation reminder processor).
So there is no `findAcrossAllOrgs` system-bypass need for this entity.

---

## F. Blast radius for a constructor signature change

`grep` confirms `DocumentProcessingService` is **NOT injected into any service or
controller outside its own module** (only mention elsewhere is a comment in
`document-upload.entity.ts`). So adding a constructor dependency has **no
production blast radius** beyond the module. The only impact is the four spec
construction sites:

| Spec | Constructs via | Tests | Touched by a new dep? |
|---|---|---|---|
| `…access-wall.spec.ts` | positional `new` ×3 + `build()` | uploadAndProcess, reprocess, finalizeReview — **upload_extraction metering** | must stay byte-identical |
| `finalize-review-metering.spec.ts` | NestJS DI | finalizeReview, pollAndSaveRisks — **finalize_review metering** | must stay byte-identical |
| `ai-risk-writer-integration.spec.ts` | NestJS DI | pollAndSaveRisks only | must stay byte-identical |
| `…reads-access-wall.spec.ts` | positional `build()` | getDocuments, pollAndAdvance, getDocumentStatus, getClausesForReview — **wall spec** | re-aim getDocuments block |

### F.1 Dependency style decision — `@Optional()` (deviation from house, justified)

House style (S2c-2, S2d) injects the scoped repo as a **required** constructor
dep. A required dep here would force the metering specs (access-wall +
finalize-review-metering) AND ai-risk-writer to gain a provider/13th-arg —
**violating the byte-identical-metering-specs mandate.**

To honor that mandate, `DocumentUploadScopedRepository` is injected as an
**`@Optional()` constructor parameter** (`documentScoped?:
DocumentUploadScopedRepository`). Production registers it in the module (it is
never actually undefined in prod), but:
- positional `new(...12)` calls in the metering specs still compile (13th =
  undefined), and those specs exercise no scoped method → **byte-identical**;
- DI specs that don't provide it resolve `undefined` via `@Optional()` → those
  specs exercise no scoped method → **byte-identical**.

The only spec re-aimed is `reads-access-wall.spec.ts` (a wall spec, sanctioned
by the bucket: "Re-aim wall specs whose 'repo never queried' moves to the scoped
layer; keep a live wall-denial assertion"). Trade-off: a missing module
registration would 500 at runtime (fail-safe crash, not a tenancy leak — the
wall still gates) rather than fail at boot. This deviation is the deliberate
price of byte-identical metering specs and is documented here + at the injection
site.

---

## G. Per-method plan

| Method | Plan | Why |
|---|---|---|
| `updateExtractedText` | **WALL (Phase 1) then SCOPE (Phase 2)** | the denorm-only gap; wall first (canonical `findInOrg`), then scoped layer underneath — never the forbidden denorm→canonical swap |
| `getDocuments` | **SCOPE-only (Phase 2)** | already walled; route the list `find` through `scopedFind({contract_id}, orgId, {order})` |
| `getDocumentStatus` | **LEAVE (dead)** | no caller; do not wire dead code; flag for removal separately |
| `pollAndAdvance` | **DEFER (STOP)** | already walled; metering-test-surface entanglement → scoping risks byte-identical metering |
| `reprocess` | **DEFER (STOP)** | already walled; metering-test-surface entanglement (release-prior reserve lifecycle) |
| `uploadAndProcess` | **LEAVE** | creates (no by-id load); already walled + reserve |

Outcome: the one tenancy GAP (`updateExtractedText`) is walled then scoped; the
one other clean request-scoped load (`getDocuments`) is scoped; the
metering-entangled and dead paths are left, with reasons.
