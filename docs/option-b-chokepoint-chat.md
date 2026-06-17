# Option B — Chokepoint migration, module 3 of 4: CHAT

Branch base: `main` @ `3e8d931` (full Option B chokepoint + the CI-enforced
`no-bare-contract-repo-access` lint + module 1's paginated `scopedFindAndCount` +
module 2's guest-portal `GuestInvitationScopedRepository` all present — confirmed).
No PR, no merge — review digest.

Modules 1 (negotiation, #72) and 2 (guest-portal, #74) were the first two of the four
modules the Phase 7.18 lint surfaced as "wall-protected; chokepoint migration scheduled"
(negotiation / guest-portal / chat / compliance). This bucket migrates **CHAT**.

## Outcome in one line

**Chat wires NOTHING through the chokepoint — and that is the correct outcome.** Chat's
tenancy model is **`user_id` + `session_id` + denormalized `org_id` direct**, NOT
`contract → project → org`. The `contract_id` on both chat entities is **nullable** and
purely contextual. The lint flags chat's 19 sites because the *entities*
(`ChatSession` / `ChatMessage`) are in the over-inclusive enforced set — not because the
*reads* are contract-scoped. After classification: **18 of 19 are permanent
non-candidates** (8 writes + 10 user/session-scoped reads/injections), and **1 is a
genuinely contract-scoped read** (`buildLegalContext`'s parent-`Contract`+`project`
jurisdiction load) that is **deferred** for the same structural reason `export.service`
(already migrated, S2d) and the `compliance` sibling (module 4) leave the identical
shape bare.

No new scoped subclass. No base growth. All 19 `// lint-exempt` annotations
**re-labelled** to honest reasons. `npm run lint:contract-repo` stays **exit 0**.

---

## STEP 0 — Recon

### The chat entities + why they are NOT contract-scoped in practice

| Entity | File | `contract_id` | Denorm `org_id`? | Tenancy truth used by the code |
|--------|------|---------------|------------------|-------------------------------|
| `ChatSession` | `database/entities/chat-session.entity.ts` | **NULLABLE** (`@ManyToOne(Contract,{nullable:true,onDelete:'SET NULL'})`) | **YES** (`org_id` NOT NULL, FK→Organization) | `user_id` ownership (+ `org_id` denorm) |
| `ChatMessage` | `database/entities/chat-message.entity.ts` | **NULLABLE** | **YES** (`org_id` NOT NULL) | `session_id` (owning session already verified by `user_id`) |

Both entities carry a **nullable `contract_id`** *and* a **non-nullable denormalized
`org_id`**. A chat session may be **unbound** (general/no-contract chat) — `contract_id`
is `null` — or **contract-bound**. This is decisive: an INNER JOIN through
`session → contract → project → org` (what a chat scoped subclass would build)
**excludes every unbound row**, so it cannot be the tenancy path for chat's reads, all
of which must serve both bound and unbound sessions.

The wall: `ChatController.assertContractInCallerOrg` → `ContractAccessService.findInOrg`
on `dto.contract_id`, applied **only at `POST /chat/sessions`** (session create). The
access-wall spec documents the design explicitly: *"Closing the createSession path
closes the inherited sendMessage path too."* Every downstream read scopes by
`user_id` / `session_id` ownership; the stored `contract_id` was vetted once at create.

### The 19 lint-flagged sites — per-site classification

All 19 originally carried `// lint-exempt: wall-protected (findInOrg); chokepoint
migration scheduled`. Kinds: **inject** (3), **write** = `.save()` (8), **read** (8).
The lint's data-method set flags `save`/`find`/`findOne` but NOT the in-memory
`create()`/`merge()` — so every `.save()` is a flagged write.

| # | Site (`chat.service.ts`) | Caller | Kind | Contract-scoped? | Classification → Outcome |
|---|--------------------------|--------|------|------------------|--------------------------|
| 1 | `:45` `@InjectRepository(ChatSession)` | ctor | inject | — | Backs writes + user-scoped reads → **LEFT**, re-labelled (no chokepoint candidate). |
| 2 | `:47` `@InjectRepository(ChatMessage)` | ctor | inject | — | Backs writes + session-scoped reads → **LEFT**, re-labelled. |
| 3 | `:49` `@InjectRepository(Contract)` | ctor | inject | — | Backs the deferred `buildLegalContext` load only → **LEFT**, re-labelled. |
| 4 | `:70` `contractRepo.findOne({id, relations:['project']})` | `buildLegalContext` | **read** (by-id, hydrates `project`) | **YES** | **(deferred)** parent-`Contract`+`project` jurisdiction load. See "the one real candidate" below → **LEFT**, re-labelled honestly. |
| 5 | `:123` `sessionRepo.save` | `createSession` | write | — | **LEFT** (read-only base). Re-labelled `write (session insert)`. |
| 6 | `:130` `sessionRepo.findOne({id, user_id})` | `getSessionMessages` | read | **NO** (user-scoped; session may be unbound) | **(e)** → **LEFT**, re-labelled. |
| 7 | `:135` `messageRepo.find({session_id})` | `getSessionMessages` | read | **NO** (session-scoped) | **(e)** → **LEFT**, re-labelled. |
| 8 | `:145` `sessionRepo.findOne({user_id, contract_id})` | `findSessionByContract` | read | **NO** (user-scoped; see below) | **(e)** → **LEFT**, re-labelled. |
| 9 | `:166` `sessionRepo.findOne({id, user_id})` | `sendMessage` | read | **NO** (user-scoped; session may be unbound) | **(e)** → **LEFT**, re-labelled. |
| 10 | `:172` `messageRepo.save` | `sendMessage` | write | — | **LEFT**. Re-labelled `write (user message insert)`. |
| 11 | `:185` `messageRepo.find({session_id})` | `sendMessage` | read | **NO** (session-scoped) | **(e)** → **LEFT**, re-labelled. |
| 12 | `:230` `messageRepo.save` | `sendMessage` | write | — | **LEFT**. Re-labelled `write (assistant placeholder insert)`. |
| 13 | `:246` `sessionRepo.save` | `sendMessage` | write | — | **LEFT**. Re-labelled `write (session updated_at touch)`. |
| 14 | `:264` `messageRepo.findOne({id})` | `getMessageStatus` | read | **NO** (ownership enforced by the next lookup) | **(e)** → **LEFT**, re-labelled. |
| 15 | `:268` `sessionRepo.findOne({id, user_id})` | `getMessageStatus` | read | **NO** (user-scoped) | **(e)** → **LEFT**, re-labelled. |
| 16 | `:304` `messageRepo.save` | `getMessageStatus` | write | — | **LEFT**. Re-labelled `write (status→COMPLETED)`. |
| 17 | `:313` `messageRepo.save` | `getMessageStatus` | write | — | **LEFT**. Re-labelled `write (status→FAILED)`. |
| 18 | `:319` `messageRepo.save` | `getMessageStatus` | write | — | **LEFT**. Re-labelled `write (status→PROCESSING)`. |
| 19 | `:331` `messageRepo.save` | `failIfStale` | write | — | **LEFT**. Re-labelled `write (stale→FAILED)`. |

**Net: 8 writes (chokepoint is read-only) + 7 user/session-scoped reads + 3 injections =
18 permanent non-candidates; 1 deferred contract-scoped read (`buildLegalContext`).**
There is **NO** clean contract-scoped chat-entity read to wire and therefore **no chat
scoped subclass is built**.

### `findSessionByContract` (#8) — looks contract-scoped, is NOT (the nullable-contract wrinkle)

`findSessionByContract(userId, contractId)` filters `contract_id = :contractId`
(always non-null), so an inner join would not *exclude* an intended row. But its
**tenancy model is `user_id` ownership** — the session belongs to the caller — and the
`contract_id` is a **selector** (which of the caller's sessions), not the tenancy gate.
Three facts make it a **leave**:

1. The controller endpoint `GET /chat/sessions/by-contract` injects **no
   `@OrganizationId()`** — there is no request org in scope to scope by (same shape as
   guest-portal's `verify` #10: "scoping it would require an org the caller does not
   have"). It has **no `findInOrg` wall** either.
2. Routing it through `session → contract → project → org` would impose a contract→org
   tenancy model on a user-ownership read — exactly what the wrinkle protocol says NOT to
   do for "scoped by user/session/org directly, not by contract."
3. **Correctness regression:** a session is the user's own data. If the user's org
   changed after the session was created (the `contract_id` was vetted against the org
   *at create time*), a contract→org inner join would return **null** and the user would
   lose access to **their own** historical session. User-ownership is the right model;
   the chokepoint would break it.

### `buildLegalContext` (#4) — the one real contract-scoped read, and why it is deferred

```ts
const contract = await this.contractRepo.findOne({
  where: { id: contractId },     // contractId = session.contract_id, non-null when reached
  relations: ['project'],         // needed to read project.country → jurisdiction
});
const jurisdiction = resolveJurisdiction(contract?.project?.country);
```

This **is** a genuine contract-scoped read (loads a `Contract`, resolves to org
canonically via `contract → project → org`). It is request-scoped (`sendMessage`) and an
org IS available (threadable). But it is **deferred**, for converging reasons:

1. **It is a parent-`Contract`+`project` hydration load — the exact shape already
   migrated code leaves bare.** `export.service.generateRiskReport`/`generateContractReport`
   load `contractRepository.findOne({ where:{id}, relations:['project',…] })` **bare**
   (`// lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled`) and route
   only their **child** reads (`riskScoped`/`obligationScoped`) through the chokepoint. The
   `compliance` sibling (module 4) does the **identical** jurisdiction-derivation load
   (`compliance.service.ts:120`, `relations:['project']` → `project.country`) and is still
   bare. Wiring chat's instance bespoke now would diverge from both its sibling and the
   established pattern.

2. **Its shape genuinely can't use the existing base methods cleanly** (Ayman B spec —
   "minimal/additive base only; if a read genuinely can't use the existing methods, STOP
   and report"):
   - `scopedFindByIdOrThrow` **throws** on miss — `buildLegalContext` requires **silent
     null** fallback (chat must proceed without legal grounding) — and does **not hydrate
     `project`**.
   - `scopedFind({id}, orgId, {relations:['project']})` would **alias-collide**: the ROOT
     `ContractScopedRepository` gate uses the alias **`project`** (S1 — unlike the child
     repos which use `org_gate_project` precisely to avoid this), so the relation
     hydration `leftJoinAndSelect('contract.project','project')` clashes with the gate's
     `innerJoin('contract.project','project')`. It also needs `'id'` added to the ROOT's
     (empty) allowlist and returns a list for a single row.

   A clean wire would require **re-aliasing the ROOT gate to `org_gate_project`** (an
   S1/ROOT change + spec update affecting the shared base subclass) — out of module-3's
   mechanical scope.

3. **Low exposure + already protected.** The id is `session.contract_id`, vetted against
   the org by the upstream `createSession` `findInOrg` wall, on a **user-owned** session.
   The only value read is `project.country` → a jurisdiction ISO used to pick **public**
   law passages for AI grounding (the legal corpus is jurisdiction-keyed public law, not
   org-private data). The marginal tenancy gain of the chokepoint here is small.

**Recommended follow-up (NOT done here, to avoid guessing):** resolve this *together with
compliance* (module 4), since both derive jurisdiction from `contract → project →
country` with the identical bare parent load. Either (a) re-alias the ROOT
`ContractScopedRepository` gate to `org_gate_project` and add `'id'` to its allowlist so
`scopedFind({id}, orgId, {relations:['project']})` works, returning `rows[0] ?? null`
(silent fallback preserved); or (b) add a minimal additive base method
`scopedFindByIdWithRelations(id, orgId, relations): T | null` (by-id, org-scoped,
single-level relations, null on miss) — used by chat *and* compliance. A bespoke
`scopedFindById`-gate + two-step `project` hydration is possible today but leaves a bare
hydration read and diverges from the sibling — so it is left as a documented option, not
applied.

### Denorm columns (Q1)

Both chat entities carry a denormalized `org_id`. Per Ayman B spec Q1 the chokepoint is
**canonical-only** (`contract → project → org`); the denorm `org_id` is non-authoritative
and is **ignored** for chokepoint purposes. Because chat wires nothing, there is no
canonical-vs-denorm drift to probe here; the denorm `org_id` is noted for the future
denorm-read lint (it is what the code uses today for the user/session-scoped writes).

---

## STEP 1-2 — Scoped subclass + wire

**None.** No chat scoped subclass is created (no clean contract-scoped chat-entity read
exists). No base method is added (the one candidate is deferred per the protocol). The
only change is the re-labelling of all 19 `// lint-exempt` annotations:

- **8 writes** → `write (...); the scoped chokepoint is read-only` (permanent).
- **7 user/session-scoped reads** → `user-scoped` / `session-scoped` read; `not a
  contract→org read` (permanent), with `findSessionByContract` carrying the
  org-change-correctness note.
- **3 injections** → backing-reason re-labels (permanent; the `Contract` inject points at
  the deferred load).
- **1 deferred read** (`buildLegalContext`) → honest `DEFERRED contract-scoped read …`
  reason naming the `scopedFindByIdOrThrow`-throws / `scopedFind`-alias-collision blocker
  and the export/compliance precedent.

`npm run lint:contract-repo` → **exit 0** (every site keeps a non-empty `// lint-exempt:`
reason; the lint only requires a reason to exist).

---

## Red→green

No site was wired → **no red→green proof is produced** (there is nothing to flip from a
data-layer leak to a denial). The verification posture is instead:

- **No behaviour change** — the migration is comment-only (19 re-labels). The full
  backend suite is therefore expected to be **byte-identical green** before and after.
- The chat specs in particular (`chat.controller.access-wall.spec.ts`,
  `chat.service.async.spec.ts`, `chat.service.legal-context.spec.ts` — incl. the #61
  legal-corpus chat-context + async paths) are **unchanged and green** (no re-aim
  needed — no wall moved, no repo mock swapped to a scoped repo).

---

## Suite + lint

| | Before (`3e8d931`) | After |
|---|---|---|
| Backend suite (`npx jest --runInBand`, in-container, real PG) | 106 suites / 950 tests | 106 suites / 950 tests |
| Delta | — | **0** (comment-only) |
| `npm run lint:contract-repo` | exit 0 | exit 0 |

---

## Decision carried forward to module 4 (compliance)

Chat confirms two rules for the remaining module:

1. **The lint flags by ENTITY, not by access pattern** (deliberately over-inclusive). A
   flagged module is not automatically a chokepoint module — classify each site by its
   *actual* tenancy model. Chat's is `user_id`/`session_id`/`org_id`-direct; almost none
   of its flagged sites are contract-scoped reads.
2. **The `contract → project → country` jurisdiction parent-load is a recurring deferred
   shape** (chat `buildLegalContext`, compliance `runCheck`, export reports). It needs a
   *unified* resolution — a ROOT gate re-alias (`org_gate_project`) + `'id'` allowlist, or
   a minimal `scopedFindByIdWithRelations` base method — decided when compliance migrates,
   not bespoke per consumer.
