# Option B — S1: Scoped-Repository Base Class + Contract ROOT wiring

**Scratch design + evidence doc. NOT CLAUDE.md.** The CLAUDE.md Architecture Rule
that codifies "every contract-scoped data load goes through the scoped repo" is
DEFERRED to the final B bucket, where the Rule and its ESLint enforcement ship
together. Writing the Rule now would claim an invariant that isn't true yet —
bare contract-repo access still exists everywhere until the lint lands (the same
doc-drift class S0 just fixed in the Phase 7.15 correction).

- **Branch:** `feat/option-b-s1-scoped-repo-base`, cut from `main @ 7ac1a00`
  (Tiers 1–3 + S0 walls, all 3 metering consumers, corrected CLAUDE.md).
- **Spec built to:** Ayman's ratified B spec (auto + safe override, walls stay
  independent, one named `findAcrossAllOrgs` escape hatch, Rule+lint deferred).
- **What this bucket is:** the FIRST, smallest real unit of the B refactor —
  the base class + the Contract ROOT wired through it as the proof. No child
  entities, no lint, no Architecture Rule, no wall rewiring.

---

## 1. Base-class design

Audit Option 3.1.B — **one generic abstract base + per-entity concrete
subclass**. The base owns the public method surface (so the API evolves in one
place); each subclass declares only its join to org.

### Files

| File | Role |
|---|---|
| `backend/src/modules/scoped-repository/scoped-contract.repository.ts` | `abstract class ScopedContractRepository<T>` — the generic base. |
| `backend/src/modules/scoped-repository/contract-scoped.repository.ts` | `ContractScopedRepository` — the Contract ROOT subclass (`@Injectable()`). |
| `backend/src/modules/scoped-repository/scoped-repository.module.ts` | `ScopedRepositoryModule` — provides + exports the Contract scoped repo. |

### The org-scope contract (non-negotiable)

> **Every read method REQUIRES an explicit `orgId` and filters by it through
> `contract → project → organization_id`.** No method on the class can load a
> contract-scoped entity without an orgId.

The `orgId` is always the caller's authenticated org (`@OrganizationId()` from
the JWT) — never derived from request-supplied data. The resolution mirrors
`ContractAccessService.findInOrg` (contract-access.service.ts:105) so the
data-layer gate is consistent with the wall. The Contract subclass uses
`innerJoin` (not `innerJoinAndSelect`) — the project is joined to apply the org
filter but is NOT hydrated, so the returned row is a clean `Contract` safe to
mutate + save.

### Public method surface

| Method | Returns | Purpose |
|---|---|---|
| `scopedFindById(id, orgId)` | `T \| null` | ROOT by-id, auto resolution. `null` on miss (no existence leak). |
| `scopedFindByIdOrThrow(id, orgId)` | `T` | Same, but 404 (`NotFoundException`) on miss — matches the wall convention. |
| `scopedFindByIdViaContract(id, orgId, { contractIdOverride? })` | `T \| null` | Child-resolution with auto **or** manual parent-contract override (see §2). |
| `scopedFindByIdViaContractOrThrow(...)` | `T` | Same, 404 on miss. |
| `findAcrossAllOrgs()` | `T[]` | ⚠️ Tenancy BYPASS — system/background only (see §4). |

The only thing a subclass implements is `buildScopedQuery(id, orgId,
contractIdOverride?)` (the join to org) and `notFoundMessage` (the 404 text).

---

## 2. Auto vs override parent-contract resolution + the safety constraint

Ayman B spec item 1: the scoped repo OWNS child→parent-contract→org resolution
**automatically** by default, AND exposes a **manual override** where a caller
pins the contractId explicitly — a fallback for buggy auto-resolution.

- **Auto:** follow the entity's FK to its parent contract, then to the project,
  then apply the org filter. For a CHILD this is `child.contract_id → contract →
  project.organization_id`. For the Contract ROOT, parent == self.
- **Override (`contractIdOverride`):** ADDITIONALLY pin the parent contract.
  For the ROOT this is `contract.id = :contractIdOverride`; for a future CHILD
  it would be `child.contract_id = :contractIdOverride`.

### The safety constraint (designed-in, structurally enforced)

