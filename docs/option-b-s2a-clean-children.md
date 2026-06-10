# Option B — S2a: scopedFind + the CLEAN child contract-scoped entities

**Scratch design + evidence doc. NOT CLAUDE.md.** The Architecture Rule that
codifies "every contract-scoped data load goes through the scoped repo" still
DEFERS to the final lint bucket (writing it now would claim an invariant that
bare repo access still violates everywhere). S2a extends S1 — it does not
relitigate it.

- **Branch:** `feat/option-b-s2a-clean-children`, cut from `main @ 5a5cd24`
  (S1 base + Contract ROOT #56; S0-part-2 child-id walls #57).
- **Built to Ayman's ratified calls:** Q3 add a scoped LIST method (`scopedFind`)
  — NO generic query-builder wrapper (raw `createQueryBuilder` sites stay the CI
  lint's job, final bucket); Q1 canonical-only org resolution
  (`contract → project → organization_id`, ignore the denormalized `org_id`
  columns); override-safety stays STRUCTURAL (no orgId-override param; org filter
  always applied); the `findInOrg` + S0 interim walls stay INDEPENDENT underneath.

---

## 1. The S2a child set (confirmed against the scoping pass §4)

`docs/option-b-s2-child-scoping.md` §4 groups S2a as the CLEAN direct-`contract_id`
children loaded in `contracts.service` with orgId already in scope. The wired
set, by their **LIST** read endpoints:

| Entity | Scoped repo | Read endpoint wired | Filter / options |
|---|---|---|---|
| ContractVersion | `ContractVersionScopedRepository` | `getVersions` | `{ contract_id }` + relations `creator`,`triggered_by_user`, order `version_number ASC` |
| ContractVersion | (same) | `getMilestoneVersions` | `{ contract_id, is_milestone: true }` + same relations/order |
| ContractorResponse | `ContractorResponseScopedRepository` | `getContractorResponses` | `{ contract_id }` + relations `party`, order `created_at DESC` |
| ContractApprover | `ContractApproverScopedRepository` | `getApprovers` | `{ contract_id }` + relations `user`, order `assigned_at ASC` |

All four already carried the Tier-2 `findInOrg` wall and already had `orgId` in
scope — **no orgId threaded through any new layer** (the S2a constraint).

### Deferred (and why) — NOT wired in S2a

- **ContractComment** — its only LIST read is a raw `createQueryBuilder`
  ([contracts.service.ts:909](backend/src/modules/contracts/contracts.service.ts:909));
  per Q3 raw QB stays the **lint** bucket. Its other reads are by-id loads inside
  update/reply/delete **mutation** methods → S2b (converting a mutation's internal
  load risks behavior; out of S2a's "clean reads" scope).
- **`getVersion` (by-id-with-relations)** and the approver mid-mutation loads
  (`reviewApproval` internal `findOne`/`find`) — by-id reads that need relation
  hydration on the by-id path, or sit mid-mutation already behind the wall →
  **S2b**, where the by-id child path + the override get their own wiring.
- **Raw QB** sites (`getPendingApprovalsForUser`
  [contracts.service.ts:1234](backend/src/modules/contracts/contracts.service.ts:1234),
  the comment QB) → **lint** bucket per Q3.
- The org-drift four (Notice/Claim/SubContract/DocumentUpload) → **S2e**;
  contract-optional chat → excluded; RiskAnalysis analytics QBs → S2d/lint.

> The three new subclasses each implement the by-id path (`buildScopedQuery`) +
> the list path (`buildScopedListQuery`) — so child by-id + override are DEFINED
> and TESTED now (real-PG), even though S2a only WIRES the list reads. Same
> pattern as S1's `findAcrossAllOrgs`: defined, ready for S2b, unwired where not
> yet needed.

---

## 2. `scopedFind` — design + structural org-safety

Added to the base `ScopedContractRepository<T>`
([scoped-contract.repository.ts](backend/src/modules/scoped-repository/scoped-contract.repository.ts)).
Two new abstract members + one public method; the existing by-id methods
(`scopedFindById`, `scopedFindByIdViaContract`, override-safety) are **untouched**.

```
protected abstract readonly entityAlias: string;
protected abstract buildScopedListQuery(orgId): SelectQueryBuilder<T>;  // join + ALWAYS project.org = :orgId, no id predicate
async scopedFind(filter, orgId, options?): Promise<T[]>                  // applies filter/relations/order, getMany
```

`scopedFind`:
- delegates the JOIN to the subclass's `buildScopedListQuery(orgId)`, which
  mirrors `scopedFindById`'s join shape (`child → contract → project`) and
  **always** applies `project.organization_id = :orgId`;
- applies each `filter` key as a parameterized `andWhere` on the **entity alias**;
- supports single-level `relations` (`leftJoinAndSelect`) and `order`
  (`addOrderBy`) so it is a behavior-preserving drop-in for the
  `repo.find({ where, relations, order })` calls it replaced.

**Structural org-safety (mirrors S1, extended to the list method):**
1. There is **no orgId-override parameter** anywhere — the org is always the
   `orgId` argument (the caller's real org, from `@OrganizationId()`).
2. `buildScopedListQuery` **always** applies the `project.organization_id = :orgId`
   gate; the filter loop only adds predicates on the **child** alias
   (`${entityAlias}.${key}`), never on `project`. A `filter` can only NARROW the
   result; it can never touch, relax, or widen the org gate.
3. For these CLEAN children there is no `organization_id` column at all, so a
   caller cannot even type a filter that targets org (`FindOptionsWhere<T>`).

Proven by the real-PG probe "a filter pointing at a FOREIGN contract cannot widen
the org → empty" (§5), the list analog of S1's override-safety probe.

### Canonical-only (Q1) — confirmed

Every subclass resolves org via `child → contract → project → organization_id`
(`innerJoin('child.contract','contract').innerJoin('contract.project','project')
.andWhere('project.organization_id = :orgId')`). None of the S2a entities carries
a denormalized `org_id`, but the rule holds regardless: the denormalized columns
on the drift entities are **never** read for resolution (that's S2e's explicit
decision; here there's simply nothing to ignore).

---

## 3. Coexistence with the independent walls

S2a removes no wall and rewires none. Each wired read is now:

```
WALL (findInOrg, persona — unchanged)  →  SCOPED LIST (scopedFind, tenancy)
```

The `findInOrg` Tier-2 wall fires first (404s cross-tenant). `scopedFind` then
independently re-applies `contract→project→org` at the data load. Both layers
fire on every wired read — the intentional redundancy is the "both layers" proof
(collapsing them is a later bucket, audit §3.4). `contract-access.service.ts`,
the S0/S0-part-2 interim walls, the metering engine + consumers, and the drift
entities are **untouched** (verified: none appear in the diff).

---

## 4. Files changed (git scope)

**Base + subclasses (`backend/src/modules/scoped-repository/`):**
- `scoped-contract.repository.ts` — `scopedFind` + `entityAlias` /
  `buildScopedListQuery` abstracts (by-id methods untouched).
- `contract-scoped.repository.ts` — ROOT gains `entityAlias` +
  `buildScopedListQuery` (additive; `buildScopedQuery` untouched).
- `contract-version-scoped.repository.ts`,
  `contractor-response-scoped.repository.ts`,
  `contract-approver-scoped.repository.ts` — 3 new CLEAN child subclasses.
- `scoped-repository.module.ts` — register + export the 3 child repos
  (+ their entities in `forFeature`).
- `tests/scoped-find.s2a.repository.spec.ts` — new real-PG spec.

**Wiring (`backend/src/modules/contracts/`):**
- `contracts.service.ts` — inject the 3 child scoped repos; route
  `getVersions` / `getMilestoneVersions` / `getContractorResponses` /
  `getApprovers` through `scopedFind` (walls unchanged).
- `contracts.service.spec.ts` — register the 3 new providers (DI).
- `contracts.service.{reads-access-wall,scoped-wiring,access-wall,create-project-wall}.spec.ts`
  — new constructor args; reads-access-wall updated to assert the rewired
  reads go through `scopedFind` (cross-tenant → scoped load not reached;
  in-org happy path → both layers fire, scoped load returns the rows).

NOT touched: the engine/metering, the drift entities, any wall, the lint, CLAUDE.md.

---

## 5. Real-Postgres evidence

Spec: `tests/scoped-find.s2a.repository.spec.ts` (two orgs, each
`org → user → project → contract` + version/approver/response children; CI-skips
LOUD when `DATABASE_URL` is unset, same convention as S1). Run in-container
against live Postgres, `--runInBand`.

**scopedFind tenancy (the lead) + structural org-safety:**
```
scopedFind tenancy (canonical child→contract→org)
  ✓ in-org: orgA lists ONLY orgA versions for its contract
  ✓ cross-org: orgB caller gets NONE of orgA versions — even filtering on orgA contract
  ✓ broad list is org-scoped: orgA list contains orgA rows but NEVER orgB rows
  ✓ filter narrows: is_milestone:true under orgA returns only the milestone version
structural org-safety on scopedFind
  ✓ a filter pointing at a FOREIGN contract cannot widen the org → empty
  ✓ the org argument governs: same foreign filter UNDER orgB returns orgB rows
  ✓ relations + order are drop-in faithful (leftJoin never drops rows; ordered)
child scopedFindById + override
  ✓ in-org: scopedFindById resolves the version via its own parent contract→org
  ✓ cross-org: scopedFindById returns null (canonical resolution denies)
  ✓ CORRECT child override: pinning the version OWN parent contract resolves the row
  ✓ SAFETY: a mismatched override (foreign parent contract) cannot widen → null
  ✓ SAFETY: cross-org child + override toward orgB still denied for an orgA caller
scopedFind across multiple clean child subclasses
  ✓ ContractApprover: in-org returns, cross-org empty
  ✓ ContractorResponse: in-org returns, cross-org empty
coexistence with the independent findInOrg wall
  ✓ cross-tenant: the WALL 404s on the parent contract AND scopedFind returns []
  ✓ in-org: the WALL returns the contract AND scopedFind returns the rows
```

**Service-level wiring (`contracts.service.reads-access-wall.spec.ts`, mocked):**
the rewired reads cross-tenant → 404 with the scoped load never reached; the
`getApprovers` happy path asserts BOTH layers fire (wall, then `scopedFind` with
the exact `{ contract_id }` + relations/order).

**Full suite (`--runInBand`):** 66 suites / **612 tests passing** — the 596
pre-S2a baseline + 16 new real-PG S2a tests. No drop, no failures. `tsc --noEmit`
clean.

### Verification ceiling (same posture as S1)

Local real-PG proves the gate is binding and the list org-safety is structural.
Pooled-connection behaviour under load (a PgBouncer transaction-mode pooler
rewriting session state) carries the same caveat as engine invariant #6 / the S1
ceiling and stays staging-gated for the broader B work — NOT a merge-gate for S2a.

---

## 6. Sequence note — what's next

S2a establishes `scopedFind` + the clean-child pattern. Remaining (audit §8 / the
scoping pass §4):

1. **S2b** — ContractClause + ComplianceCheck (+ ComplianceFinding), request-path;
   the by-id child path + override get wired (relation hydration on by-id), and the
   base-surface decision (already made: scopedFind exists) is exercised at scale.
2. **S2c** — Obligation (+ assignee/reminder-log), absorbing the S0 interim wall
   on `obligations.service.findByContract` and the Class-C inline QB.
3. **S2d** — RiskAnalysis read paths (most analytics QBs deferred to the lint).
4. **S2e** — the org-drift four (Notice/Claim/SubContract/DocumentUpload), which
   ALSO absorbs the S0-part-2 child-id walls into the scoped repo, and carries the
   canonical-only-vs-drift-detection decision (Q1: canonical-only).
5. **LAST** — the ESLint lint banning bare contract-repo access + the CLAUDE.md
   Architecture Rule, together, once S2b–S2e have removed the violations.

No code pushed. No PR. Stop for review.
