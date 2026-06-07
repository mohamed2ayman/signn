# Tenant-Isolation Tier 3 — Claims / Notices / Subcontracts PR

**Branch:** `fix/tenant-isolation-tier3` (working tree on `main`)
**Base:** `main` @ `6d3c9d6` (Tier 2 — wall cross-tenant READ leaks, PR #51)
**Class:** same as PR #42 / PR #45 / Tier 1 / Tier 2 (`ContractAccessService` +
404-no-existence-leak)
**Scope:** the remaining unwalled contract-scoped routes in claims /
notices / subcontracts from the access-wall sweep — **reads AND their
sibling create-POSTs together**, per the Option A interim posture.
Walls explicitly kept as defense-in-depth per Ayman.

This PR **closes the Option-A triage**. After it ships, the only
contract-scope routes without a `findInOrg` wall are: Class-C
(PLG-bypass-role guard fix) and the `POST /contracts` `project_id` gap
— both architectural, not mechanical. See "FINAL out-of-scope list"
below.

## Routes fixed (6) — true scoping key + PLG reality per route (Step 0)

The "true scoping key" is the field the service actually loads the
contract on. URL segments are only trusted when the service uses
them (PR #45 lesson). PLG reality is what
`PermissionLevelGuard.canActivate()` actually does for each route on
the current main — based on its check at
[permission-level.guard.ts:71–81](backend/src/common/guards/permission-level.guard.ts:71):
it resolves `projectId` from `params.project_id || params.id ||
query.project_id || body.project_id`, and **returns `true`
(fall-through) when none of those match**.

| # | Route | True scoping key | Service handler | PLG reality on current main |
|---|---|---|---|---|
| 1 | `POST /claims` | Body `contract_id` | `ClaimsService.create` ([claims.service.ts:48](backend/src/modules/claims/claims.service.ts)) | `@RequirePermission(EDITOR)` is set, but body carries `contract_id` (not `project_id`). PLG falls through (no `projectId` resolvable) → returns `true`. **MISSING-WALL.** |
| 2 | `GET /claims?contract_id=` | Query `contract_id` | `ClaimsService.findAllByContract` ([claims.service.ts:88](backend/src/modules/claims/claims.service.ts)) | `@RequirePermission(VIEWER)` is set, query carries `contract_id` (not `project_id`). PLG falls through. **MISSING-WALL.** |
| 3 | `POST /notices` | Body `contract_id` | `NoticesService.create` ([notices.service.ts:47](backend/src/modules/notices/notices.service.ts)) | Same fall-through shape as #1. **MISSING-WALL.** |
| 4 | `GET /notices?contract_id=` | Query `contract_id` | `NoticesService.findAllByContract` ([notices.service.ts:89](backend/src/modules/notices/notices.service.ts)) | Same fall-through shape as #2. **MISSING-WALL.** |
| 5 | `POST /subcontracts` | Body `main_contract_id` (confirmed: `sub_contract.main_contract_id → contracts.id` at [sub-contract.entity.ts:17](backend/src/database/entities/sub-contract.entity.ts:17)) | `SubContractsService.create` ([subcontracts.service.ts:24](backend/src/modules/subcontracts/subcontracts.service.ts)) | **No `@RequirePermission` decorator on the route.** PLG short-circuits at the `if (!requiredLevel) return true` branch — never even gets to the projectId check. **MISSING-WALL.** |
| 6 | `GET /subcontracts?main_contract_id=` | Query `main_contract_id` (same FK) | `SubContractsService.findAllByMainContract` ([subcontracts.service.ts:58](backend/src/modules/subcontracts/subcontracts.service.ts)) | Same as #5 — no decorator. PLG returns `true` immediately. **MISSING-WALL.** |

**All 6 are genuine MISSING-WALL routes (Tier 3 — fix with `findInOrg`).**
None are PLG-bypass-role shape (Class-C). The bypass roles
(`OWNER_ADMIN / SYSTEM_ADMIN / OPERATIONS`) aren't even relevant —
PLG short-circuits to `return true` for everyone on these routes,
before it ever reaches the bypass check or the ProjectMember check.

## Red-before leak evidence (Step 0)

A scratch spec (`backend/src/_step0_tier3_leak_proof.spec.ts` —
written, run, deleted before commit) demonstrated three
representative cross-tenant exploits on the **Tier 2-shipped main**
(`6d3c9d6`):

1. **Create-write (POST /claims):** Stubbed `contractRepo.findOne` to
   return an org-B contract row, called
   `ClaimsService.create({ contract_id: <org-B contract>, ... }, USER_A,
   ORG_A)`. Asserted `claimRepo.save` was called with
   `{ contract_id: <org-B>, org_id: <org-A>, submitted_by: USER_A,
   status: DRAFT }`. **PASSED on Tier 2 base** — attacker in org-A
   created a claim row on a victim org-B contract.

2. **List-read (GET /notices?contract_id=):** Stubbed
   `contractRepo.findOne` to return an org-B contract row, stubbed
   `noticeRepo.find` to return two victim org-B notices, called
   `NoticesService.findAllByContract(<org-B contract>)`. Asserted the
   returned array contained both victim notice rows (titles intact).
   **PASSED on Tier 2 base** — attacker received the victim org's
   notices verbatim.

3. **Create-write (POST /subcontracts), confirming the wall is keyed on
   `main_contract_id`:** Stubbed `contractRepo.findOne` to return an
   org-B contract, called
   `SubContractsService.create({ main_contract_id: <org-B>, ... },
   USER_A, ORG_A)`. Asserted `subContractRepo.save` was called with
   `{ main_contract_id: <org-B>, org_id: <org-A>, created_by: USER_A,
   status: DRAFT }`. **PASSED on Tier 2 base.**

Captured pre-fix output:

```
PASS src/_step0_tier3_leak_proof.spec.ts
  Tier 3 Step 0 — cross-tenant exploit on current main (PRE-FIX)
    ✓ POST /claims: attacker in org-A creates a claim on a victim org-B contract
    ✓ GET /notices?contract_id=: attacker reads notices on a victim org-B contract
    ✓ POST /subcontracts: attacker in org-A creates a subcontract on a victim org-B main_contract

Tests: 3 passed, 3 total
```

After the fix, the same three call shapes throw `NotFoundException`
because `contractAccess.findInOrg` is the gate; the underlying repos
are never read or written on a cross-tenant probe. Green-after is
proven by the inverted assertions in the three permanent specs below.

## Fix per service (service-level wall via `contractAccess.findInOrg`)

Same shape as Tier 2 service-level walls. `ContractAccessService` is
injected; the bare `contractRepo.findOne({ id })` is replaced by
`contractAccess.findInOrg(<contract id>, orgId)`. `orgId` is threaded
from the controller's `@OrganizationId()` (JWT) — never contract-
derived.

### claims
- `ClaimsModule` now imports `ContractsModule` (which exports
  `ContractAccessService` at
  [contracts.module.ts:51](backend/src/modules/contracts/contracts.module.ts:51)).
- `ClaimsService` gains a `ContractAccessService` constructor dep.
- `create(dto, userId, orgId)` — wall fires BEFORE the status gate and
  the sequence-number `count`. The unused `@InjectRepository(Contract)
  contractRepo` injection is left in place to keep scope strictly to
  access control (no constructor-positional churn).
- `findAllByContract(contractId, orgId)` — new `orgId` param; wall
  fires BEFORE the status gate.
- `claims.controller.ts` threads `@OrganizationId() orgId` on the
  `findAllByContract` route (`create` already had `orgId`).

### notices
- `NoticesModule` now imports `ContractsModule`.
- `NoticesService` gains a `ContractAccessService` constructor dep.
- `create(dto, userId, orgId)` — wall fires BEFORE the status gate.
- `findAllByContract(contractId, orgId)` — new `orgId` param; wall
  fires BEFORE the status gate AND the `checkOverdueNotices` side
  effect. Critical: the overdue scan must NOT touch the victim org's
  notice rows on a cross-tenant probe.
- `notices.controller.ts` threads `@OrganizationId() orgId` on the
  `findAllByContract` route.

### subcontracts
- `SubContractsModule` now imports `ContractsModule`.
- `SubContractsService` gains a `ContractAccessService` constructor
  dep.
- `create(dto, userId, orgId)` — wall is keyed on
  `dto.main_contract_id` (confirmed FK to `contracts.id` at
  [sub-contract.entity.ts:17](backend/src/database/entities/sub-contract.entity.ts:17)).
  Wall fires BEFORE the status gate, the sequence-number `count`, and
  the status-log side effect.
- `findAllByMainContract(mainContractId, orgId)` — new `orgId` param;
  wall fires BEFORE the status gate.
- `subcontracts.controller.ts` threads `@OrganizationId() orgId` on
  the `findAllByMainContract` route.

The wall is the **only behaviour change for in-org callers**: the
contract row it returns is what the existing status gates branch on.
Cross-tenant → 404 (NOT 403). No metering, no refactor beyond access
control.

## Tests

Three new permanent spec files under the canonical Tier 1/2 shape — 12
tests (3 services × {cross-tenant 404 + happy-path success} × {create
+ list}):

- `backend/src/modules/claims/tests/claims.service.access-wall.spec.ts`
  — 4 tests covering `create` (cross-tenant 404 + happy `CLM-NNN` save)
  and `findAllByContract` (cross-tenant 404 + happy contract-filtered
  list).
- `backend/src/modules/notices/tests/notices.service.access-wall.spec.ts`
  — 4 tests covering `create` (cross-tenant 404 + happy `NTC-NNN` save)
  and `findAllByContract` (cross-tenant 404 with explicit
  no-overdue-scan-touched assertion + happy list).
- `backend/src/modules/subcontracts/tests/subcontracts.service.access-wall.spec.ts`
  — 4 tests covering `create` (cross-tenant 404 with explicit
  no-status-log-touched assertion + happy `SC-NNN` save) and
  `findAllByMainContract` (cross-tenant 404 + happy list). The wall-
  on-`main_contract_id` assertion is explicit in both cross-tenant
  cases.

### Suite totals (post-fix)

- **Full backend suite:** `Test Suites: 2 skipped, 52 passed, 52 of 54 total; Tests: 20 skipped, 510 passed, 530 total`
- Delta from Tier 2 base (498 passed): **+12**, exactly matching the
  new spec count. No regressions.
- The 20 skipped tests are the pre-existing real-Postgres metering
  specs (`metering-race.spec.ts` + `metering-resolver.spec.ts` —
  CI-skip per metering PR #46; unrelated to this PR).

### Typecheck

`npx tsc --noEmit` exits 0.

## FINAL out-of-scope list — what remains after Tier 3

Tier 3 **closes the Option-A mechanical-wall triage**. Every
contract-scoped route surfaced by the access-wall sweep is now walled
by `ContractAccessService.findInOrg`, EXCEPT the two architectural
classes below. These require design decisions, not the same
mechanical fix.

### EXCLUDED — Class C (PLG-bypass-role guard fix; folds into Option B)

Routes with a **partial** wall via `PermissionLevelGuard` (and, for
obligations, the Phase 7.15 `ResolveObligationProjectMiddleware`).
Non-bypass roles are blocked by the ProjectMember check;
`OWNER_ADMIN / SYSTEM_ADMIN / OPERATIONS` bypass the guard entirely
and leave a cross-org gap for those bypass roles only. Forcing
`findInOrg` would paper over a guard-design problem rather than fix
it. Option B will address PLG's bypass scoping centrally.

- `GET /contracts/:contractId/obligations` and its 6 sibling
  mutations (compliance-obligations)
- `GET /obligations/contract/:contractId` (reclassified out of Tier 2)
- `POST /contracts/:id/initiate-signature`,
  `GET /contracts/:id/signing-url`,
  `GET /contracts/:id/signature-status` (docusign)

(CLAUDE.md's Phase 7.15 description still overstates what the
`ResolveObligationProjectMiddleware` does — it only resolves
`project_id` for PLG; no org check is performed in the middleware
itself. Flag for a doc fix in the Option B PR — same note as Tier 2.)

### EXCLUDED — non-`contractId` cross-tenant variants

- `POST /contracts` (body carries `project_id`, not `contract_id`).
  The cross-tenant gap here is a separate class — it needs a
  `ProjectAccessService` mirror of `ContractAccessService`, not the
  contract wall.

### EXCLUDED — Option B (architectural successor)

The Option B refactor will likely centralise org-scoped contract
loads through a scoped repository / interceptor. The walls added
across Tiers 1–3 stay as defence-in-depth on top of that, per
Ayman's framing. The single chokepoint is
`ContractAccessService.findInOrg`; Option B can later substitute its
scoped-repo-resolver behind that same call without touching any of
the call sites added in Tiers 1–3.

**With Tier 3 merged, what remains is architectural (Class-C + the
`POST /contracts` project_id gap) or successor (Option B) — not
mechanical.**

## Composability with Option B

Same posture as Tiers 1 and 2: Option B substitutes behind the
`ContractAccessService.findInOrg` chokepoint. The three call sites
added in this PR (one per service) take the same shape as every
prior tier's wall — no special-casing for `main_contract_id`. Option
B can fold this into its scoped-repository resolver without touching
ClaimsService / NoticesService / SubContractsService.

## Git scope

Only Tier 3 access-control files touched:

- **3 source modules + entry points modified:**
  - `claims.module.ts`, `claims.controller.ts`, `claims.service.ts`
  - `notices.module.ts`, `notices.controller.ts`, `notices.service.ts`
  - `subcontracts.module.ts`, `subcontracts.controller.ts`,
    `subcontracts.service.ts`
- **3 new permanent spec files** (one per fixed service, 12 tests
  total).
- **`docs/tenant-isolation-tier3.md`** — this file.

Explicitly NOT touched: Tier 1 walls (commit `f0c56aa` / PR #50),
Tier 2 walls (commit `6d3c9d6` / PR #51), metering, the engine, the
Class-C routes, the `POST /contracts` project_id gap, `CLAUDE.md` /
`lessons.md`. The scratch `_step0_tier3_leak_proof.spec.ts` was
removed after recording the red-before evidence (the same call
shapes live in the permanent specs, inverted to prove green-after).