> The override lets the caller specify **which PARENT CONTRACT** to resolve the
> org from. It does **NOT**, and **CANNOT**, let the caller pass an arbitrary
> `orgId`. The org scoped against is **ALWAYS** the `orgId` argument the method
> already requires — the caller's real org. The override can only **NARROW**
> the result to a specific parent contract; it can never widen or change which
> org the caller is treated as.

This is enforced **structurally**, not by validation:

1. There is **no `orgId` override parameter** anywhere on the class. The org is
   whatever the caller passed.
2. `buildScopedQuery` ALWAYS applies `project.organization_id = :orgId`. The
   override only ADDs a `contract.id = :contractIdOverride` predicate — it never
   replaces or relaxes the org filter.

So a caller in org A passing org B's contractId as the override gets **zero
rows**: org B's contract has `project.organization_id = orgB`, which fails the
`= :orgId (= orgA)` filter. The override never reaches another org.

No CHILD entity is wired in S1 — the auto/override shape is **established and
tested against the Contract ROOT** (where parent == self). Child entities are
the next bucket.

---

## 3. Coexistence with the independent walls

`findInOrg` STAYS INDEPENDENT. S1 does not touch, absorb, or rewire it. Two
separate checks at two layers = true defense-in-depth (CLAUDE.md Option B):

| Layer | Check | Concern |
|---|---|---|
| **WALL** — `ContractAccessService.findInOrg` / `findAccessibleContract` (Tier 1–3 / S0) | Persona authz at route entry — "may THIS caller (managing / guest / viewer) touch THIS contract?" | Persona-aware; knows guest bindings + viewer credentials. |
| **SCOPED REPO** — `ContractScopedRepository` (this bucket) | Tenancy at the data load — "no contract-scoped row crosses an org boundary, regardless of how the call got here." | Persona-blind; catches internal loaders + raw-QB drift. |

### The wiring (the proof)

Wired the four Contract-row mutations in `contracts.service.ts` — `update`,
`updateStatus`, `updateParties`, `delete` — chosen because they ALREADY have
`orgId` in scope (no new threading in S1). Each now reads:

```
WALL   (findInOrg, unchanged)  →  SCOPED LOAD (scopedFindByIdOrThrow)  →  mutate/save
```

The `findInOrg` wall fires first (persona, unchanged). The scoped repo then
loads the mutation target through the chokepoint (tenancy). Both fire on every
mutation. The intentional redundancy IS the S1 "both layers fire" proof —
collapsing the wall and the scoped load into one chokepoint (audit §3.4) is
deferred to a later B bucket; S1 removes no wall.

The finalize_review contract load was considered (per the build prompt) but is
NOT a clean candidate: its only Contract load IS its `findInOrg` wall — it then
loads CLAUSES (a child entity, out of S1 scope), never re-loading the contract.
Its metering was left entirely untouched.

---

## 4. `findAcrossAllOrgs` — defined, UNWIRED

The ONE deliberate, named tenancy escape hatch (Ayman B spec item 3). Returns
rows across ALL orgs with no org filter — for legitimately org-blind background
work (e.g. the daily/weekly `ObligationReminderProcessor` sweeper, audit §4.3).

- **S1 status:** the method + a LOUD "SYSTEM / BACKGROUND USE ONLY" doc comment
  exist on the base class. **No production caller is wired.** Verified:
  `grep -rn findAcrossAllOrgs src/` returns only the base-class definition, the
  test, and a jest mock — zero production call sites.
- The `ObligationReminderProcessor` migration onto this method, and the ESLint
  allowlist that fences it to specific files, are **later buckets**.

---

## 5. Real-Postgres evidence

Run inside `sign-backend` against live Postgres (the org filter is a SQL JOIN
predicate — only real cross-tenant fixtures prove it). Spec:
`backend/src/modules/scoped-repository/tests/contract-scoped.repository.spec.ts`.
Two orgs, each with `org → user → project → contract`.

### Override-safety probe (the critical one — led)

