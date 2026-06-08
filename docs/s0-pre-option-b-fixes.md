# S0 — Pre-Option-B Wall Fixes

Three independent live gaps closed with proven patterns, ahead of the Option B
scoped-repository refactor. **Branch:** `fix/s0-pre-option-b-walls` from `main @ 9bd4d55`.

Reference: `docs/option-b-scoped-repository-audit.md` (§5 Class-C, §5.3 doc-drift, §7 project gap).

These three are deliberately surgical. **PART 3 (the Class-C walls) is INTERIM** — Option B
will later absorb the same routes through the scoped-repository chokepoint, at which point
the `findInOrg` calls become a second, defense-in-depth check (the audit §3.3 "two
independent checks" posture). They are applied now because the routes are LIVE and
reachable by privileged bypass-roles — this stops the bleeding before the larger refactor
lands. PART 2 (project gap) and PART 1 (doc-fix) are permanent.

---

## The three gaps

| # | Gap | Severity | Fix kind |
|---|-----|----------|----------|
| PART 1 | CLAUDE.md falsely claimed `ResolveObligationProjectMiddleware` validates contract→org ownership. It does not — it only resolves `project_id`, swallows errors, never throws. | Doc-drift (false **security** claim) | Permanent doc correction |
| PART 2 | `POST /contracts` trusted `dto.project_id` with no project→org check — a user could create a contract under **another org's project**. | Cross-tenant WRITE | Permanent wall |
| PART 3 | 3 Class-C routes leak cross-tenant because PLG bypass-roles (OWNER_ADMIN/SYSTEM_ADMIN/OPERATIONS) skip the project-membership check and the service load was unscoped. | Cross-tenant READ / signature forge | **INTERIM** wall (Option B absorbs later) |

PART 3's three routes:
- `GET /obligations/contract/:contractId` (`ObligationsService.findByContract`)
- `GET /contracts/:contractId/obligations` (`ComplianceObligationsController.listForContract`)
- `POST /contracts/:id/initiate-signature` (`DocuSignService.initiateSignature`)

---

## STEP 0 — red-before evidence (exploits PASS on current main)

Before applying the fix, a throwaway spec
(`contracts/tests/s0-redbefore-exploit.spec.ts`, since deleted) exercised the CURRENT
(pre-fix) code paths and **passed**, proving the cross-tenant access succeeds today:

```
PASS src/modules/contracts/tests/s0-redbefore-exploit.spec.ts
  S0 red-before — (a) POST /contracts trusts a foreign project_id
    ✓ EXPLOIT: a user in org A creates a contract under org B's project — NO project→org check exists (3 ms)
  S0 red-before — (b) Class-C: GET /obligations/contract/:contractId is unscoped
    ✓ EXPLOIT: findByContract returns a foreign contract's obligations — NO org gate, role-independent

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
```

- **(a)** `ContractsService.create({ project_id: <org-B project> }, userId, ORG_A)` reached
  `contractRepository.create({ project_id: <org-B project> })` + `save()` with **no project→org
  lookup** — a contract is created under a foreign org's project.
- **(b)** `ObligationsService.findByContract(<org-B contract>)` returned org-B's obligations.
  The method took **no orgId** and never consulted `findInOrg` — so it leaks regardless of the
  caller's role (a PLG bypass-role caller has already cleared the permission guard).

After the fix, those exact exploit scenarios no longer even compile (the constructor gained
`projectRepository`; `findByContract` now requires `orgId`) — which is the red→green signal.
The throwaway file was removed and replaced by the permanent per-route walls below.

The third Class-C route (DocuSign initiate-signature) was **confirmed by code inspection**,
not a runnable red-before exploit — `createEnvelope` loaded the contract by id with no org
filter (`docusign.service.ts:112`), and the controller used only `@RequirePermission(APPROVER)`
which bypass-roles clear. It is walled identically.

---

## STEP 1 — the fixes

### PART 1 — doc-drift (CLAUDE.md, Phase 7.15 section)

Corrected the false security claim. The two bullets that said the middleware "validates that
the contract belongs to the requesting user's organization" and "returns 403 if the contract
is not org-scoped" were replaced with an accurate description (resolves `project_id` for the
permission guard; does **not** verify org ownership; never throws — `use()` is wrapped in a
best-effort `try/catch` that always calls `next()`). Added a dated **CORRECTION** callout
pointing to this doc + the Option B audit, and tempered the section's "Scope" line.

**No middleware code changed** — this part is a doc correction only. The org-ownership gap on
those routes is closed by PART 3's route-level wall (and ultimately Option B).

### PART 2 — `POST /contracts` project→org wall (permanent)

`ContractsService.create()` now loads the project scoped to the caller's org **before** insert:

```ts
const project = await this.projectRepository.findOne({
  where: { id: dto.project_id, organization_id: orgId },
  select: ['id'],
});
if (!project) {
  throw new NotFoundException('Project not found');   // 404 — no existence leak
}
```

