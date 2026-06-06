# Tenant-Isolation Tier 2 — Cross-Tenant READ Leaks PR

**Branch:** `fix/tenant-isolation-tier2`
**Base:** local commit `82f7b7b` (Tier 1) on top of `main @ 680427a`
**Class:** same as PR #42 / PR #45 / Tier 1 (`ContractAccessService` +
404-no-existence-leak)
**Scope:** the unwalled contract-scoped READ routes from the access-wall
sweep (`docs/tenant-isolation-tier1.md` OUT-OF-SCOPE Tier 2 list). No
mutation paths, no AI dispatch — pure data leakage. **Interim-before-
Option-B; walls explicitly kept as defense-in-depth per Ayman.**

## True-key-per-route table (Step 0)

The "true scoping key" is what the wall must authorize. URL `:contractId`
segments are only trusted when the service actually uses them (PR #45
lesson — never wall on a URL parameter the service discards).

| # | Route | True scoping key | Service handler |
|---|---|---|---|
| 1 | `GET /export/contracts/:id/pdf` | URL `:id` (contractId direct) | `ExportService.generateContractPdf` |
| 2 | `GET /export/contracts/:id/risk-report` | URL `:id` (contractId direct) | `ExportService.generateRiskReport` |
| 3 | `GET /export/contracts/:id/summary` | URL `:id` (contractId direct) | `ExportService.generateContractSummary` |
| 4 | `GET /contracts/:contractId/documents` | URL `:contractId` (direct) | `DocumentProcessingService.getDocuments` |
| 5 | `GET /contracts/:contractId/documents/:docId/status` | **CHILD-keyed (`:docId`)** — service walks `doc.contract_id → findInOrg(_, orgId)`; URL `:contractId` is discarded by the handler | `DocumentProcessingService.pollAndAdvance` |
| 6 | `GET /contracts/:contractId/review/clauses` | URL `:contractId` (direct) | `DocumentProcessingService.getClausesForReview` |
| 7 | `GET /risk-analysis/contract/:contractId` | URL `:contractId` (direct) | `RiskAnalysisService.getByContract` |
| 8 | `GET /risk-analysis/contract/:contractId/summary` | URL `:contractId` (direct) | `RiskAnalysisService.getRiskSummary` |
| 9 | `GET /obligations/dashboard?contract_id=...` | Query `contract_id` (direct, **conditional**) | `ObligationsService.getDashboard` |
| 10 | `GET /contracts/:id/clauses` | URL `:id` (direct) | `ContractsService.getContractClauses` |
| 11 | `GET /contracts/:id/versions` | URL `:id` (direct) | `ContractsService.getVersions` |
| 12 | `GET /contracts/:id/versions/milestones` | URL `:id` (direct) | `ContractsService.getMilestoneVersions` |
| 13 | `GET /contracts/:id/versions/:versionA/compare/:versionB` | URL `:id` direct (versions are double-checked by service's `contract_id` join) | `ContractsService.compareVersions` |
| 14 | `GET /contracts/:id/versions/:versionId` | URL `:id` direct (same `contract_id` join) | `ContractsService.getVersion` |
| 15 | `GET /contracts/:id/comments` | URL `:id` (direct) | `ContractsService.getComments` |
| 16 | `GET /contracts/:id/responses` | URL `:id` (direct) | `ContractsService.getContractorResponses` |
| 17 | `GET /contracts/:id/approvers` | URL `:id` (direct) | `ContractsService.getApprovers` |

Plus: **`getDocumentStatus(docId, orgId)`** — dead code at the routing
layer (the controller calls `pollAndAdvance`, not `getDocumentStatus`), but
walled with the same `doc → contract → org` walk for defense-in-depth.

## Sweep classification — Moved OUT of Tier 2

| Route | Reason | New home |
|---|---|---|
| `GET /obligations/contract/:contractId` | PLG-entangled via Phase 7.15 `ResolveObligationProjectMiddleware` + `@RequirePermission(VIEWER)`. Non-bypass users walled by ProjectMember check; OWNER_ADMIN / SYSTEM_ADMIN / OPERATIONS bypass leaves the cross-org gap — same shape as `compliance-obligations` Group 3. Forcing `findInOrg` would patch the guard rather than fix it. | Class-C (Option B guard-architecture decision) |

## Red-before leak evidence

A scratch spec (`backend/src/_step0_tier2_leak_proof.spec.ts` — written,
run, deleted before commit) demonstrated two representative leaks on
**Tier 1 base** (`82f7b7b`):

1. **contractId-direct — `GET /export/contracts/:id/pdf`:** Mocked
   `ExportService`, called
   `ExportController.exportContractPdf(<org-B contract>, res)` and asserted
   `exportService.generateContractPdf` was called for the foreign id and
   `res.end` was called with the foreign PDF bytes. **PASSED on Tier 1
   base** — any authenticated user could download any org's contract PDF.

2. **CHILD-keyed — `getDocumentStatus(docId)`:** Stubbed the
   `documentUploadRepository.findOne` to return the org-B DocumentUpload
   row, called `getDocumentStatus(<org-B docId>)` with no orgId, asserted
   the foreign doc record (`file_name`, `processing_status`,
   `organization_id: 'org-B'`) was returned. **PASSED on Tier 1 base** —
   the URL's `:contractId` segment is discarded by the service entirely.

After the fix, the inverted assertions in the five permanent specs below
PASS: `findInOrg` is the gate; the underlying repos are never read for a
cross-tenant probe.

## Fix per shape

### Controller-level wall (export only)

- New module dep: `ContractsModule` exported into `ExportModule`.
- `ExportController` gains `ContractAccessService` injection + an
  `assertContractInCallerOrg(contractId, orgId)` helper (same shape as
  Tier 1 ai/chat + PR #45's compliance helper). Fires BEFORE
  `ExportService.generate*` runs.
- ExportService internals untouched — internal callers (e.g. DocuSign
  envelope rendering) still go directly through the service without
  routing through the wall. The wall lives at the public surface only.

### Service-level wall (`contractAccess.findInOrg(contractId, orgId)`)

- `DocumentProcessingService` (already injects `ContractAccessService`
  from Tier 1): `getDocuments`, `pollAndAdvance` (CHILD-keyed),
  `getDocumentStatus` (CHILD-keyed; dead-code defence-in-depth),
  `getClausesForReview`. Controller threads `@OrganizationId()` to each.
- `RiskAnalysisService` (new injection): `getByContract`, `getRiskSummary`.
  `RiskAnalysisModule` imports `ContractsModule`.
- `ObligationsService` (new injection): `getDashboard` — wall is
  **conditional** (only when `contract_id` is supplied; org-wide path
  unchanged). `ObligationsModule` imports `ContractsModule`. The sibling
  route `GET /obligations/contract/:contractId` is moved to Class-C
  (above).
- `ContractsService` (already injects `ContractAccessService`):
  `getContractClauses`, `getVersions`, `getMilestoneVersions`, `getVersion`
  (URL `:id` is the wall key; the existing `contract_id` join in the
  version load still enforces version-belongs-to-contract),
  `compareVersions` (outer wall + the two inner `getVersion` calls each
  re-wall — failures fast in either order), `getComments`,
  `getContractorResponses`, `getApprovers`. Internal calls of
  `getApprovers(contractId)` from `requestApproval` / `reviewApproval`
  pass through their existing `orgId` (those methods already walled in
  Tier 1).

## Tests

Five new permanent spec files under the same shape as Tier 1's
`*.access-wall.spec.ts` (cross-org → 404 + in-org → success + no-org +
where applicable a CHILD-keyed cross-tenant case proving the
`child → contract → org` resolution):

- `backend/src/modules/export/tests/export.controller.access-wall.spec.ts`
  — 12 tests covering the 3 export routes (PDF, risk-report, summary in
  both PDF and JSON formats).
- `backend/src/modules/document-processing/tests/document-processing.service.reads-access-wall.spec.ts`
  — 7 tests covering `getDocuments`, `pollAndAdvance`, `getDocumentStatus`
  (with explicit `doc.contract_id`-walks-NOT-URL-contractId assertion for
  the CHILD-keyed paths), `getClausesForReview`.
- `backend/src/modules/risk-analysis/tests/risk-analysis.service.reads-access-wall.spec.ts`
  — 4 tests covering `getByContract` and `getRiskSummary`.
- `backend/src/modules/obligations/tests/obligations.service.reads-access-wall.spec.ts`
  — 3 tests covering `getDashboard` with + without `contract_id` query.
- `backend/src/modules/contracts/tests/contracts.service.reads-access-wall.spec.ts`
  — 11 tests covering all 8 contracts-service read side-paths (including
  the inner-getVersion contract_id-join assertion in `getVersion`).

### Suite totals (post-fix)

- **Full backend suite:** `Test Suites: 2 skipped, 49 passed, 49 of 51 total; Tests: 20 skipped, 498 passed, 518 total`
- Delta from Tier 1 base (464 passed): **+34**, exactly matching the new
  spec count. No regressions.
- The 20 skipped tests are the pre-existing real-Postgres metering specs
  (`metering-race.spec.ts` + `metering-resolver.spec.ts` — CI-skip per
  metering PR #46; unrelated to this PR).

### Typecheck

`npx tsc --noEmit` exits 0.

## What this PR does NOT touch (running OUT-OF-SCOPE list)

### EXCLUDED — Tier 3 mechanical reads (next bucket)

Same fix shape as Tier 2 but lower priority (mostly per-contract list
endpoints in claims / notices / subcontracts and one-shot reads in
claims/notices on individual entities). These also include a few
contract-scoped POST/PUT endpoints whose mutation behaviour is
constrained by status checks but still leak data on existence probe:

- `GET /claims?contract_id=...` + `POST /claims`
  (`claimsService.findAllByContract` / `claimsService.create`)
- `GET /notices?contract_id=...` + `POST /notices`
  (`noticesService.findAllByContract` / `noticesService.create`)
- `GET /subcontracts?main_contract_id=...` + `POST /subcontracts`
  (`subContractsService.findAllByMainContract` / `subContractsService.create`)
- `GET /claims/:id`, `PUT /claims/:id/*`, `POST /claims/:id/*` —
  child-id-keyed claim mutations with cross-tenant leak on claim id
- `GET /notices/:id`, `PUT /notices/:id/*`, `POST /notices/:id/*` —
  child-id-keyed notice mutations
- `GET /subcontracts/:id`, `PUT /subcontracts/:id`, etc. — same shape
- `GET /risk-analysis/clause/:clauseId` and the `:id/status` mutation —
  child-id-keyed (clauseId → contract / risk-id → contract); they fit
  Tier 3 sibling shape

The POST endpoints (claims/notices/subcontracts create) are sibling
WRITES of the same shape and should land together for module cohesion;
they were excluded from Tier 1 (different domain modules) and now group
naturally with the corresponding Tier 3 reads.

### EXCLUDED — Class C (PLG-bypass-role gap; folds into Option B)

These routes have a **PARTIAL** wall via `PermissionLevelGuard` +
domain-specific middleware. Non-bypass roles are blocked by the
ProjectMember check; `OWNER_ADMIN / SYSTEM_ADMIN / OPERATIONS` bypass
leaves the cross-org gap. Forcing `findInOrg` would paper over a guard-
design problem rather than fix it; the Option B refactor will address
PLG's bypass scoping centrally.

- `GET /obligations/contract/:contractId` ← **moved out of Tier 2 in
  this PR** (Phase 7.15 middleware + PLG)
- `GET /contracts/:contractId/obligations` and its 6 sibling
  mutations (compliance-obligations)
- `POST /contracts/:id/initiate-signature`, `GET /contracts/:id/signing-url`,
  `GET /contracts/:id/signature-status` (docusign)

CLAUDE.md's Phase 7.15 description ("validates that the contract belongs
to the requesting user's organization") still **overstates** what the
`ResolveObligationProjectMiddleware` actually does — it only resolves
`project_id` for PLG; no org check is performed in the middleware
itself. Flag for a doc fix in the Option B PR.

### EXCLUDED — non-`contractId` cross-tenant variants

- `POST /contracts` (body carries `project_id`, not `contract_id`) —
  cross-tenant project gap is a separate class (needs a
  `ProjectAccessService` mirror).
- Clause-keyed paths in `clauses.controller.ts` — already correctly
  org-scoped (each method takes explicit `orgId`).

## Composability with Option B

Same posture as Tier 1: Option B will likely centralize org-scoped
contract loads through a scoped repository / interceptor. The walls
added here are defence-in-depth on top of that — kept after Option B
lands per Ayman's framing. The single chokepoint is
`ContractAccessService.findInOrg`; Option B can later substitute its
scoped-repo-resolver behind that same call without touching the call
sites added here.

## Git scope

Only Tier 2 access-control files touched:

- **5 source modules + entry points modified:**
  - `export.module.ts`, `export.controller.ts`
  - `document-processing.service.ts`, `document-processing.controller.ts`
  - `risk-analysis.module.ts`, `risk-analysis.service.ts`, `risk-analysis.controller.ts`
  - `obligations.module.ts`, `obligations.service.ts`, `obligations.controller.ts`
  - `contracts.service.ts`, `contracts.controller.ts`
- **5 new permanent spec files** (one per fixed module).
- **`docs/tenant-isolation-tier2.md`** — this file.

Explicitly NOT touched: Tier 1 walls (the prior commit), metering, the
engine, the Class-C routes, `CLAUDE.md` / `lessons.md`.