```
override-safety (the critical probe)
  ✓ CORRECT override: orgA caller pinning orgA contract resolves the row
  ✓ SAFETY: orgA caller CANNOT reach orgB by overriding toward orgB contract → null
  ✓ SAFETY: a mismatched override (orgA id + orgB override) cannot widen the org → null
  ✓ SAFETY: the orgId argument governs — org B's own override still can't pull an orgA contract for an orgB caller across the boundary
```

The actual SQL emitted by the scoped repo (from the query log) confirms the
gate and the override only NARROW, never widen the org:

```sql
FROM "contracts" "contract"
INNER JOIN "projects" "project" ON "project"."id" = "contract"."project_id"
WHERE "contract"."id" = $1 AND "project"."organization_id" = $2
-- override adds:  AND "contract"."id" = $3
```

### scopedFindById + coexistence + bypass

```
scopedFindById
  ✓ in-org: returns the org-A contract for orgA
  ✓ cross-org: returns null for an org-B contract requested under orgA
  ✓ cross-org *OrThrow: throws NotFoundException (404, no existence leak)
  ✓ in-org *OrThrow: returns the row
coexistence with the independent findInOrg wall
  ✓ cross-tenant: the WALL (findInOrg) 404s AND the scoped repo returns null
  ✓ in-org: the WALL returns the contract AND the scoped repo returns the contract
findAcrossAllOrgs (system bypass)
  ✓ returns rows from BOTH orgs (proves it crosses the tenancy boundary)

Tests: 11 passed, 11 total
```

`findAcrossAllOrgs` emits a bare `SELECT ... FROM "contracts"` with **no WHERE**
— visible in the query log, proving it is the deliberate bypass.

### Service-level wiring proof (mocked)

`backend/src/modules/contracts/tests/contracts.service.scoped-wiring.spec.ts`
proves both layers fire on the wired mutations, and that the scoped repo is an
INDEPENDENT gate (wall passes but scoped 404s → no save/remove):

```
update          ✓ cross-tenant: WALL 404s FIRST; scoped load never reached, no save
                ✓ INDEPENDENT GATE: wall passes but scoped repo 404s → no save
                ✓ happy path: BOTH layers fire; the scoped row is the mutation target
delete          ✓ cross-tenant: WALL 404s FIRST; scoped load never reached, no remove
                ✓ INDEPENDENT GATE: wall passes but scoped repo 404s → no remove
                ✓ happy path: scoped DRAFT row is removed
updateParties   ✓ INDEPENDENT GATE: wall passes but scoped repo 404s → no save
updateStatus    ✓ INDEPENDENT GATE: wall passes but scoped repo 404s → no save
```

### Full suite + typecheck

- `npx tsc --noEmit` → exit 0.
- Full backend suite: **62 suites / 572 tests passing** — the 553 pre-S1
  baseline + 19 new tests (11 scoped-repo real-PG + 8 wiring), no drop, no
  failures. Real-PG specs run in-container (DATABASE_URL set); they skip LOUD in
  CI per the existing metering convention.

### Verification ceiling (pre-Phase-9)

Same posture as the metering staging gate. Local real-PG proves the gate is
binding and the override is safe. Pooled-connection behaviour under load (a
PgBouncer transaction-mode pooler rewriting session state) carries the same
caveat as engine invariant #6 and stays staging-gated for the broader B work —
it is NOT a merge-gate for S1.

---

## 6. Sequence note — what's next

S1 is the chokepoint mechanism + the Contract ROOT proof. The remaining buckets
(per the audit §8 sequence), in order:

1. **S2/S3 — child entities** (Clause, Obligation, RiskAnalysis, Compliance,
   Notice/Claim/SubContract, + the background loaders B1–B5). Each child gets a
   subclass declaring its `child.contract_id → contract → project.org` join; the
   auto/override shape established here carries forward unchanged.
2. **`findAcrossAllOrgs` caller** — wire the `ObligationReminderProcessor`
   sweeper onto it (S3).
3. **LAST — the lint + the CLAUDE.md Architecture Rule, together.** The ESLint
   rule banning bare contract-repo access and the Rule codifying "every
   contract-scoped data load goes through the scoped repo" ship in the same
   final bucket, once S1–S4 have removed the violations. Shipping the Rule
   before the lint would assert an invariant that bare repo access still
   violates everywhere — the exact doc-drift class to avoid.
