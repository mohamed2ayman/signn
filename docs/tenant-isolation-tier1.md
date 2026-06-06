# Tenant-Isolation Tier 1 — "Stop the Bleeding" PR

**Branch:** `fix/tenant-isolation-tier1`
**Base:** `main` @ `680427a` (Phase 7.18 Part 2 doc commit)
**Class:** same as PR #42 / PR #45 (`ContractAccessService` + 404-no-existence-leak)
**Scope:** the highest-blast cross-tenant gaps from the access-wall sweep
(`docs/step3-remaining-audit.md` + the Step 0 inventory) — WRITES + AI dispatch
only. This is **Option A — interim, before the Option B scoped-repository
refactor.** Per Ayman's framing, these walls are intentionally kept as
defense-in-depth even after Option B lands.

## What this PR closes

10 routes across 4 modules (2 Class A controller-level + 3 Class B service-level
groupings). All carry the same observable behaviour for in-org callers and
all throw `NotFoundException` (404, NOT 403 — no existence leak) on cross-
tenant probe. Same `ContractAccessService.findInOrg(contractId, orgId)` shape
as PR #45 / commit `54a3959`.

### Class A — controller-level wall on `body.contract_id`

| Route | File | Wall site |
|---|---|---|
| `POST /ai/risk-analysis` | `backend/src/modules/ai/ai.controller.ts` | `assertContractInCallerOrg` helper |
| `POST /ai/summarize` | same | same |
| `POST /ai/extract-obligations` | same | same |
| `POST /ai/detect-conflicts` | same | same |
| `POST /ai/chat` (when `body.contract_id` present) | same | conditional `assertContractInCallerOrg` |
| `POST /chat/sessions` (when `dto.contract_id` present) | `backend/src/modules/chat/chat.controller.ts` | conditional `assertContractInCallerOrg` |

`POST /chat/sessions/:id/messages` inherits the wall transitively — a session
can no longer reach the store carrying a cross-tenant `contract_id`.

### Class B — service-level wall via `contractAccess.findInOrg(contractId, orgId)`

| Route | File | Wall site |
|---|---|---|
| `POST /contracts/:contractId/documents` | `document-processing.service.ts:uploadAndProcess` | top of method, replaces the bare `findOne({id})` |
| `POST /contracts/:contractId/documents/:docId/reprocess` | `document-processing.service.ts:reprocess` | new `orgId` param; walks doc → contract → org |
| `POST /contracts/:contractId/review/finalize` | `document-processing.service.ts:finalizeReview` | top of method; fires BEFORE qb + AI dispatch (highest blast) |
| `PUT /contracts/:id/clauses/:clauseId` | `contracts.service.ts:updateContractClause` | new `orgId` param; wall fires first |
| `DELETE /contracts/:id/clauses/:clauseId` | `contracts.service.ts:removeClause` | same |
| `PUT /contracts/:id/clauses/reorder` | `contracts.service.ts:reorderClauses` | same |
| `POST /contracts/:id/versions` | `contracts.service.ts:saveNewVersion` | wall fires before `createVersionSnapshot` |
| `PUT /contracts/:id/comments/:commentId/resolve` | `contracts.service.ts:resolveComment` | same |
| `DELETE /contracts/:id/comments/:commentId` | `contracts.service.ts:deleteComment` | same — closes the admin-bypass cross-org delete |

## Red-before / green-after evidence

A scratch spec (`backend/src/_step0_exploit_proof.spec.ts` — written, run, then
deleted before commit) demonstrated the live exploit on the pre-fix tree by:

1. **Class A (`POST /ai/risk-analysis`):** mocked `AiService`, called
   `AiController.triggerRiskAnalysis({ contract_id: <org-B contract>, ... }, <org-A>)`
   and asserted `ai.triggerRiskAnalysis` was called with `org_id: <org-A>` — i.e.
   AI dispatch SUCCEEDED under the attacker's org against a foreign contract.
   The scratch test PASSED on `main` (confirming the gap).
