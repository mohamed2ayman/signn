# Option B — Chokepoint migration, module 4 of 4 (FINALE): COMPLIANCE

Branch base: `main` @ `4c25e62` (full Option B chokepoint + the CI-enforced
`no-bare-contract-repo-access` lint + module 1's paginated `scopedFindAndCount` +
module 2's `GuestInvitationScopedRepository` + module 3's chat classification all
present — confirmed). No PR, no merge — review digest.

Modules 1 (negotiation, #72), 2 (guest-portal, #74), 3 (chat, #76) were the first three
of the four modules the Phase 7.18 lint surfaced as "wall-protected; chokepoint migration
scheduled". This bucket migrates **COMPLIANCE** — the largest module — and **closes the
one read chat (3 of 4) deferred forward**.

## Outcome in one line

Compliance wires **6 genuinely-contract-scoped reads** through the chokepoint behind the
existing controller `findInOrg` walls (two checks, two layers), adds **2 new scoped
subclasses** (`ComplianceCheckScopedRepository`, `ComplianceFindingScopedRepository`) and
**1 minimal additive base method** (`scopedFindByIdWithRelations` — the unified parent-load
fix chat asked module 4 to decide), **re-points chat's `buildLegalContext`** through that
same base method (closing the cross-module deferral and removing its `DEFERRED`
annotation), and **honestly re-labels** every remaining bare site (writes / two-step /
system / public-token / aggregation / pre-wall / metering-reconcile / dead-code). Zero
`chokepoint migration scheduled` annotations remain in compliance. `npm run
lint:contract-repo` stays **exit 0**.

---

## STEP 0 — Recon

### The compliance entities + their canonical chains to org

| Entity | `contract_id` | Chain to org | Denorm org col? | New scoped repo? |
|--------|---------------|--------------|-----------------|------------------|
| `ComplianceCheck` | **direct** | `check → contract → project → org` | `project_id` (NOT on org path; ignored, Q1) | **YES** — `ComplianceCheckScopedRepository` |
| `ComplianceFinding` | none (transitive) | `finding → compliance_check → contract → project → org` | none | **YES** — `ComplianceFindingScopedRepository` |
| `ComplianceReportJob` | none (transitive) | `job → compliance_check → contract → project → org` | none | **NO** — no request-scoped org READ (reached only after the parent check is wall+scope-validated; backs writes + a PUBLIC token read) |
| `Obligation` & kin | — | — | — | already `ObligationScopedRepository` (S2c); grandchildren (`ObligationAssignee`/`ObligationReminderLog`) stay two-step |
| `ContractClause` | direct | `cc → contract → project → org` | — | **NO** — no scoped repo anywhere (cross-cutting); `loadClauses` is an aggregation QB (Q3) with a mixed caller |

### The walls (layer 1, KEPT inline — never swapped)

- `ComplianceController.assertContractInCallerOrg` → `ContractAccessService.findInOrg`,
  on every endpoint. `:checkId`/`:findingId` routes resolve the entity's TRUE owning
  `contract_id` first (`getContractIdForCheck` / `getContractIdForFinding`) and wall on
  THAT.
- `ComplianceObligationsController.assertContractInCallerOrg` (same shape) for the
  obligation routes.

### Per-site classification (the lint-flagged compliance sites)

Classification key: **(a)** per-contract LIST → `scopedFind*`; **(b)** by-id load →
`scopedFindByIdOrThrow`; **(c)** aggregation QB → leave (Q3); **(d)** system/no-orgId →
leave; **(e)** public-token / pre-wall → leave; **(f)** parent-Contract+project
jurisdiction load → the ROOT-fix; writes → leave (read-only chokepoint); two-step → leave.

| Site | Method | Kind | Class → Outcome |
|------|--------|------|-----------------|
| `compliance.service.ts:120` | `runCheck` Contract+`project` jurisdiction load | by-id read, hydrates `project` | **(f)** → **WIRED** `contractScoped.scopedFindByIdWithRelations(id, orgId, ['project'])` |
| `compliance.service.ts:listForContract` | ComplianceCheck list by `contract_id` (take 50) | LIST | **(a)** → **WIRED** `checkScoped.scopedFindAndCount({contract_id}, orgId, {order, take:50})` |
| `compliance.service.ts:getDetail` | ComplianceCheck by id | by-id | **(b)** → **WIRED** `checkScoped.scopedFindByIdOrThrow(checkId, orgId)` |
| `compliance.service.ts:getDetail` | findings by `compliance_check_id` | read | two-step (check scope-validated on line above) → **LEFT**, re-labelled |
| `compliance.service.ts:refreshFromAi` (×2 reads) | check by id (reconcile) | read | metering-reconcile (async, no request org; checkId wall-validated upstream) → **LEFT**, re-labelled |
| `compliance.service.ts:getContractIdForCheck` | check by id → contract_id | read | **(e)** pre-wall resolver (feeds findInOrg) → **LEFT**, re-labelled |
| `compliance.service.ts` saves/insert (×11) | persist check/finding | write | **LEFT** (read-only chokepoint), re-labelled |
| `compliance.service.ts:loadClauses` | ContractClause QB | QB | **(c)** aggregation + mixed caller (runCheck scoped / reconcile no-org) → **LEFT**, re-labelled |
| `compliance-finding.service.ts:updateStatus` | finding by id | by-id read-then-write | **(b)** → **WIRED** `findingScoped.scopedFindByIdOrThrow(findingId, orgId)` |
| `compliance-finding.service.ts:getContractIdForFinding` | finding→check QB → contract_id | read | **(e)** pre-wall resolver → **LEFT**, re-labelled |
| `compliance-finding.service.ts:listForCheck` | findings by check_id | read | **DEAD CODE** (no caller) → **LEFT**, flagged for removal |
| `compliance-finding.service.ts:updateStatus save` | finding save | write | **LEFT**, re-labelled |
| `compliance-report.service.ts:request` | parent ComplianceCheck by id | by-id | **(b)** → **WIRED** `checkScoped.scopedFindByIdOrThrow(input.checkId, input.orgId)` |
| `compliance-report.service.ts:findByToken` | report job by HMAC token | read | **(e)** PUBLIC token-gated download (no JWT) → **LEFT**, re-labelled |
| `compliance-report.service.ts:findById` | report job by id | read | **DEAD CODE** (no caller) → **LEFT**, flagged for removal |
| `compliance-report.service.ts` save/update (×4) | persist report-job state | write | **LEFT**, re-labelled |
| `compliance-report.processor.ts` (all reads) | report render | read | **(d)** BullMQ system path, no request org → **LEFT** (labels already correct) |
| `public-obligation.controller.ts` mark-met | obligation by id | read+write | **(e)** PUBLIC HMAC-token path, no JWT → **LEFT** (labels correct) |
| `compliance-obligations.controller.ts` | listForContract/listForProject QBs; update save | QB/write | already S2c-migrated (`obligationScoped`) + aggregation/write → **LEFT** (labels correct) |
| `compliance-obligation.service.ts` assignee/reminderLog reads | grandchild reads | read | two-step (parent obligation scope-validated upstream) → **LEFT**, re-labelled |
| `compliance-obligation.service.ts` writes + portfolio/calendar QBs | persist / analytics | write/QB | **LEFT**, re-labelled |
| `compliance-knowledge.service.ts` | KnowledgeAsset queries | read | **NOT contract-scoped** (KnowledgeAsset is org/platform/project-scoped) — no annotation, out of scope |

### ComplianceReportProcessor — confirmed leave + flagged

`ComplianceReportProcessor` is a BullMQ `@Processor('compliance-jobs')` — **no request
orgId** (same posture as `ObligationReminderProcessor`). All its reads (reportJob, check,
finding, contract, obligation) are correctly `// lint-exempt: system/no-orgId by design`.
**LEFT untouched.** **Flag (note, not done):** it is a candidate for a future
`findAcrossAllOrgs`-escape-hatch migration exactly like the obligation reminder processor
was — a system sweeper that should route its org-blind loads through the deliberately-named
bypass once that pattern is extended to the report processor. Not in this module's scope.

---

## The ROOT parent-load fix — decision (a) vs (b), with tradeoff

The blocker (handed forward by chat module 3, identical shape here): the ROOT
`ContractScopedRepository` gate uses the alias **`project`** (S1 — unlike the child repos
which use `org_gate_project`), so hydrating the `project` relation collides; and
`scopedFindByIdOrThrow` **throws** while both consumers need **silent-null**.

- **Option (a) — re-alias the ROOT gate `project → org_gate_project` + add `'id'` to its
  allowlist.** Cleaner SQL (single gate join), brings the ROOT in line with the child-repo
  convention. **Assessed SAFE** (the gate join is a non-selecting `innerJoin`; the sole
  ROOT production caller — `contracts.service.ts` — uses only `scopedFindByIdOrThrow`
  (by-id, no relations/filters) and cannot observe the alias; the ROOT spec is purely
  behavioural against real PG, asserts on no alias string). **But** it touches the
  **load-bearing S1 ROOT gate** that every scoped child and the wired Contract-by-id paths
  depend on, and the task's standing instruction is "prefer the lower-risk option; if
  re-aliasing risks breaking existing callers, STOP and report."

- **Option (b) — add a minimal additive base method `scopedFindByIdWithRelations(id,
  orgId, relations[]): Promise<T | null>`.** Null-on-miss (silent fallback); hydrates each
  relation with a **distinct `rel_<name>` join alias** so it can NEVER collide with any
  subclass's gate alias (the ROOT's `project` included) — TypeORM maps relations onto the
  entity by metadata, not by alias. Touches **NOTHING existing** — no ROOT gate re-alias,
  no allowlist change, no existing spec — so it **cannot change behaviour for any current
  ContractScopedRepository caller** by construction. The only cost is a negligible
  double-join to `projects` on the ROOT (one gate `innerJoin` + one `leftJoinAndSelect`
  hydration) on this single by-id-with-relations path.

