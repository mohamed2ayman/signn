# Option B — Chokepoint migration, module 1 of 4: NEGOTIATION

Branch base: `main` @ `b3db0a8` (full Option B chokepoint + CI-enforced
`no-bare-contract-repo-access` lint present — confirmed). No PR, no merge — review
digest.

The Phase 7.18 lint surfaced ~104 bare contract-scoped accesses across 4 modules
the Option B refactor never wired (negotiation / guest-portal / chat / compliance).
They are SAFE today (behind `findInOrg`/inline walls) but allowlisted as
`// lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled`. This
bucket migrates **NEGOTIATION** — the first and smallest (~5 sites) — onto the
scoped chokepoint, keeping the existing wall as defense-in-depth underneath.

---

## STEP 0 — Recon

### Entity + canonical chain (CLEAN)

One entity: `NegotiationEvent` (`database/entities/negotiation-event.entity.ts`),
direct `contract_id` FK + `@ManyToOne(() => Contract)`.

```
NegotiationEvent.contract_id → Contract.project_id → Project.organization_id → org
```

Join columns verified: `Contract.project_id` (contract.entity.ts:122),
`Project.organization_id` (project.entity.ts:23). Chain reaches org canonically.

**Denorm column: NONE.** Unlike Notice/Claim/SubContract (drift-prone `org_id`),
`NegotiationEvent` carries no denormalized org column → no drift surface, no
canonical-only/drift probe needed, nothing to flag for the future denorm-read lint.

### The 5 lint-flagged sites (all in `negotiation.service.ts`)

All 5 originally carried `// lint-exempt: wall-protected (findInOrg); chokepoint
migration scheduled`.

| # | Site | Caller | Kind | Classification → Outcome |
|---|------|--------|------|--------------------------|
| 1 | `@InjectRepository(NegotiationEvent)` | ctor | inject | Backs the **write** (#3) + the read (#4). After migration, kept bare for the WRITE → exemption re-labelled `wall-protected (assertContractInOrg) — write path; reads via scoped chokepoint`. |
| 2 | `@InjectRepository(Contract)` | ctor | inject | Backs ONLY the inline wall (#5). **KEPT** (decision: keep inline) → re-labelled `inline contract-access wall (canonical contract→project→org gate)`. |
| 3 | `eventRepository.save(event)` | `createEvent` | **write** | Not a read; scoped repos are read-only → stays bare+exempt `wall-protected (assertContractInOrg) — row validated before write` (mirrors `NoticesService:90`). |
| 4 | `eventRepository.createQueryBuilder('event')` | `findHistory` | **read** (paginated LIST) | (a) per-contract LIST → **WIRED** through `scopedFindAndCount`. Annotation **REMOVED**. |
| 5 | `contractRepository.createQueryBuilder('contract')` | `assertContractInOrg` | inline WALL body | **KEPT** inline → re-labelled `inline contract-access wall (canonical contract→project→org gate)`. |

Negotiation has exactly **one read** (`findHistory`) and **no by-id load** — so
there is no `scopedFindByIdOrThrow` caller here. The whole chokepoint surface is
that single paginated list read.

### Pattern question — `assertContractInOrg` (decided: KEEP INLINE)

```ts
private async assertContractInOrg(contractId, orgId): Promise<void> {
  const contract = await this.contractRepository
    .createQueryBuilder('contract')
    .innerJoin(Project, 'project', 'project.id = contract.project_id')
    .where('contract.id = :contractId', { contractId })
    .andWhere('project.organization_id = :orgId', { orgId })
    .getOne();
  if (!contract) throw new NotFoundException('Contract not found');
}
```
Call sites: `createEvent`, `findHistory` (both before any data work).

Enforces the **identical tenancy gate** as `ContractAccessService.findInOrg`
(same `contract.id ∧ project.organization_id`, same no-leak
`NotFoundException('Contract not found')`). `findInOrg`'s own doc states it
*"Matches the assertContractInOrg convention in negotiation.service.ts."*
Differences: `assertContractInOrg` returns `void` from a 1-join existence check;
`findInOrg` runs 5 `leftJoinAndSelect` + `scrubAndSort` and returns a hydrated
`Contract`. NegotiationModule does **not** import `ContractAccessService` today.

**Decision (ratified): KEEP INLINE.** Consolidating to `findInOrg` would run a
heavier hydrating load whose result `findHistory`/`createEvent` discard, and add
a cross-module dependency — a behavior change for zero functional gain. The scoped
chokepoint is added UNDERNEATH the inline wall (two layers, never a swap).

**Cross-module precedent (guest-portal / chat / compliance):** when a module owns
an inline wall that already performs the canonical `contract → project → org`
no-leak gate, **keep it as layer 1**; only fold into `findInOrg` as a *deliberate
separate refactor* when that module already imports `ContractAccessService` AND
the call site actually needs the hydrated contract. Never bundle a wall swap into
chokepoint wiring.

### findHistory read shape (decided: GROW THE BASE)

`findHistory` is a paginated LIST: `take/skip + getManyAndCount → {events, total}`,
`leftJoinAndSelect('event.performer')`, order `created_at DESC`, filters
`contract_id` (always) + `clause_ref` (optional). The base `scopedFind` returns
`getMany()` — **no pagination, no count** (grep confirmed zero `take`/`skip`/
`getManyAndCount` anywhere in the scoped module). So `findHistory` could not use the
existing surface.

**Decision (ratified): GROW THE BASE** — add an additive `scopedFindAndCount`
(returns `[rows, total]`, optional `take`/`skip`) and create
`NegotiationEventScopedRepository`. Sets the paginated pattern chat/compliance
will reuse.

---

## STEP 1 — Base growth + scoped subclass

- **`scoped-contract.repository.ts`** — added `scopedFindAndCount(filter, orgId,
  {relations, order, take, skip}) → Promise<[T[], number]>`. The filter-KEY
  allowlist guard + relation/order application are extracted into a shared private
  `applyScopedListOptions` used by BOTH `scopedFind` and `scopedFindAndCount`, so
  the guard is byte-identical (the error message string is unchanged → existing
  allowlist specs stay green). `take/skip` are pure pagination; the
  `project.organization_id = :orgId` gate bounds BOTH the page and the count, so
  `total` can never include a cross-tenant row. First paginated method on the base
  — minimal/additive (no operator/range DSL; complex reads still stay raw QB, Q3).
- **`negotiation-event-scoped.repository.ts`** (new) — `org_gate_contract` /
  `org_gate_project` join aliases (collision-free with `performer` hydration),
  `entityAlias = 'event'`, `allowedFilterKeys = {contract_id, clause_ref}`,
  `notFoundMessage = 'Negotiation event not found'`. `buildScopedQuery` (by-id,
  faithful base contract incl. override safety) + `buildScopedListQuery`.
- **`scoped-repository.module.ts`** — `NegotiationEvent` added to `forFeature`;
  `NegotiationEventScopedRepository` added to providers + exports; module doc
  updated.

---

## STEP 2 — Wire (wall stays, scoped underneath)

- **`negotiation.service.ts`** — `findHistory` now: (1) `assertContractInOrg`
  (layer 1, UNCHANGED), then (2) `negotiationEventScoped.scopedFindAndCount(
  {contract_id[, clause_ref]}, orgId, {relations:['performer'], order:{created_at:
  'DESC'}, take, skip})` (layer 2). `createEvent` unchanged (wall + bare write).
  Exemptions re-labelled per the table above; site #4's annotation REMOVED (now
  satisfies the lint by being wired, not exempt).
- **`negotiation.module.ts`** — imports `ScopedRepositoryModule`.

`npm run lint:contract-repo` → **exit 0** (the migrated read satisfies the rule by
being wired; the 4 retained sites carry honest, non-"scheduled" reasons).

---

## Red→green (per wired site: findHistory)

**RED form (stated, per the S2c-S2f convention):** `findHistory` is already
walled, so a normal cross-tenant probe is denied by the WALL — it cannot reproduce
a data-layer red. The red therefore NEUTRALIZES the wall and demands the scoped
load deny on its own. Pre-wire, `findHistory`'s bare QB filtered **only** on
`contract_id`; with the wall neutralized, an orgB caller passing orgA's contractId
would have received all of orgA's events + a non-zero `total` (the leak).
Post-wire, the canonical `event→contract→project→org` join returns `[[], 0]`.

**Green proofs:**
- `negotiation-event-scoped.repository.spec.ts` (real Postgres, 15 tests) —
  cross-org caller gets `[[], 0]` for orgA's contract (the bare-filter leak,
  closed); pagination pages rows while `total` stays the full org-scoped count;
  `clause_ref` narrows; `performer` hydration coexists with the gate; by-id
  no-leak 404; wall + scoped deny INDEPENDENTLY (coexistence). **No drift probe**
  (no denorm column — documented).