2. **Class B (`DocumentProcessingService.uploadAndProcess`):** stubbed the
   contract repo to return an org-B contract, called `uploadAndProcess(<org-B
   contract>, file, <user-A>, <org-A>, {})` and asserted
   `documentUploadRepository.save` was called with
   `{ contract_id: <org-B>, organization_id: <org-A> }` — a foreign contract
   was now linked to a document upload under the attacker's org. The scratch
   test PASSED on `main`.

After the fix, the inverted assertions (in the four permanent specs below)
PASS: `findInOrg` is the gate; AI dispatch / storage upload / row save are
all skipped on a cross-tenant probe.

## Tests

Four new permanent spec files under the canonical PR #45 shape (38 tests
across them — every Tier 1 route gets a `cross-tenant: 404 + downstream is
NEVER called` assertion + a `happy path: in-org access still succeeds`
assertion, plus the appropriate no-org / unscoped / admin-bypass variants):

- `backend/src/modules/ai/tests/ai.controller.access-wall.spec.ts` —
  16 tests covering the 4 mandatory-`contract_id` AI endpoints + the 3
  conditional cases on `/ai/chat` + 2 confirmation specs for the
  intentionally-out-of-scope `/ai/diff` and `/ai/research`.
- `backend/src/modules/chat/tests/chat.controller.access-wall.spec.ts` —
  4 tests covering the `POST /chat/sessions` entry point + no-org and
  unscoped variants.
- `backend/src/modules/document-processing/tests/document-processing.service.access-wall.spec.ts` —
  6 tests covering `uploadAndProcess`, `reprocess`, and `finalizeReview`
  (including the critical-path "no AI dispatch on cross-tenant finalize"
  assertion).
- `backend/src/modules/contracts/tests/contracts.service.access-wall.spec.ts` —
  12 tests covering the 6 contract-write paths, including the
  `deleteComment` admin-bypass-now-walled case.

### One existing spec patched for the new DI

`backend/src/modules/risk-analysis/services/tests/ai-risk-writer-integration.spec.ts`
builds `DocumentProcessingService` via `Test.createTestingModule` and now
needs `ContractAccessService` in its provider list — a no-op stub
(`findInOrg` resolves to `{}`) is sufficient because the spec exercises
`pollAndSaveRisks`, not the walled entry points.

### Suite totals (post-fix)

