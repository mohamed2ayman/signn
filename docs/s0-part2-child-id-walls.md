# S0-part-2 — Notice / Claim / SubContract child-id cross-tenant walls

**Security stop-gap. Scratch/evidence doc — NOT CLAUDE.md / lessons.md.** Closes
a live cross-tenant gap surfaced by the Option B S2 scoping pass
([docs/option-b-s2-child-scoping.md](option-b-s2-child-scoping.md) §2.3). This is
NOT an S2 refactor bucket — it is a `findInOrg` stop-gap that Option B **S2e**
will absorb via the scoped repository (`scopedFindByIdViaContract`).

- **Branch:** `fix/s0-part2-child-id-walls`, cut from `main @ 2daf8cc` (S1 —
  scoped-repo base + Contract root, #56).
- **Pattern:** the same proven `ContractAccessService.findInOrg` wall the S0 stop-gap
  put on `obligations.service.findByContract`
  ([obligations.service.ts:28](backend/src/modules/obligations/obligations.service.ts:28))
  — except here the routes are keyed by the CHILD id, so the wall resolves via
  the child's **own** parent contract, never a URL-supplied contractId (PR #45 /
  Tier 2 child-keyed lesson).

---

## 1. The gap

Tenant-isolation **Tier 3** (PR #52, `0b3f554`) walled the **create** and
**list-by-contract** routes of notices / claims / subcontracts via
`findInOrg(contractId, orgId)`. It **missed every `:id`-keyed route** — those
take no `orgId`, load the child by its id with **no org filter**, and never call
`findInOrg`. The controllers carry only the class-level guards
(`JwtAuthGuard, RolesGuard, PermissionLevelGuard`), and there is **no
project-resolver middleware** for these modules (only
`resolve-obligation-project.middleware.ts` exists), so `PermissionLevelGuard`
cannot resolve a project from a notice/claim/subcontract id either. Net result:
**any authenticated user in org A could read and mutate org B's notices, claims
and sub-contracts by id.** Several are WRITES.

Routes that were unwalled (now walled):

| Module | Route | Kind | Service method |
|---|---|---|---|
| notices | `GET /notices/:id` | READ | `findById` |
| notices | `PUT /notices/:id/acknowledge` | WRITE | `acknowledge` |
| notices | `POST /notices/:id/respond` | WRITE | `respond` |
| notices | `PUT /notices/:id/status` | WRITE | `updateStatus` |
| claims | `GET /claims/:id` | READ | `findById` |
| claims | `PUT /claims/:id/acknowledge` | WRITE | `acknowledge` |
| claims | `POST /claims/:id/respond` | WRITE | `respond` |
| claims | `PUT /claims/:id/status` | WRITE | `updateStatus` |
| claims | `POST /claims/:id/documents` | WRITE | `uploadDocument` |
| subcontracts | `GET /subcontracts/:id` | READ | `findById` |
| subcontracts | `PUT /subcontracts/:id` | WRITE | `update` |
| subcontracts | `PUT /subcontracts/:id/status` | WRITE | `updateStatus` |
| subcontracts | `POST /subcontracts/:id/share` | WRITE | `share` |

**Out of scope (untouched):** the Tier 3 create/list walls (NOT re-touched),
chat (contract-OPTIONAL), and the clean S2 scoped-repo refactor (that's S2a+).

---

## 2. STEP 0 — red-before evidence (exploit SUCCEEDS on current main)

Throwaway exploit specs were run against the unfixed services, with
`contractAccess.findInOrg` wired to REJECT — the exploit still succeeded,
proving the wall was never reached. Lead with the WRITES.

```
PASS src/modules/subcontracts/tests/subcontracts.child-id-exploit.red.spec.ts
PASS src/modules/notices/tests/notices.child-id-exploit.red.spec.ts
PASS src/modules/claims/tests/claims.child-id-exploit.red.spec.ts

Test Suites: 3 passed, 3 total
Tests:       8 passed, 8 total
```

The 8 passing exploits (= the gap):
- **notices** — `acknowledge` (WRITE) mutates an org-B notice; `findById` (READ)
  returns an org-B notice. Both assert `findInOrg` was **never called**.
- **claims** — `uploadDocument` (WRITE) attaches a doc to an org-B claim;
  `acknowledge` (WRITE) mutates an org-B claim; `findById` (READ) returns one.
- **subcontracts** — `update` (WRITE) rewrites an org-B sub-contract;
  `updateStatus` (WRITE) flips its status; `findById` (READ) returns it.

Each test's smoking gun: `expect(contractAccess.findInOrg).not.toHaveBeenCalled()`
while the write/read **succeeded**. The red specs were deleted after capture and
replaced by the green walls below.

No route turned out already-walled — the inventory matched the scoping pass
exactly; all 13 `:id` routes lacked an org gate.

---

## 3. STEP 1 — the fix (findInOrg, child → real parent contract → org)

Each `:id` route now: loads the child by id, reads the child's **own** parent
contract reference, and calls `contractAccess.findInOrg(thatContractId, orgId)`
with `orgId` from the caller's `@OrganizationId()`. Cross-tenant → 404 (no
existence leak). A URL-supplied contractId is **never** trusted for the wall.

Every added wall carries the tag:

```ts
// INTERIM (S0-part-2): child-id cross-tenant wall. Option B S2e absorbs this via
//  the scoped repository (scopedFindByIdViaContract). findInOrg stop-gap until then.
```

**Resolution key per module:**
- notices: `notice.contract_id`
- claims: `claim.contract_id`
- subcontracts: `subContract.main_contract_id` (the sub-contract's real parent;
  `main_contract_id → contracts.id`)

**Wall placement (DRY):** in notices and claims, `findById(id, orgId)` is the
shared loader, so `acknowledge` / `respond` / `updateStatus` route through it and
inherit one wall. `claims.uploadDocument` loads the claim directly, so it carries
its own wall. All four subcontract methods load their own row, so each carries
its own wall.

**Files changed (access-control only — no refactor, no scoped-repo, no engine):**
- `backend/src/modules/notices/notices.service.ts` — `findById` walled +
  `orgId` threaded into `acknowledge`/`respond`/`updateStatus`.
- `backend/src/modules/notices/notices.controller.ts` — `@OrganizationId()` on
  the 4 `:id` routes.
- `backend/src/modules/claims/claims.service.ts` — `findById` + `uploadDocument`
  walled + `orgId` threaded into `acknowledge`/`respond`/`updateStatus`.
- `backend/src/modules/claims/claims.controller.ts` — `@OrganizationId()` on the
  5 `:id` routes.
- `backend/src/modules/subcontracts/subcontracts.service.ts` — `findById` /
  `update` / `updateStatus` / `share` each walled, `orgId` threaded.
- `backend/src/modules/subcontracts/subcontracts.controller.ts` —
  `@OrganizationId()` on the 4 `:id` routes.

No module/DI changes were needed: all three services already inject
`ContractAccessService` + the `Contract` repo (from their Tier 3 create/list
walls). No service has any external caller (verified), so the signature changes
are contained.

---

## 4. STEP 2 — proof of fix (red → green)

New permanent specs (replacing the throwaway red ones), one per module, following
the existing Tier 3 access-wall mock pattern:

```
PASS src/modules/subcontracts/tests/subcontracts.service.child-id-wall.spec.ts
PASS src/modules/claims/tests/claims.service.child-id-wall.spec.ts
PASS src/modules/notices/tests/notices.service.child-id-wall.spec.ts

Test Suites: 3 passed, 3 total
Tests:       24 passed, 24 total
```

Each spec asserts, per route:
- **cross-tenant → 404** (`findInOrg` rejects), and for WRITES the row is **never
  saved** (`expect(repo.save).not.toHaveBeenCalled()`).
- **in-org → success.**
- **child-keyed resolution:** `findInOrg` is called with the child's **own**
  parent contract id (`notice.contract_id` / `claim.contract_id` /
  `subContract.main_contract_id`), proving child→real-parent→org — not URL trust.
- **bypass-role probe:** a dedicated test documents that the wall takes only
  `(contractId, orgId)` — it has **no role input** — so a `PermissionLevelGuard`
  bypass-role caller (SYSTEM_ADMIN / OPERATIONS / OWNER_ADMIN) is still denied
  cross-tenant. The wall is role-blind by construction.

**Full backend suite (`--runInBand`):**

```
Test Suites: 65 passed, 65 total
Tests:       596 passed, 596 total
```

596 = 572 pre-change baseline + 24 new tests. No drop, no failures. (A default
parallel `jest` run OOM-killed worker processes in-container — `SIGKILL`, suites
"failed to run", not assertion failures; `--runInBand` is the repo's documented
mode and is clean.)

---

## 5. INTERIM → S2e

These walls are deliberately the same shape as the obligations S0 stop-gap and
are tagged INTERIM. Option B **S2e** (the org-drift four bucket in the S2
scoping pass) will absorb them: the child-id loads move onto
`ScopedContractRepository.scopedFindByIdViaContract(childId, orgId)`, which
resolves the same `child → parent contract → project → organization_id` chain at
the data layer. Until S2e lands, `findInOrg` is the stop-the-bleeding gate. The
walls stay as defense-in-depth underneath S2e per the Option B "two checks"
design — do not remove them when S2e wires the scoped repo.

**Scope discipline:** notices / claims / subcontracts `:id` walls + 3 specs only.
No scoped-repo, no engine, no CLAUDE.md / lessons.md, no Tier-3 re-touch. Not
pushed, no PR — stop for review.