**CHOSEN: (b).** It is the strictly-lower-risk realisation — purely additive, zero touch to
the load-bearing root — which is the disposition the task mandates. (a) was verified safe
but offers only marginal SQL-cleanliness for real risk on the spine. (b) is generic (works
for the ROOT and any child) and is the exact "minimal `scopedFindByIdWithRelations` base
method" chat module 3 named as the preferred unified resolution.

Implemented at `scoped-contract.repository.ts` (the base). Real-PG proof:
`tests/contract-scoped-relations.repository.spec.ts` — in-org returns the row WITH
`project.country` hydrated (no collision); cross-org → **null** (silent fallback,
RED→GREEN); missing id → null; `[]` relations → in-org row.

---

## STEP 1-2 — Scoped subclasses + wire

**2 new subclasses** (registered + exported in `ScopedRepositoryModule`):

- `ComplianceCheckScopedRepository` — alias `check`, gate `check.contract →
  org_gate_contract → org_gate_project`, allowlist **`{contract_id}`** (the wired
  `listForContract` filter). Backs `listForContract` (LIST, `scopedFindAndCount`) +
  `getDetail` / `report.request` (by-id, `scopedFindByIdOrThrow`).
- `ComplianceFindingScopedRepository` — alias `finding`, **4-hop** transitive gate
  `finding.compliance_check → org_gate_check → org_gate_contract → org_gate_project`,
  **EMPTY allowlist** (by-id only). Backs `updateStatus` (by-id, `scopedFindByIdOrThrow`).

