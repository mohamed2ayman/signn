# Option B — S2b: wire ContractComment by-id MUTATION loads through the scoped repo

**Scratch design + evidence doc. NOT CLAUDE.md.** The Architecture Rule that
codifies "every contract-scoped data load goes through the scoped repo" still
DEFERS to the final lint bucket (writing it now would claim an invariant that
bare repo access still violates everywhere). S2b extends S1/S2a — it does not
relitigate them.

- **Branch:** `feat/option-b-s2b-contract-comment`, cut from `main @ 92c28f7`
  (S1 base + Contract ROOT #56; S0-part-2 child-id walls #57; S2a `scopedFind`
  + clean children #58).
- **What S2b is (per the S2a deferral note):** ContractComment's by-id loads sit
  inside the comment **mutation** methods; converting a mutation's internal load
  risks behavior, so S2a deferred them here. S2b wires the **by-id child path +
  parent-contract override** — exactly the surface S2a defined and tested but did
  not yet wire on a real mutation route.

---

## 0. Filter-key allowlist — DEFERRED (Ayman has not ruled)

The S2a `scopedFind` (list) method interpolates the **filter KEY** into the SQL
column reference (`${entityAlias}.${key} = :flt_${key}`; only the VALUE is
parameterized). The open question was whether `scopedFind` should validate filter
keys against a per-entity allowlist (the keys-are-interpolated invariant).

**Outcome: DEFERRED — no record of an Ayman ruling** in `docs/`, the S2a
Q-decisions (Q1 = canonical-only, Q3 = "add a scoped LIST method"; neither
mentions key validation), or git history. Per the build prompt, when there is no
ruling S2b does **not** touch `scopedFind`. S2b is by-id MUTATION wiring and uses
`scopedFindByIdViaContractOrThrow` (the by-id path), which **never hits the
filter-key interpolation path** — so S2b proceeds without the allowlist and is
unaffected either way. (If/when Ayman rules, the allowlist guard lands on the
base `scopedFind` as its own small change.)

---

## 1. The confirmed comment by-id route set

Grepped against `contracts.service.ts` / `contracts.controller.ts`. The complete
set of ContractComment **by-id bare `findOne` loads on mutation paths** is exactly
three (the `getComments` raw QB is a LIST read → lint, NOT in scope; `addComment`
creates, no by-id load):

| Route | Service method | Pre-S2b wall | Pre-S2b orgId | Author/perm check |
|---|---|---|---|---|
| `PUT /contracts/:id/comments/:commentId/resolve` | `resolveComment` | findInOrg (Tier 1) | YES | none |
| `PATCH /contracts/:id/comments/:commentId` | `updateComment` | **NONE** | **NONE** | author-only |
| `DELETE /contracts/:id/comments/:commentId` | `deleteComment` | findInOrg (Tier 1) | YES | author-or-admin |

**Discrepancy surfaced + ruled (Full parity).** The S2a scoping pass claimed
"orgId in scope today? YES — zero threading" for all `contracts.service` comment
methods. That was true for resolve/delete but **NOT for `updateComment`**, which
had neither a wall nor an `orgId` param (only the author check incidentally
limited cross-tenant edits). To wire `scopedFindById` on it, `orgId` must come
from somewhere; the only safe source is `@OrganizationId()` (deriving org from the
comment row is circular and unsafe). **Youssef ruled: Full parity** — add
`@OrganizationId() orgId` (one hop, the sanctioned source — not the deep S2e-style
threading "do NOT thread orgId through new layers" warns against), add the
`findInOrg` wall, add the scoped load, keep the author check. `updateComment` now
matches resolve/deleteComment exactly and its prior tenancy gap is closed.

---

## 2. The wired path — `wall → scoped → author → mutate`

Each route now runs four steps, in this order (confirmed on every wired route):

```
1. WALL        contractAccess.findInOrg(contractId, orgId)        (persona; Tier 1/S0, unchanged)
2. SCOPED      contractCommentScoped.scopedFindByIdViaContractOrThrow(
                 commentId, orgId, { contractIdOverride: contractId })  (tenancy; Option B chokepoint)
3. AUTHOR/PERM author (updateComment) / author-or-admin (deleteComment); resolveComment has none
4. MUTATE      save / remove via the plain comment repo
```

- The scoped load sits **AFTER the wall** and **BEFORE the author/permission
  check** on every route — so a foreigner gets **404** (no existence leak) before
  the author check ever runs; an in-org non-author gets **403**.
- **Why the override (`contractIdOverride: contractId`)?** The pre-S2b `findOne`
  matched `{ id: commentId, contract_id: contractId }`. The override pins
  `comment.contract_id = contractId`, preserving that "comment must belong to the
  URL contract" constraint **behavior-faithfully** while ADDING the org gate.
  Per §2.3 of the scoping pass, org is still resolved **canonically off the
  comment's OWN parent contract** (the auto join); the override is only an
  additive NARROWING pin, never the source of truth for org — it can never widen
  or change the caller's org.
- **save/remove stay on the plain `contractCommentRepository`** (the scoped repo
  is a by-id LOAD surface; same as S1's Contract mutations load via the scoped
  repo then write via the plain repo).

### Canonical-only (Q1) — confirmed

`ContractCommentScopedRepository` resolves org via
`comment → contract → project → organization_id`
(`innerJoin('comment.contract','contract').innerJoin('contract.project','project')
.andWhere('project.organization_id = :orgId')`). ContractComment carries **no**
denormalized org column (the nullable `contract_clause_id` FK is unrelated to
tenancy and is never the resolution path) — there is nothing to ignore; the rule
holds by construction.

### Real query shape (logged against live Postgres)

```sql
SELECT "comment".* FROM "contract_comments" "comment"
  INNER JOIN "contracts" "contract" ON "contract"."id"="comment"."contract_id"
  INNER JOIN "projects"  "project"  ON "project"."id"="contract"."project_id"
WHERE "project"."organization_id" = $1
  AND "comment"."id" = $2
  AND "comment"."contract_id" = $3      -- the override pin (= URL contract)
```

---

## 3. Coexistence with the independent walls

S2b removes no wall and rewires none. `contract-access.service.ts`, the S0 /
S0-part-2 interim walls, the metering engine + consumers, the drift entities, the
lint, and CLAUDE.md are **untouched** (verified: none appear in the diff). Each
wired route fires BOTH the `findInOrg` wall (persona) and the scoped load
(tenancy) — the intentional redundancy is the "both layers fire" proof
(collapsing them is a later bucket, audit §3.4).

---

## 4. Files changed (git scope)

**Base + subclass (`backend/src/modules/scoped-repository/`):**
- `contract-comment-scoped.repository.ts` — NEW CLEAN child subclass
  (`notFoundMessage = 'Comment not found'`, `entityAlias = 'comment'`,
  `buildScopedQuery` by-id + override, `buildScopedListQuery` — implemented only
  because the base requires it; **S2b wires no comment list**).
- `scoped-repository.module.ts` — register + export `ContractCommentScopedRepository`
  (+ `ContractComment` in `forFeature`).
- `tests/contract-comment-scoped.s2b.repository.spec.ts` — NEW real-PG spec (13 tests).

**Wiring (`backend/src/modules/contracts/`):**
- `contracts.service.ts` — inject `contractCommentScoped` (17th ctor arg); route
  `resolveComment` / `updateComment` / `deleteComment` through
  `scopedFindByIdViaContractOrThrow` (+ wall, +author check unchanged).
  `updateComment` gains an `orgId` param + the `findInOrg` wall (Full parity).
- `contracts.controller.ts` — `updateComment` gains `@OrganizationId() orgId`.
- `contracts.service.spec.ts` — register the new provider + mock.
- `contracts.service.{access-wall,scoped-wiring,reads-access-wall,create-project-wall}.spec.ts`
  — new 17th ctor arg; access-wall's resolve/deleteComment tests updated to the
  scoped repo (they keep proving the WALL fires first; the full ordering proof
  lives in the new wiring spec).
- `tests/contracts.service.comment-scoped-wiring.spec.ts` — NEW service-level
  ordering spec (12 tests).

**EXCLUDED (unchanged):** the ContractComment LIST read (`getComments` raw QB →
lint bucket, Q3), the drift-four, the risk QBs, chat, obligation-reminder, any
wall, the engine/metering, the lint, CLAUDE.md.

---

## 5. Real-Postgres evidence (`--runInBand`)

Both new specs CI-skip LOUD when `DATABASE_URL` is unset (same convention as
S1/S2a). Run in-container against live Postgres.

**Repo spec — `contract-comment-scoped.s2b.repository.spec.ts` (13, real PG):**
```
scopedFindById tenancy (canonical comment→contract→org)
  ✓ in-org: scopedFindById resolves the comment via its own parent contract→org
  ✓ cross-org: scopedFindById returns null (canonical resolution denies)
  ✓ broad probe: orgB cannot reach orgA comment and vice-versa
OrThrow no-existence-leak convention
  ✓ in-org: scopedFindByIdOrThrow returns the comment
  ✓ cross-org: scopedFindByIdOrThrow throws NotFound("Comment not found")
child scopedFindByIdViaContract + override (the wired mutation path)
  ✓ auto: resolves the comment via its own parent contract→org
  ✓ CORRECT override: pinning the comment OWN parent contract resolves the row
  ✓ SAFETY: a mismatched override (foreign parent contract) cannot widen → null
  ✓ SAFETY: cross-org child + override toward orgB still denied for an orgA caller
  ✓ OrThrow + mismatched override → throws (404 on wrong URL contract)
  ✓ OrThrow + correct override → returns (mutation route happy path)
coexistence with the independent findInOrg wall
  ✓ cross-tenant: the WALL 404s AND the scoped load is null
  ✓ in-org: the WALL returns the contract AND the scoped load returns the comment
```

**Service ordering spec — `contracts.service.comment-scoped-wiring.spec.ts` (12,
mocked) — LEADS with the ordering proof:**
```
resolveComment
  ✓ cross-tenant: WALL 404s FIRST; scoped load never reached, no save
  ✓ INDEPENDENT GATE: wall passes but scoped repo 404s → no save
  ✓ happy path: BOTH layers fire; the scoped row is flipped resolved
updateComment   (S2b adds wall + orgId to a route that had NEITHER)
  ✓ FOREIGNER: cross-tenant → 404 (wall); scoped + author never reached, no save
  ✓ FOREIGNER via INDEPENDENT scoped gate: scoped 404s → 404 BEFORE author, no save
  ✓ IN-ORG NON-AUTHOR: 403 AFTER the 404 tenancy layer — no existence leak, no save
  ✓ happy path: author edits their own in-org comment
deleteComment
  ✓ FOREIGNER: cross-tenant → 404 (wall); scoped never reached, no remove
  ✓ ADMIN BYPASS PROBE: SYSTEM_ADMIN of org A is STILL 404 on an org-B comment
  ✓ ADMIN cannot skip the INDEPENDENT scoped gate: scoped 404s → 404 BEFORE isAdmin
  ✓ IN-ORG NON-AUTHOR NON-ADMIN: 403 AFTER the 404 tenancy layer — no remove
  ✓ happy path: in-org admin removes another user's comment
```

**The lead invariant proven:** foreigner → **404** (save/remove never called
cross-tenant), in-org non-author → **403**, AFTER the 404 — no existence leak; the
admin role cannot skip the org gate at the wall OR at the independent scoped layer.

**Full suite (`--runInBand`):** 68 suites / **637 tests passing** — the 612
pre-S2b baseline + 25 new (13 repo + 12 wiring). No drop, no failures, no skips.
`tsc --noEmit` clean.

### Verification ceiling (same posture as S1/S2a)

Local real-PG proves the gate is binding and override-safety is structural.
Pooled-connection behaviour under load (a PgBouncer transaction-mode pooler
rewriting session state) carries the same caveat as engine invariant #6 / the
S1/S2a ceiling and stays staging-gated for the broader B work — NOT a merge-gate
for S2b.

---

## 6. Sequence note — what's next

S2b is the by-id child + override path on a real mutation route. Remaining
(audit §8 / scoping pass §4):

1. **S2c** — Obligation (+ assignee/reminder-log): absorbs the S0 interim wall on
   `obligations.service.findByContract` and the Class-C inline QB.
2. **S2d** — RiskAnalysis read paths (most analytics QBs deferred to the lint).
3. **S2e** — the org-drift four (Notice/Claim/SubContract/DocumentUpload), which
   ALSO absorbs the S0-part-2 child-id walls into the scoped repo, and carries the
   canonical-only-vs-drift-detection decision (Q1: canonical-only).
4. **obligation-reminder** sweeper → S3 (`findAcrossAllOrgs`).
5. **LAST** — the ESLint lint banning bare contract-repo access + the CLAUDE.md
   Architecture Rule, together (also the home of the filter-key allowlist guard
   if Ayman rules), once S2c–S2e have removed the violations. The ContractComment
   **LIST** read (`getComments` raw QB) is converted in this lint bucket, not here.

No code pushed. No PR. Stop for review.