- `negotiation-event-scoped.allowlist.spec.ts` (unit, 5 tests) — `contract_id` +
  `clause_ref` allowed; non-allowlisted/hostile keys throw before SQL, via BOTH
  `scopedFind` and `scopedFindAndCount`.
- `negotiation.service.scoped-wiring.spec.ts` (unit, 5 tests) — WALL-BYPASSED
  cross-tenant → scoped denies alone (`{events:[], total:0}`); happy path
  consults both layers; **live wall-denial**: wall 404 short-circuits before
  `scopedFindAndCount` (proves it is NOT dead code); `clause_ref` added to filter
  only when provided; limit/offset clamped → take/skip.

---

## Suite + lint

| | Before (`b3db0a8`) | After |
|---|---|---|
| Backend suite (`npm test --runInBand`, in-container) | 100 suites / 904 tests | **103 suites / 929 tests** |
| Delta | — | **+3 suites, +25 tests** |
| `npm run lint:contract-repo` | exit 0 | **exit 0** |

All pre-existing tests stay green; the S2c–S2f scoped specs + the base allowlist
spec are unaffected by the `applyScopedListOptions` extraction.

---

## Per-site digest

| Site | Classification | Outcome |
|------|----------------|---------|
| `findHistory` QB read | (a) per-contract LIST (paginated) | **WIRED**: wall stays (layer 1) + `scopedFindAndCount` under (layer 2). Red form: wall-neutralized independent denial + real-PG `[[], 0]` cross-org. Green. Annotation REMOVED. |
| `createEvent` `save` | write (not a read) | **LEFT** bare+exempt: scoped repos are read-only; row validated by the wall before write. Reason re-labelled. |
| `assertContractInOrg` QB | inline WALL (layer 1) | **LEFT** inline (KEPT, not consolidated). Reason re-labelled to permanent inline-wall. |
| `@InjectRepository(NegotiationEvent)` | inject (write backing) | **LEFT** bare+exempt (write path). Reason re-labelled. |
| `@InjectRepository(Contract)` | inject (wall backing) | **LEFT** bare+exempt (inline wall). Reason re-labelled. |

## assertContractInOrg decision for the other 3 modules

**Keep home-grown canonical walls inline as layer 1; add the scoped chokepoint
underneath.** Only consolidate a module's inline wall into
`ContractAccessService.findInOrg` as a separate, deliberate refactor — and only
when that module already imports `ContractAccessService` and the call site needs
the hydrated contract. Consolidation is never bundled into chokepoint wiring (it
would be a swap, not the two-layer add).
