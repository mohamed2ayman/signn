# Option B — Chokepoint migration, module 2 of 4: GUEST-PORTAL

Branch base: `main` @ `d8cca96` (full Option B chokepoint + the CI-enforced
`no-bare-contract-repo-access` lint + module 1's paginated `scopedFindAndCount`
present — confirmed). No PR, no merge — review digest.

Module 1 (negotiation, #72) was the first of the four modules the Phase 7.18 lint
surfaced as "wall-protected; chokepoint migration scheduled" (negotiation /
guest-portal / chat / compliance). This bucket migrates **GUEST-PORTAL**, keeping
every existing wall as defense-in-depth underneath (two layers, never a swap).

The defining feature of guest-portal is that it has **THREE distinct auth surfaces**,
and the recon classifies every bare site by which one it is under — because they get
different treatment.

---

## STEP 0 — Recon

### Entities + canonical chains (BOTH CLEAN — no denorm column)

| Entity | File | Chain to org | Denorm org col? |
|--------|------|--------------|-----------------|
| `GuestInvitation` | `database/entities/guest-invitation.entity.ts` | `inv.contract_id → Contract.project_id → Project.organization_id` | **NONE** |
| `GuestContractAccess` | `database/entities/guest-contract-access.entity.ts` | `gca.contract_id → Contract.project_id → Project.organization_id` (+ a `user_id` to the guest) | **NONE** |

Both have a direct `contract_id` FK + `@ManyToOne(() => Contract)`; the `contract_id`
FK is the sole tenancy truth (like NegotiationEvent / RiskAnalysis). **No drift
surface → no canonical-only/drift probe, nothing to flag for the denorm-read lint.**

> The binding question (how a guest/viewer resolves to a contract → org): for an
> AUTHENTICATED guest user row, `GuestContractAccess` binds `(user_id, contract_id)`
> and `ContractAccessService.findAccessibleContract` (the wall) walks
> `binding → contract → project → org`. For a VIEWER credential, the bound
> `contract_id` rides INSIDE the HMAC token (see auth surfaces below).

### The three auth surfaces

| Surface | Routes | Caller shape | Chokepoint candidate? |
|---------|--------|--------------|-----------------------|
| **JWT (managing user)** | `POST /guest-invitations` (create), `DELETE /guest-invitations/:id` (revoke) — `@UseGuards(JwtAuthGuard)` | managing user **WITH an org** | **YES** — normal request-scoped reads. |
| **VIEWER credential** | `GET /viewer/contracts/:id` — `@UseGuards(ViewerCredentialGuard)`, `Authorization: Viewer <token>` | sparse `{type:'viewer', viewer:{contract_id, invitation_id}}` — **no user_id, no role, no org** | **N/A** — has NO bare guest-portal read (see below). |
| **PUBLIC token** | `POST /public/guest-invitations/{exchange,establish-identity}` — no guard | **no authenticated user**, gated by the HMAC invitation token | **NO** — not request-scoped-with-an-org; leave + flag. |

### The viewer-credential surface — assessed: NOT STOP territory; nothing to migrate

`ViewerPortalController.findById` delegates the entire read to
`ContractAccessService.findAccessibleContract(id, viewer)` — **the WALL** (a
chokepoint-excluded path: `modules/contracts/services/contract-access.service.ts` is
in the lint's `chokepointPathFragments`). `ViewerCredentialService` is pure stateless
HMAC (**zero DB access**); `ViewerCredentialGuard` is HMAC-only. So the viewer surface
has **no bare contract-scoped read in guest-portal at all** — its contract load is the
wall itself. It is cleanly classifiable (not ambiguous), so per the STOP protocol it
does NOT need a decision: there is simply nothing to wire there.

### The 10 lint-flagged sites — per-site, per-auth-surface classification

All 10 originally carried `// lint-exempt: wall-protected (findInOrg); chokepoint
migration scheduled`.

| # | File:site | Caller | Auth surface | Kind | Classification → Outcome |
|---|-----------|--------|--------------|------|--------------------------|
| 1 | `guest-invitation.service.ts:71` `@InjectRepository(GuestInvitation)` | ctor | — | inject | Backs the two **writes** (#2,#4) after migration → **LEFT**, re-labelled `write-path repo …; the by-id READ goes through GuestInvitationScopedRepository`. |
| 2 | `:106` `invitationRepo.save` (`create`) | create | JWT/org | **write** (insert) | Scoped repos are read-only → **LEFT** bare+exempt, re-labelled `write (create insert); wall-protected (findInOrg on dto.contract_id)`. |
| 3 | `:125` `invitationRepo.findOne({where:{id}})` (`revoke`) | revoke | **JWT/org** | **read** (by-id) | (b) by-id load → **WIRED** through `scopedFindByIdOrThrow`. Annotation **REMOVED**. |
| 4 | `:150` `invitationRepo.save` (`revoke`) | revoke | JWT/org | **write** (update) | **LEFT** bare+exempt, re-labelled `write (revoke status update) of the scoped-validated row` (S2f `updateExtractedText` shape). |
| 5 | `:180` `invitationRepo.save` (`exchange`) | exchange | **PUBLIC token** | **write** | **LEFT** + flag, re-labelled `PUBLIC token-gated path (exchange); … no request org`. |
| 6 | `:261` `manager.getRepository(GuestInvitation)` (`establishIdentity`) | establishIdentity | **PUBLIC token** | getRepository (txn SELECT-FOR-UPDATE + save by token-derived id) | **LEFT** + flag, re-labelled `PUBLIC token-gated path (establish-identity); … no request org`. |
| 7 | `:263` `manager.getRepository(GuestContractAccess)` (`establishIdentity`) | establishIdentity | **PUBLIC token** | getRepository (txn race-guard read + binding write) | **LEFT** + flag, re-labelled `PUBLIC token-gated path (establish-identity); … no request org`. |
| 8 | `:491` `dataSource.getRepository(ContractComment)` (`writeGuestComment`) | writeGuestComment | guest (no org) / public | **write** (comment insert) | **LEFT** + flag, walled by `findAccessibleContract`; guest has no org → re-labelled `guest WRITE … guest has no org`. |
| 9 | `invitation-token.service.ts:65` `@InjectRepository(GuestInvitation)` | ctor | **PUBLIC token** | inject | Backs verify's read → **LEFT** + flag, re-labelled `PUBLIC token-gated path (verify); HMAC-before-DB by-id load, no request org`. |
| 10 | `:131` `invitationRepo.findOne({where:{id}})` (`verify`) | verify | **PUBLIC token** | **read** (by-id) | (e→leave) the by-id load is by a **token-derived** id with **NO request org** — the HMAC token IS the auth (lesson #141). Cannot be org-scoped → **LEFT** + flag, re-labelled. |

**Net: guest-portal has exactly ONE request-scoped-with-an-org contract-scoped READ**
— `revoke`'s by-id load (#3). Everything else is a write (chokepoint is read-only) or
a PUBLIC token-gated / guest-no-org path (no org to scope by). The `verify` read (#10)
*looks* like a chokepoint candidate but is NOT: its id comes from the verified HMAC
payload and there is no authenticated org in scope — scoping it would require an org
the caller does not have.

### Pattern question — the inline wall (decided: KEEP INLINE per precedent)

`revoke`'s wall is `ContractAccessService.findInOrg(invitation.contract_id, org)` —
**not** a home-grown wall; it's `findInOrg` directly (guest-portal already imports
`ContractsModule`/`ContractAccessService`). Per the module-1 precedent: **keep the
wall as layer 1; add the scoped chokepoint underneath.** A wall swap is never bundled
into chokepoint wiring. Here there is nothing to "swap" — `findInOrg` stays exactly
where it was; the scoped load is added in front of it as layer 2.

### revoke read shape (decided: by-id, scoped-first then wall)

`revoke` is a **by-id load** (no contractId in the route → automatic parent-contract
resolution), so it uses the existing `scopedFindByIdOrThrow` (no base growth needed).
ORDERING is the **S2f `updateExtractedText` / S2e `Notice.findById` shape**: the wall
needs the loaded row's `contract_id`, so the **scoped load runs FIRST** (layer 2,
data-layer tenancy), then `findInOrg` runs on the scoped row's `contract_id` (layer 1,
live defense-in-depth). The scoped row carries every `GuestInvitation` column (the gate
inner-joins for filtering, not selecting), so it is mutated and saved directly.

---

## STEP 1 — Scoped subclass (no base growth)

- **`guest-invitation-scoped.repository.ts`** (new) — `org_gate_contract` /
  `org_gate_project` join aliases (collision-free with any future `contract`
  hydration), `entityAlias = 'inv'`, `notFoundMessage = 'Invitation not found'`
  (byte-faithful to `revoke`'s existing throw), **`allowedFilterKeys = ∅` (EMPTY)** —
  `revoke` is by-id only, so NO `scopedFind` caller exists; any filter key throws until
  a future bucket deliberately wires one. `buildScopedQuery` (by-id + override safety)
  + `buildScopedListQuery` implemented faithfully for the base contract.
- **`scoped-repository.module.ts`** — `GuestInvitation` added to `forFeature`;
  `GuestInvitationScopedRepository` added to providers + exports; module doc updated.

No base method was added — `scopedFindByIdOrThrow` (S1) covers the by-id load.

---

## STEP 2 — Wire (wall stays, scoped underneath)

- **`guest-invitation.service.ts`** — `revoke` now: (1) guard `actor.organization_id`
  present, (2) `invitationScoped.scopedFindByIdOrThrow(invitationId, org)` (layer 2),
  (3) `contractAccess.findInOrg(invitation.contract_id, org)` (layer 1, UNCHANGED),
  (4) idempotent re-revoke / status flip / bare `save`. The other 8 sites' exemptions
  re-labelled to honest **permanent** reasons (writes / PUBLIC token / guest-no-org);
  site #3's annotation **REMOVED** (satisfies the lint by being wired).
- **`invitation-token.service.ts`** — 2 exemptions re-labelled (PUBLIC token path).
- **`guest-portal.module.ts`** — imports `ScopedRepositoryModule`.

`npm run lint:contract-repo` → **exit 0** (the migrated read satisfies the rule by
being wired; the 9 retained sites carry honest, non-"scheduled" reasons).

---

## Red→green (the one wired site: `revoke`)

**RED form (wall-neutralized independent denial, per the module-1 / S2c-S2f
convention):** `revoke` is already walled, so a normal cross-tenant probe is denied by
the WALL and cannot reproduce a data-layer red. The red therefore NEUTRALIZES the wall
and demands the scoped load deny on its own. Pre-wire, `revoke`'s bare
`invitationRepo.findOne({where:{id}})` applied **NO org filter** — with the wall
neutralized (a wall bug/bypass), an orgB caller revoking orgA's invitation would have
loaded **and revoked** it (a cross-org write). Post-wire, the canonical
`inv→contract→project→org` join returns null → no-existence-leak 404. **No drift probe**
(no denorm column — documented).

**Green proofs:**
- `guest-invitation-scoped.repository.spec.ts` (real Postgres, 11 tests) — cross-org
  `scopedFindById` → null and `scopedFindByIdOrThrow` → 404 `'Invitation not found'`
  (the bare-read leak, closed); `contractIdOverride` only narrows (foreign override →
  null; cross-org caller + the row's own contract as override → still null); the
  `scopedFind({})` list gate is org-bounded even with the empty allowlist; wall +
  scoped deny INDEPENDENTLY (coexistence).
- `guest-invitation-scoped.allowlist.spec.ts` (unit, 5 tests) — empty `{}` filter
  allowed; **every** filter key (incl. `contract_id`) and hostile keys throw before SQL,
  via BOTH `scopedFind` and `scopedFindAndCount`.
- `guest-invitation.service.scoped-wiring.spec.ts` (unit, 5 tests) — org-missing guard
  short-circuits before the scoped load; scoped layer denies alone (404, wall not
  reached, no write); **live wall-denial** (scoped resolves but wall 404s → no write —
  proves the wall is NOT dead code); happy path consults BOTH layers (REVOKED +
  revoked_at set); idempotent re-revoke returns without a write (both layers still run).
- `guest-invitation-identity.service.spec.ts` — updated to provide the new scoped-repo
  DI token (establishIdentity is a PUBLIC path and never calls it).

---

## Suite + lint

| | Before (`d8cca96`) | After |
|---|---|---|
| Backend suite (`npx jest --runInBand`, in-container, real PG) | 103 suites / 929 tests | **106 suites / 950 tests** |
| Delta | — | **+3 suites, +21 tests** |
| Real-PG specs skipped | 0 | **0** (the new repo spec ran against live Postgres) |
| `npm run lint:contract-repo` | exit 0 | **exit 0** |

All pre-existing tests stay green; the negotiation + S2a–S2f scoped specs and the base
allowlist spec are unaffected (no base growth this bucket).

---

## Per-site digest

| Site | Auth surface | Classification | Outcome |
|------|--------------|----------------|---------|
| `revoke` by-id `findOne` | JWT/org | (b) by-id read | **WIRED**: scoped (layer 2) + wall stays (layer 1). Red: wall-neutralized independent denial + real-PG cross-org 404. Annotation REMOVED. |
| `create` `save` | JWT/org | write | **LEFT** bare+exempt (write; wall on dto.contract_id). Re-labelled. |
| `revoke` `save` | JWT/org | write | **LEFT** bare+exempt (write of scoped-validated row). Re-labelled. |
| `@InjectRepository(GuestInvitation)` (service) | — | inject (write backing) | **LEFT** bare+exempt. Re-labelled. |
| `exchange` `save` | PUBLIC token | write | **LEFT** + flag (no request org). Re-labelled. |
| `establishIdentity` `getRepository(GuestInvitation)` | PUBLIC token | txn read+write by token id | **LEFT** + flag (no request org). Re-labelled. |
| `establishIdentity` `getRepository(GuestContractAccess)` | PUBLIC token | txn read+write | **LEFT** + flag (no request org). Re-labelled. |
| `writeGuestComment` `getRepository(ContractComment)` | guest / public | write | **LEFT** + flag (walled by findAccessibleContract; guest has no org). Re-labelled. |
| `verify` `@InjectRepository` + `findOne` | PUBLIC token | by-id read by token id | **LEFT** + flag (HMAC-before-DB; no request org — lesson #141). Re-labelled. |
| `ViewerPortalController.findById` | viewer credential | delegates to the wall | **N/A** — no bare guest-portal read; contract load IS `findAccessibleContract` (the wall). |

## Decision carried to the remaining modules (chat / compliance)

The viewer-credential surface confirms a general rule: **a token-only / no-org surface
whose contract read is delegated to `findAccessibleContract` has nothing to
chokepoint** — the wall is the read. PUBLIC token paths and writes stay bare with
honest permanent reasons. Only request-scoped-with-an-org READS migrate.