**6 wired sites** (wall stays layer 1; scoped under as layer 2; orgId threaded from the
controller's wall-proven `user.organization_id`):

1. `compliance.service.runCheck` jurisdiction load → `contractScoped.scopedFindByIdWithRelations`.
2. `compliance.service.listForContract` → `checkScoped.scopedFindAndCount` (take 50, count discarded).
3. `compliance.service.getDetail` check load → `checkScoped.scopedFindByIdOrThrow`.
4. `compliance-finding.service.updateStatus` → `findingScoped.scopedFindByIdOrThrow`.
5. `compliance-report.service.request` parent check → `checkScoped.scopedFindByIdOrThrow`.
6. **(cross-module)** `chat.service.buildLegalContext` → `contractScoped.scopedFindByIdWithRelations`.

**Cross-module closure (#6):** chat's `buildLegalContext` is re-pointed to the same ROOT
base method, threading the `sendMessage` caller's `orgId` as the tenancy gate. Its
`DEFERRED` lint annotation is **removed**, the bare `@InjectRepository(Contract)` and chat's
`Contract` `forFeature` registration are **dropped**, and `ScopedRepositoryModule` is added
to `ChatModule`. This also **tightens** a pre-existing gap — the prior bare load applied NO
org filter when deriving jurisdiction; routing through the gate makes an out-of-org contract
resolve to null → no legal context (the safe best-effort fallback). Re-aimed chat specs:
`chat.service.legal-context.spec.ts` (now asserts the call routes through the scoped repo
with the caller's org), `chat.service.async.spec.ts` (DI provider swap).

**Removed-as-unused** (clean, after wiring): `compliance.service` `contractRepo` injection
(only used by the jurisdiction load) + its `Contract` import; `compliance-report.service`
`checkRepo` injection (only used by `request`) + its `ComplianceCheck` import.

---

## Red→green (per wired site)

| Layer | Proof |
|-------|-------|
| **Data layer (real PG)** | `compliance-check-scoped.repository.spec.ts` (11) + `compliance-finding-scoped.repository.spec.ts` (11) + `contract-scoped-relations.repository.spec.ts` (4) — each states the RED FORM (pre-wire bare `find/findOne` with NO org filter → wall-neutralized cross-org leak) and proves GREEN: cross-org by-id → null + `*OrThrow` → no-existence-leak 404; LIST/count org-bounded; override-safety; coexistence with the independent wall. |
| **Filter-key allowlist (unit)** | `compliance-check-scoped.allowlist.spec.ts` (6 — `contract_id` allowed; `project_id`/`id`/hostile keys throw) + `compliance-finding-scoped.allowlist.spec.ts` (5 — empty allowlist, every key incl. `compliance_check_id` throws). |
| **Service wiring (unit)** | `compliance.service.scoped-wiring.spec.ts` (3) + `compliance-finding.service.scoped-wiring.spec.ts` (2) + `compliance-report.service.scoped-wiring.spec.ts` (2) — prove each method ROUTES through the scoped repo with the orgId, the bare repo is NOT consulted for the wired read, and a scoped cross-org denial PROPAGATES (no findings read / no mutation / no job queued). |
| **Wall + orgId threading** | `compliance.controller.access-wall.spec.ts` re-aimed: every cross-tenant `not.toHaveBeenCalled()` wall-denial assertion KEPT; `listForContract` / `updateStatus` called-with assertions extended with `ORG_A` (proving the org is threaded to the scoped layer). The metering-consumer assertions (`runCheck` accountType, `refreshFromAi('check-1')`) are unchanged — `runCheck`/`refreshFromAi` signatures are untouched. |

---

## Suite + lint

| | Before (`4c25e62`) | After |
|---|---|---|
| Backend suite (`npm test` = `jest --runInBand`, in-container, real PG) | **107 suites / 959 tests** | **115 suites / 1003 tests** |
| Delta | — | **+8 suites, +44 tests, 0 regressions** |
| `npm run lint:contract-repo` | exit 0 | exit 0 |
| `tsc --noEmit` | exit 0 | exit 0 |

The 8 new suites: 2 repo specs + 2 allowlist specs + 1 ROOT-relations spec + 3
service-wiring specs. The 44 new tests are all green and the real-PG denial probes
executed (not skipped — DATABASE_URL set in-container).

---

## Is the chokepoint migration COMPLETE?

**The 4-module chokepoint migration is COMPLETE** (negotiation #72 → guest-portal #74 →
chat #76 → compliance, this module). The recurring `contract → project → country`
jurisdiction parent-load that chat deferred is **closed** for both consumers via the shared
`scopedFindByIdWithRelations` base method.

**But the broader Option B chokepoint is NOT 100% complete** — `chokepoint migration
scheduled` annotations remain in **three areas that were never part of the 4-module plan**
(distinct future units, all honestly labelled, all wall-protected today):

1. **`docusign.service.ts`** (8 sites) — `Contract` reads/writes. A separate scheduled
   module.
2. **`export.service.ts`** (3 sites) — `Contract` reads. A separate scheduled module
   (child reads already route through `riskScoped`/`obligationScoped`; the parent-Contract
   load is the same shape the finale's `scopedFindByIdWithRelations` could now serve).
3. **`ContractClause` reads** — `contracts.service.ts` (9) + `document-processing.service.ts`
   (5). `ContractClause` has **no scoped repo** anywhere; a `ContractClauseScopedRepository`
   is the unit of work that would close these (and compliance's `loadClauses` QB).

These were explicitly out of the 4-module scope and are left with honest annotations for a
follow-up phase.