- **Full backend suite:** `Test Suites: 2 skipped, 44 passed, 44 of 46 total; Tests: 20 skipped, 464 passed, 484 total`
- The 20 skipped tests are the pre-existing real-Postgres metering specs
  (`metering-race.spec.ts` + `metering-resolver.spec.ts` — CI-skip per
  metering PR #46; **NOT** related to this PR).
- The 4 new specs add 38 tests; the patched integration spec keeps its
  existing 10.

### Typecheck

`npx tsc --noEmit` exits 0.

## What this PR does NOT touch (out of scope by design)

Tier 1 strict — the routes below are documented for the follow-up tier and
are intentionally NOT included here. They each require either a different
fix shape (architecture decision) or are READ paths that fall under Tier 2/3:

### EXCLUDED — Class C bypass-role architecture decision (Group 3 from the sweep)

These routes have a **PARTIAL** wall via `PermissionLevelGuard` + the
Phase 7.15 `ResolveObligationProjectMiddleware`. Non-bypass roles are
blocked by the ProjectMember check, but `OWNER_ADMIN / SYSTEM_ADMIN /
OPERATIONS` bypass the guard entirely — leaving a cross-org gap for those
bypass roles only. Closing it requires a guard-level change (org-scope the
bypass check) OR layering `findInOrg` on every route. That is an Option B
design decision, not a Tier 1 fix:

- `GET /contracts/:contractId/obligations`
- `PATCH /contracts/:contractId/obligations/:obligationId`
- `GET /contracts/:contractId/obligations/ical`
- `POST /contracts/:contractId/obligations/:obligationId/assign`
- `DELETE /contracts/:contractId/obligations/:obligationId/assign/:userId`
- `PUT /contracts/:contractId/obligations/:obligationId/evidence`
- `GET /contracts/:contractId/obligations/:obligationId/reminders`
- `POST /contracts/:id/initiate-signature` (docusign — same bypass shape)
- `GET /contracts/:id/signing-url`
- `GET /contracts/:id/signature-status`

CLAUDE.md's Phase 7.15 description "validates that the contract belongs to
the requesting user's organization" **overstates** what the middleware
actually does — the middleware only resolves `project_id` for the guard;
no org check is performed in the middleware itself. Flag for a doc fix in
the Option B PR or a separate cleanup PR.

### EXCLUDED — Tier 2 (mechanical READ leaks)

Same fix shape as Class B but lower blast (read-only data leakage, not
mutation or AI spend). To be closed in a follow-up small PR per service:

- `GET /contracts/:contractId/documents` (document-processing)
- `GET /contracts/:contractId/documents/:docId/status`
- `GET /contracts/:contractId/review/clauses`
- `GET /contracts/:id/clauses` (contracts)
- `GET /contracts/:id/versions`, `versions/milestones`, `versions/:versionId`, `versions/:a/compare/:b`
- `GET /contracts/:id/comments`
- `GET /contracts/:id/responses`
- `GET /contracts/:id/approvers`
- `GET /risk-analysis/contract/:contractId` + `summary`
- `GET /obligations/contract/:contractId` + `dashboard?contract_id=`
- `GET /claims?contract_id=` + `POST /claims`
- `GET /notices?contract_id=` + `POST /notices`
- `GET /subcontracts?main_contract_id=` + `POST /subcontracts`
- `GET /export/contracts/:id/pdf`, `/risk-report`, `/summary`
  (claims/notices/subcontracts POST routes write data but the fix shape is
  identical to the contracts service-level pattern in this PR; deferred
  for batch cohesion)

### EXCLUDED — Tier 3 (auxiliary find-after-write paths)

These are downstream of the WALLED contract-comment write paths or use
their own author/state checks; defer to follow-up.

- `PATCH /contracts/:id/comments/:commentId` (`updateComment` — has author-only check; cross-org write blocked transitively)

### EXCLUDED — non-`contractId` cross-tenant variants

- `POST /contracts` (body has `project_id` only; cross-tenant project gap is a
  separate class — needs a `ProjectAccessService` mirror, not the contract wall)

### EXCLUDED — clause-keyed paths (different class entirely)

The `:clauseId`-keyed mutations in `contracts.controller.ts` are walled by
this PR because they go through `updateContractClause(contractId, …)`. The
standalone `clauses.controller.ts` operates on clauses by their own UUID +
explicit `orgId` and is already correctly scoped — no change needed.

## Composability with Option B

The Option B refactor will likely centralize all org-scoped contract loads
through a scoped repository / interceptor. The walls added in this PR are
defense-in-depth on top of that — per Ayman's framing, they are explicitly
kept after Option B lands. The same `ContractAccessService.findInOrg` call
is the single chokepoint; Option B can later substitute its
scoped-repo-resolver behind that same call without touching the call sites
added here.

## This PR also unblocks

- The §C7 metering prerequisite for `risk` and `ai_assistant_message`
  consumer wiring (per `docs/step3-remaining-audit.md` §B — Phase 7.18
  Part 3). With Class A walled, the AI dispatch path now satisfies "metered
  route must have a verified contract-access wall first."
- `POST /contracts/:contractId/documents` access-wall is the prerequisite
  for the future `upload_extraction` metering consumer wire (the highest
  strategic value meter per the audit).

## Git scope

Only access-control files touched. No metering, no engine, no CLAUDE.md /
lessons.md changes. `docs/tenant-isolation-tier1.md` is the only doc note;
the four `*.access-wall.spec.ts` files are the permanent tests. The
scratch `_step0_exploit_proof.spec.ts` was removed after recording the
red-before / green-after evidence (the same assertions live in the
permanent specs).