- `Project` added to `ContractsModule`'s `TypeOrmModule.forFeature` + injected into the service
  (6th constructor param). Minimal inline check — **no** `ProjectScopedRepository` (that is
  Option B's job, audit §7).
- 404 (not 403) on cross-tenant, matching the `findInOrg` convention.

### PART 3 — interim Class-C walls (findInOrg, same pattern as Tiers 1-3)

Each route now applies `ContractAccessService.findInOrg(contractId, orgId)` at the data load,
with `orgId` from the caller's `@OrganizationId()`. Because `findInOrg` is keyed on **org, not
role**, the gate applies regardless of role — closing the bypass. Each site is explicitly
commented:

> `// INTERIM (S0): Class-C bypass-role wall. Option B will absorb this via the scoped`
> `//  repository chokepoint — this findInOrg is the stop-gap until then.`

so the deliberate future double-coverage is documented, not accidental.

| Route | Wall location | orgId source | No-org caller |
|-------|---------------|--------------|---------------|
| `findByContract` | `ObligationsService.findByContract(contractId, orgId)` | `@OrganizationId()` (controller) | `!orgId` → 404 |
| `listForContract` | `ComplianceObligationsController.assertContractInCallerOrg(contractId, user)` | `@CurrentUser().organization_id` | `!org` → 404 |
| `initiateSignature` | `DocuSignService.initiateSignature(..., orgId)` (before `createEnvelope`) | `@OrganizationId()` (controller) | `!orgId` → 404 |

Module wiring: `DocuSignModule` now imports `ContractsModule` (one-directional — no cycle,
ContractsModule has no DocuSign import). `ObligationsModule` and `ComplianceModule` already
imported `ContractsModule`.

---

## STEP 2 — green evidence (per-route red→green)

Four permanent specs, each asserting **cross-tenant → 404 (service/QB never reached)** and
**in-org → success**. The Class-C specs include an explicit **BYPASS-ROLE PROBE** — an
OWNER_ADMIN caller (a PLG bypass-role) hitting a foreign contract still gets 404, proving the
role no longer bypasses the org gate.

| Spec | Tests |
|------|-------|
| `contracts/tests/contracts.service.create-project-wall.spec.ts` | 2 — cross-tenant project → 404 (no insert); in-org → created |
| `obligations/tests/obligations.service.find-by-contract-wall.spec.ts` | 3 — bypass-role probe → 404 (repo never queried); no-org → 404; in-org → rows |
| `compliance/controllers/tests/compliance-obligations.controller.access-wall.spec.ts` | 3 — bypass-role probe → 404 (no QB built); no-org → 404; in-org → listed |
| `docusign/tests/docusign.service.initiate-wall.spec.ts` | 3 — bypass-role probe → 404 (no envelope); no-org → 404; in-org → envelope + URL |

**4 specs / 11 new tests, all green.**

Touched existing specs (constructor/DI signature changes):
- `contracts.service.spec.ts` — added `mockProjectRepository` provider (defaults to returning a project so create() happy-paths pass).
- `contracts.service.access-wall.spec.ts` + `contracts.service.reads-access-wall.spec.ts` — inserted the `projectRepository` slot in the manual `build()` constructor calls.
- `obligations.service.reads-access-wall.spec.ts` — updated the now-stale comment that claimed `findByContract` was intentionally unwalled (S0 walls it).
- `compliance-obligations.controller.spec.ts` — added the `ContractAccessService` mock provider to both app factories (`findInOrg` resolves; `MOCK_USER` is in `ORG_ID`).

### Full backend suite

```
Test Suites: 2 skipped, 56 passed, 56 of 58 total
Tests:       20 skipped, 522 passed, 542 total
```

**522 passed = 511 baseline + 11 new.** Exact — no regressions. (Baseline 511/20-skip per the
`#53` commit message.)

---

## Git scope

- `CLAUDE.md` — PART 1 doc-fix (the one intentional CLAUDE.md exception for this task).
- `backend/src/modules/contracts/contracts.{service,module}.ts` — PART 2 project wall.
- `backend/src/modules/obligations/obligations.{service,controller}.ts` — PART 3 site 1.
- `backend/src/modules/compliance/controllers/compliance-obligations.controller.ts` — PART 3 site 2.
- `backend/src/modules/docusign/docusign.{service,controller,module}.ts` — PART 3 site 3.
- 4 new spec files + 4 touched spec files (above).
- `docs/s0-pre-option-b-fixes.md` — this note.

**NOT touched:** no scoped-repository, no metering engine, no `lessons.md`. The interim
`findInOrg` walls and the project check are the entire change surface.

---

## Carry-forward into Option B

- The three PART 3 `findInOrg` walls are tagged `INTERIM (S0)` in code. When Option B's scoped
  chokepoint lands, these become the controller/service-entry defense-in-depth check sitting
  ABOVE the scoped repo (audit §3.3) — keep them, do not delete.
- PART 2's inline project check is the seed of Option B's `ProjectScopedRepository`
  (audit §7) — it can fold into that pattern later.
- The corrected CLAUDE.md Phase 7.15 text now tells the truth: the obligation middleware is a
  `project_id` resolver, not a tenancy boundary. Do not re-add the false claim.
