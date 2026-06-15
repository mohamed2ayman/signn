# Phase 7.18 Close-Out Report — FINAL

> **STATUS: FINAL.** Assembled read-only against `main @ d7d1c7a` (the lint
> enforcement capstone, PR #71). All Option B buckets have landed; the contract-repo
> chokepoint is now CI-enforced. This supersedes `docs/phase-7.18-closeout-DRAFT.md`
> (which was cut at `main @ 8f42e0e`, before S2d/S2e/processor/S2f/lint). Every PR
> number, SHA, and suite count below is quoted from `git log` merge commits, the
> per-bucket evidence docs in `docs/`, CLAUDE.md, or lessons.md. Items not confirmable
> verbatim from history are marked **[derived]** or **[unverified]** inline.

Sources: `git log` on `main`; CLAUDE.md (Rule 9, Rule 11, "Metering Engine Invariants",
"Phase 7.18 Part 2"); lessons.md (#145–#152, #168); and the `docs/` evidence files
(all confirmed present in the tree): `option-b-scoped-repository-audit.md`,
`option-b-s1-scoped-repo-base.md`, `option-b-s2-child-scoping.md`,
`option-b-s2a-clean-children.md`, `option-b-s2b-contract-comment.md`,
`option-b-s2f-document-upload-recon.md`, `option-b-lint-phase1-inventory.md`,
`s0-pre-option-b-fixes.md`, `s0-part2-child-id-walls.md`,
`tenant-isolation-tier{1,2,3}.md`, `step3-remaining-audit.md`,
`compliance-access-wall-fix.md`,
`metering-{engine-PR,part2-PR,upload-extraction,finalize-review,risk-recon,part2-staging-gate}.md`.

---

## 1. Scope

Phase 7.18 covered three interlocking workstreams:

1. **Metering** — the shared metering engine primitive plus its first three wired
   consumers (compliance run, upload-extraction, finalize-review), with the `risk`
   meter_key deliberately left reserved-unused.
2. **Cross-tenant authorization remediation** — triggered by the PR #42/#45 class of
   bug (a contract-scoped load with no org filter), a systematic sweep found the same
   missing invariant across the backend. Remediation ran in two phases: **Option A**
   (interim `findInOrg` walls — Tiers 1–3 + S0 + S0-part-2) and **Option B** (the
   permanent scoped-repository refactor — S1 → S2a → S2b → S2c → S2d → S2e →
   processor → S2f).
3. **The enforcement capstone** — a CI-enforced ESLint rule
   (`no-bare-contract-repo-access`) + CLAUDE.md Architecture Rule 11, so the invariant
   is now machine-enforced rather than discipline-enforced (PR #71).

The missing invariant, codified in the Option B audit
(`docs/option-b-scoped-repository-audit.md`, spec item B1): *loading a contract-scoped
entity REQUIRES an `orgId` and filters by it; no unscoped `findOne` path remains
callable by accident.* Resolution is always the canonical chain
`contract → project → project.organization_id`; cross-tenant probes return **404, never
403** (no existence leak).

---

## 2. Metering — delivered

### 2.1 Engine — PR #46 (`9200f38`, merged 2026-06-05)

`feat(metering): metering engine primitive (7.18) — engine only, no consumer wiring`.
Branch engine commit `dc31bb6` per CLAUDE.md. Shipped: schema (`meter_definitions` /
`plan_allowances` / `subject_allowances` / `metering_balance` / `metering_ledger`); the
allowance resolver (`subject_allowance → plan_allowance → default_limit`, row-presence
branching, `limit = 0` binding); the `MeteringService` authority (reserve / commit /
release as atomic conditional UPDATEs); the dangling-reserve sweeper; and the READ
COMMITTED startup invariant. 20 real-Postgres concurrency + precedence tests; full suite
**430/430** at merge. The real-PG specs were gated on `DATABASE_URL` in the same PR (skip
LOUD in CI, run in-container) so unit-only CI stays green. The seven engine invariants
live in CLAUDE.md ARCHITECTURE RULES Rule 9 + the "Metering Engine Invariants" section;
engine-earned lessons #148–#150.

### 2.2 Consumer 1 — compliance run, PR #49 (squash `49f785f`, 2026-06-06)

First wired consumer: managing-user compliance run
(`POST /contracts/:id/compliance-checks`). Pattern locked for all future consumers:
**reserve in-request BEHIND the #45 access wall → run → commit/release across the async
boundary** (`refreshFromAi` terminal handlers + both synchronous fail paths) → engine
sweeper as backstop for never-polled runs. `reservation_id` persisted on
`compliance_checks` via additive migration `1754000000001` (nullable, partial index,
**no FK** to `metering_ledger` — attribution, not ownership). Four ops-search signals
(`metering.compliance.{committed_after_release|released_after_terminal|commit_error|release_error}`).
Engine untouched. 5-scenario live verification vs real Postgres + real Anthropic. Suite
**446/446** at merge. Explicitly NOT staging-verified — see §8 (G.1–G.7 are a Phase 9
release-gate, not a merge-gate; `docs/metering-part2-staging-gate.md`).

### 2.3 Consumer 2 — upload_extraction, PR #53 (`9bd4d55`, 2026-06-08)

Managing-user upload path (`uploadAndProcess`), mirroring the Part 2 pattern verbatim:
Tier-1 wall → reserve → dispatch; `reservation_id` on `document_uploads` (additive
migration, partial index, no FK); lazy poll-driven reconcile in `pollAndAdvance` owning
**5 terminal points** — commit on `CLAUSES_EXTRACTED`, release on async `failed`, release
on `HUMAN_REVIEW_RECOMMENDED` (the Phase 7.25 parked terminal — no clauses = refund),
release on the sync-dispatch catches, plus `releaseReservationInFlight` for failures
between reserve and the doc-row save. **`reprocess()` is a NEW intent = a full fresh
charge**: release the prior reservation (status-guarded no-op if already terminal), then
reserve anew and persist the new `reservation_id`. Window `per_contract`, fail_mode
`closed`, placeholder `default_limit = 5000` (Ops-set per Rule 9 invariant 7). Four
`metering.upload_extraction.*` signals mirror compliance naming. Live-verified 4/4 vs
real Postgres (happy / failure / capacity-no-oversell / applied:false). Suite **511
passed / 20 skipped** at merge. Managing-user path only — preps guest Step 6, does not
complete it.

### 2.4 Consumer 3 — finalize_review, PR #55 (`7ac1a00`, 2026-06-09)

`feat(metering): wire finalize_review as a new meter_key — one charge per finalize-review
burst`. Per Ayman's ruling: **ONE finalizeReview action = ONE reserve = ONE charge
covering the whole 3-agent burst** (risk + obligations + conflict-detection), NOT
per-agent. **The only metering-engine change of the whole consumer phase is the additive
`MeterKey.FINALIZE_REVIEW` enum value** (+ migration `1756000000001` ALTER TYPE on
`meter_key_enum` + seed: finalize / per_contract / closed / 5000 placeholder); resolver,
reserve, commit, release and sweeper treat it generically. **Carrier divergence:** a
finalize writes many per-clause `risk_analyses` rows, so there is no single domain row to
carry `reservation_id` — it is threaded **in-memory** through `pollAndSaveRisks` (commit
on risk completion; release on risk failure, poll timeout, and the synchronous
dispatch-throw). The engine sweeper is the **sole backstop** if the process dies
mid-finalize (see §8). Four `metering.finalize_review.*` signals. Suite **553/553**
in-container at merge.

### 2.5 `risk` meter_key — reserved, unused

`docs/metering-risk-recon.md` (recon at `main @ f4878df`) established there are exactly
two backend risk-dispatch sites, and only one is alive: the on-demand
`POST /ai/risk-analysis` (Site A) is **DEAD** — no UI component calls it and its result is
never persisted — while the live path is the risk dispatch inside `finalizeReview`
(Site B). PR #55 metered the finalize-review *burst* instead of metering `risk`
per-agent; per the #55 merge message, **`risk` stays in the closed enum as
reserved/unused** with no `meter_definitions` row (Rule 9 invariant 7: defined-but-not-
seeded until a consumer wires it). Recon follow-up (open): deprecate/guard the orphaned
`/ai/risk-analysis` endpoint.

---

## 3. Cross-tenant remediation — the core story

### 3a. The sweep — how it started

PR #42 (`54a3959`, 2026-06-02) closed a live cross-tenant `GET /contracts/:id` read —
confirmed in the audit by a user in org B reading a full org-A contract **including the
creator's bcrypt `password_hash`** (HTTP 200, 245 KB body) — plus the app-wide
password_hash leak (22 endpoints, fixed structurally with a global
`ClassSerializerInterceptor` + `@Exclude`). PR #45 (`63a9ed6`, 2026-06-05) closed the
same class on the compliance surface (all seven endpoints under
`contracts/:contractId/compliance-checks` were guarded by `JwtAuthGuard` only) and was
the explicit prerequisite for metering Part 2 ("you cannot meter what you cannot
access-control"; `docs/compliance-access-wall-fix.md`).

The subsequent access-wall sweep (`docs/step3-remaining-audit.md` + the Step-0 exploit
inventory in `docs/tenant-isolation-tier{1,2,3}.md`) catalogued the rest of the unwalled
contract-scoped surface. The Option A triage walled **39 routes across ~10 backend
modules** in Tiers 1–3 (ai, chat, document-processing, contracts, export, risk-analysis,
obligations, claims, notices, subcontracts), plus 4 more wall sites in S0 (3 Class-C
bypass-role routes + the `POST /contracts` project wall) and 13 child-id routes in
S0-part-2. A *separate* count — the Option B audit's "Bucket C floor of **~39 raw
`createQueryBuilder` sites**" on contract-scoped entities
(`docs/option-b-scoped-repository-audit.md:141,149`) — measures data-access sites, not
routes, and is the eventual lint's target. **[unverified]** The planning shorthand
"~40 routes across 9 modules" vs the per-doc "10 modules" is an off-by-one in module
tallying (the route total of 39 is consistent across the tier docs); not reconciled to a
single canonical module count.

### 3b. Option A — interim walls (triage)

All Option A walls share one shape: `ContractAccessService.findInOrg(contractId, orgId)`
keyed on the **caller's JWT org** (never contract-derived), canonical
`contract → project → organization_id` join, **404 not 403**, wall fires before any side
effect. Per Ayman's framing, the walls are intentionally **kept as defense-in-depth even
after Option B lands** (two layers, never a swap).

| PR | SHA | What it walled | Suite at merge |
|---|---|---|---|
| #50 Tier 1 | `f0c56aa` | WRITE + AI-dispatch paths: 6 controller-level wall sites (ai ×5 + chat createSession) + 9 service-level (document-processing uploadAndProcess/reprocess/finalizeReview, contracts clause/version/comment mutations incl. the admin-bypass cross-org delete) | 464 passed / 20 skipped |
| #51 Tier 2 | `6d3c9d6` | READ leaks: export ×3, document-processing ×4 (incl. CHILD-keyed via docId), risk-analysis ×2, obligations getDashboard (conditional), contracts read side-paths ×8 | 498 / 20 sk (+34) |
| #52 Tier 3 | `0b3f554` | claims / notices / subcontracts create + list-by-contract (6 routes; red-before scratch spec proved 3 live cross-tenant exploits) | 510 / 20 sk (+12) |
| #54 S0 | `f4878df` | (1) **Corrected a FALSE security claim** in CLAUDE.md about the Phase 7.15 `ResolveObligationProjectMiddleware` (resolves `project_id` only, swallows errors, never validates org); (2) `POST /contracts` now verifies `dto.project_id` belongs to the caller's org; (3) interim walls on 3 Class-C bypass-role routes | 522 / 20 sk (+11) |
| #57 S0-part-2 | `5a5cd24` | **13 child-id-keyed routes Tier 3 missed** (notices ×4, claims ×5, subcontracts ×4 — several WRITES). Wall resolves via the child's **own** parent contract, never a URL-supplied contractId. Tagged INTERIM — Option B S2e absorbs | **596** in-container (`docs/s0-part2-child-id-walls.md`; cross-checked by #58's "596 + 16") |

### 3c. Option B — the permanent fix (scoped-repository refactor)

**Ratified design calls** (locked in the audit + S1 spec; do not relitigate):

- **Explicit `orgId` param** — same shape as `findInOrg`; NO request-scoped context
  provider, NO interceptor (ambient magic deferred until staging proves the pooler
  interaction).
- **Q1 — canonical-only resolution.** The gate is always the join
  `child → contract → project → organization_id`; denormalized org/project columns are
  **never consulted** as the gate (proven against real Postgres by drifted-column probes
  in S2c-1/S2d/S2e/S2f).
- **Q3 — `scopedFind` (scoped list) on the base; NO QB wrapper.** Raw query-builder sites
  stay raw and become the lint bucket's target — no operator/range/QB-wrapper support.
- **Structural override-safety.** No orgId-override parameter exists; the org filter is
  ALWAYS applied; the `contractIdOverride` pin can only NARROW results to a specific
  parent contract, never widen or change which org gates.
- **Two layers, never a swap.** The Option A `findInOrg` walls stay above (persona-aware
  authorization); the scoped repo gates below (persona-blind tenancy data-integrity).
  Happy-path specs assert BOTH layers.
- **Filter-key allowlist on `scopedFind`** (Ayman ratified, folded into S2c-1): filter
  KEYS are interpolated into SQL (values stay parameterized), so each subclass declares
  an explicit `ReadonlySet` of allowed keys; a non-allowlisted key throws BEFORE
  interpolation. Proven red against both a benign unknown key and an injection-shaped key.
- **`findAcrossAllOrgs`** — the single named tenancy bypass for system-level sweepers —
  is defined in S1 and wired only in the processor bucket (#69).

**All buckets landed:**

| Bucket | PR | SHA | What landed | Suite at merge |
|---|---|---|---|---|
| S1 | #56 | `2daf8cc` | `ScopedContractRepository<T>` abstract base (by-id surface + `findAcrossAllOrgs` unwired) + Contract ROOT subclass; wired into 4 `contracts.service` mutations under the wall | **572** in-container (`docs/option-b-s1-scoped-repo-base.md:218`) |
| S2a | #58 | `92c28f7` | `scopedFind` (scoped list) added to base; clean child reads wired: ContractVersion / ContractorResponse / ContractApprover. ContractComment deferred (raw QB → lint per Q3; by-id loads → S2b) | 612 (596 + 16) |
| S2b | #59 | `39567e8` | ContractComment by-id mutation loads through `scopedFindByIdViaContractOrThrow`; **closed the updateComment tenancy gap** (§4). Order: wall → scoped load → author check → mutate | 637 (612 + 25) |
| S2c-1 | #63 | `2d3988c` | `ObligationScopedRepository` foundation (canonical join, `org_gate_*` aliases) + the ratified allowlist guard on all 6 subclasses + 2 clean read wires | 749 (76→79 suites, 728 + 21) |
| S2c-2 | #64 | `8f42e0e` | Every obligation by-id MUTATION load through the chokepoint (findById + update/complete/delete, controller PATCH/assign/unassign/evidence/reminders, compliance assignUser/unassignUser/updateEvidence — the last two previously mutated with NO obligation load at all); `findByContract` two-step | 778 (79→82 suites, 749 + 29) |
| S2d | #66 | `4afb49c` | `RiskScopedRepository` (canonical `risk→contract→project→org`; allow `{contract_id}`); 4 per-contract risk reads wired (getByContract, getRiskSummary, export generateContractSummary + generateRiskReport). Org-wide aggregation QBs left raw → lint | 800 (781 + 19) |
| S2e | #68 | `67db004` | 3 of the drift-four — Notice / Claim / SubContract scoped subclasses; **absorbs the #57 S0-part-2 walls** (which STAY as defense-in-depth). SubContract allows `{main_contract_id}` only (bare `contract_id` asserted to throw) | 880 (806 + 74) |
| Processor | #69 | `5491dd1` | `ObligationReminderProcessor`'s two org-blind reads (handleCheckReminders, handleWeeklyDigest) routed through `findAcrossAllOrgs` — the INVERSE property (request-UNREACHABILITY, not cross-org blocking); escape-hatch fence spec | 886 (880 + 6) |
| S2f | #70 | `e8cc680` | DocumentUpload (the deferred drift-four entity): wall-then-scope. Phase 1 walls `updateExtractedText` canonically (was denorm-only); Phase 2 adds `DocumentUploadScopedRepository` for the clean reads; dead `getDocumentStatus` removed | 886 → 905 → **904** (see §6) |
| **Lint capstone** | **#71** | **`d7d1c7a`** | **Enforcing `no-bare-contract-repo-access` + CLAUDE.md Rule 11** | **904** (unchanged — comment-only src diff) |

**Interim walls absorbed by Option B** (walls STAY as defense-in-depth underneath):
- S2b absorbed nothing new but **closed** the updateComment gap outright.
- S2c (S2c-1/S2c-2) absorbed the **#60 A–J obligation stop-gap walls** under the scoped layer.
- S2e absorbed the **#57 S0-part-2 child-id walls** (Notice/Claim/SubContract).
- S2f absorbed the DocumentUpload denorm-only gate into the canonical wall + scoped layer.

### 3d. The enforcement capstone — PR #71 (`d7d1c7a`)

`feat(option-b): enforce no-bare-contract-repo-access lint + CLAUDE.md Rule 11`. The
Phase-1 report-only rule (full inventory: `docs/option-b-lint-phase1-inventory.md`,
306 sites) was flipped to **ERROR** and wired into the CI `Backend Tests` job, isolated
(`--no-eslintrc`) from the project's absent/broken general lint (no config + a dangerous
`--fix`; CLAUDE.md Phase 2.4 note).

- Bans bare access (`@InjectRepository(Entity)`, `getRepository(Entity)`, a data method
  on a `Repository<Entity>`, `manager.<m>(Entity, …)`) on **24 contract-scoped entities**
  (the 11 wired + 13 discovered, deliberately over-inclusive) outside the
  scoped-repository chokepoint.
- The **only** suppression path is `// lint-exempt: <reason>` with a non-empty reason; a
  bare `// lint-exempt` does NOT suppress. `noInlineConfig` makes `eslint-disable` of the
  rule inert — every exemption is a reviewable, reasoned comment.
- **306 flagged sites annotated** (comment-only src diff; suite unchanged): 60 aggregation
  QBs, 28 processor/S2f-deferred, 75 two-step-hydration/parked, 143 newly-surfaced
  (system-by-design, wall-protected-pending-migration, deprecating contract-sharing,
  dead-code guard).
- Negative test proven at merge: a real bare access → `✖ 2 problems (2 errors)` exit 1;
  no-reason `// lint-exempt` → still errors; reasoned exemption → exit 0.

The invariant is now **machine-enforced**, not discipline-enforced. CLAUDE.md Rule 11
states it honestly and names every exception class (it does not claim everything is
chokepointed — see §4).

---

## 4. Residual gaps the refactor surfaced

This is the evidence section. Each Option B pass kept finding **live** gaps that the
prior pass missed — the strongest argument for finishing the structural fix rather than
stopping at triage.

| # | Gap | How found | Status |
|---|---|---|---|
| 1 | **The systemic sweep miss** — ~39 unwalled contract-scoped routes existed despite Architecture Rule 3 ("org_id on every query") being on the books since day one | PR #42/#45 established the class; the §C.7 audit + Step-0 exploit inventory swept the rest | **CLOSED** interim by Tiers 1–3 + S0 (Option A); made structural by Option B; now CI-enforced (#71) |
| 2 | **Child-id routes** (Notice/Claim/SubContract `:id`) — 13 routes incl. WRITES; Tier 3 walled only create/list-by-contract. Red evidence: 8 throwaway exploit specs PASSED on then-main (org-A user mutating org-B child rows) | Option B S2 scoping pass (`docs/option-b-s2-child-scoping.md` §2.3) — found while planning, not by incident | **CLOSED** interim by S0-part-2 (#57); permanent absorption = S2e (#68) |
| 3 | **`updateComment` had NEITHER wall nor orgId** — only an author check (an in-org author check is not a tenancy gate) | S2b recon (`docs/option-b-s2b-contract-comment.md`) | **CLOSED** in #59: gains `@OrganizationId()` + wall + scoped load; foreigner 404s BEFORE the author check |
| 4 | **Obligation by-id surface (routes A–J)** — PATCH / assign / unassign / evidence / ical / reminders / upcoming / overdue / listForProject / `GET-PUT-DELETE /obligations/:id`, **including a live cross-tenant DELETE** (route J: foreign row genuinely deleted). upcoming/overdue had no org param (platform-wide) | Pre-S2c recon | **CLOSED** by the #60 (`f097724`) A–J hotfix (red-before/green-after on every route). S2c-2 (#64) then added the scoped layer underneath — proven by a real-Postgres DESTRUCTIVE red (cross-org delete removed the fixture pre-wire; SQL count proved it survives post-wire) |
| 5 | **`getDashboard` contract-less branch** — `GET /obligations/dashboard` with no `contract_id` returned obligation rows **platform-wide to any authenticated user**; an existing spec asserted that as intended | Surfaced during #60; deferred pending a posture ruling | Ayman ruled **bug, not a feature** → **CLOSED** in #62 (`9396845`): canonical org join + no-org guard returning a zeroed dashboard; flipped spec failed RED against the unmodified service |
| 6 | **`ObligationsService.create()` cross-tenant WRITE** — inserted with no contract-in-org validation of `dto.contract_id`: an org-A caller could create an obligation on an org-B contract | Flagged in the #64 PR body; out of S2c-2 scope (a create, not a by-id load) | **CLOSED** by #65 (`9d5764b`): threads `@OrganizationId()` + `findInOrg(dto.contract_id, orgId)` before insert (#60-hotfix primitive; deliberately not routed through the scoped repo — it's an insert, not a by-id load). Suite 778 → 781 |
| 7 | **`updateRiskStatus` cross-tenant WRITE + `getByClause` no-wall READ** — `updateRiskStatus` (by-id write) had no orgId/wall (org-A flips an org-B risk's status); `getByClause` (clause-keyed read) had no orgId/wall (org-A reads org-B clause risks) | S2d's recon (#66) | **CLOSED** by #67 (`9118d0c`), both ruled fix-now: stop-gap walls thread the caller org; updateRiskStatus loads-then-`findInOrg(risk.contract_id, orgId)` before mutation; getByClause gates the whole result set via `findInOrg(rows[0].contract_id, orgId)`, empty short-circuits to `[]`. Suite 800 → 806 |
| 8 | **`obligations.project_id` denorm drift** — the denormalized column can drift to a different org than the canonical chain resolves to; a real-Postgres probe proved the drifted state reachable | S2c-1 foundation test (#63) | **PARTIALLY MITIGATED:** the scoped repos are **immune** (canonical-only, Q1) and the same drift-probe pattern was re-proven in S2d/S2e/S2f. Raw-QB/middleware readers still consuming the denorm (`listForProject`, `ResolveObligationProjectMiddleware`) are **NOT** immune → tracked for the **denorm-read lint** (deferred, §8) |
| 9 | **`DocumentUpload.updateExtractedText` denorm-only gate** — the one request-scoped DocumentUpload mutation whose tenancy authority was the drift column; a doc whose denorm org reads as the caller's while its contract belongs to another org was writable (cross-org write) | S2f recon (`docs/option-b-s2f-document-upload-recon.md`) | **CLOSED** by #70 (`e8cc680`) Phase 1: replaced the denorm gate with the canonical `findInOrg(doc.contract_id, orgId)` wall (red-before/green-after); Phase 2 layered the scoped chokepoint underneath the clean reads |
| 10 | **`getByClause` existence-oracle** — even after the #67 wall, a foreign clause id with risk rows is gated by the contract those rows belong to; a clause with zero risk rows short-circuits to `[]` identically to a foreign one (negligible, no row content leaked) | Noted during #67 | **LOGGED / accepted** — negligible (no data leak; only a `[]`-vs-`[]` non-signal); no further action |
| 11 | **Dead code: `getDocumentStatus` service method** — zero production callers (the route handler calls `pollAndAdvance`, not this method); only its own wall test consumed it | S2f recon (#70) | **REMOVED** in #70 (final sub-commit): method + its wall test deleted; suite 905 → 904 (−1) |
| 12 | **The lint's 143 newly-surfaced bare accesses** — sites no Option B bucket touched, surfaced only when the report-only rule swept the whole codebase | Phase-1 lint inventory (#71 lineage) | **ALLOWLISTED, NOT re-wired** (NARROW scope): ~104 wall-protected-pending-migration (compliance/chat/guest-portal/negotiation/docusign/export/ContractClause), ~29 system/by-design, deprecating contract-sharing (8), dead-code subscription.guard (2). Each carries a reasoned `// lint-exempt:` and is named in CLAUDE.md Rule 11 |
| 13 | **`subscription.guard.ts` org-blind count** — `count({ where: { project_id } })` on a request-supplied `project_id` with no org filter | Lint Phase-1 + a dedicated read-only verification | **DEAD CODE — not a live gap.** The guard is never wired (no `@UseGuards`, metadata never set, not a provider, no `APP_GUARD`). Annotated `// lint-exempt: DEAD CODE — DO NOT wire without an org wall` (org-blind count would be a cross-tenant leak if ever activated) |

**Related doc-integrity gap closed along the way:** the Phase 7.15 middleware was
*documented* as an org-ownership gate but never was one (resolves `project_id` only,
swallows all errors, never throws). S0 (#54) corrected the FALSE claim in CLAUDE.md; the
real protection comes from the route walls + the scoped chokepoint — never rely on that
middleware as a tenancy boundary.

---

## 5. Decision record (all rulings resolved)

| Decision | Ruling | Where recorded |
|---|---|---|
| Option B mechanism (B1 scoped repo, explicit orgId, no ambient context, walls stay as defense-in-depth, `findAcrossAllOrgs` as the single named bypass) | Ratified by Ayman — "locked, do NOT relitigate" | Audit header; `docs/option-b-s1-scoped-repo-base.md` |
| Option A walls' fate after B | **Stay as defense-in-depth** — two layers, never a swap | #50/#51/#52 merge messages; S1/S2/S2e docs |
| `scopedFind` filter-key allowlist guard | **Yes** — folded into S2c-1 rather than deferred | #63 PR body |
| Dashboard contract-less branch | **Bug, not an intended platform view — scope it now** | #62 (`9396845`) |
| `updateComment` parity | Full parity — gains wall + orgId + scoped load | #59 merge message |
| finalize_review charging unit | **One charge per finalize burst** (3 agents ride one reserve), not per-agent; `risk` stays reserved-unused | #55 merge message |
| Q1 denorm columns | Canonical-only resolution; denorm never the gate | #62/#63; S2 doc §2.1; re-proven S2d/S2e/S2f |
| Q3 list/QB surface | `scopedFind` with allowlist; raw QBs stay raw → lint bucket | #58/#63 |
| `ObligationsService.create()` cross-tenant write | **Fix now** — standalone `findInOrg` wall (not a scoped-repo conversion; it's a create, not a by-id load) | #65 (`9d5764b`) |
| S2d scope (RiskAnalysis) | Per-contract risk **reads** → scoped chokepoint; org-wide analytics aggregation QBs → left raw for the lint + review | #66 (`4afb49c`) |
| `updateRiskStatus` + `getByClause` | **Fix now** (stop-gap walls); `getExplanation`/`applyOverride` centralization stays **parked** (inline-join-scoped, already tenancy-safe) | #67 (`9118d0c`) |
| DocumentUpload (drift-four 4 of 4) | Deferred from S2e, then **done** as its own bucket: wall-then-scope; `pollAndAdvance`/`reprocess` scoping deferred (metering-entangled) | #70 (`e8cc680`) |
| Lint scope + entity set | **NARROW** (allowlist F2 wall-protected, migrate later) + **over-inclusive** 24-entity set (over-detection beats missing surface) — defaults **pending Ayman confirm**, reversible | #71; CLAUDE.md Rule 11 |

---

## 6. Suite lineage (637 → 904)

Test-count progression at each merge, as stated in merge commit messages / per-bucket
docs — the red-before/green-after discipline made the suite count itself the evidence
trail. Two run modes appear: **CI-mode** (no `DATABASE_URL` → real-Postgres specs skip
LOUD, "N passed / 20 skipped") and **in-container** (real Postgres, everything runs; the
documented `--runInBand` norm).

| Merge | PR | Suite (as stated) | Notes |
|---|---|---|---|
| `63a9ed6` | #45 compliance wall | 426/426 | +16 access-wall specs |
| `9200f38` | #46 engine | 430/430 | +20 real-PG metering specs (skip without DB) |
| `49f785f` | #49 compliance consumer | 446/446 | spans interleaved non-7.18 PRs #47/#48 (contract-sharing; counts not in their merge messages) |
| `f0c56aa` | #50 Tier 1 | 464 / 20 sk | +38 |
| `6d3c9d6` | #51 Tier 2 | 498 / 20 sk | +34 |
| `0b3f554` | #52 Tier 3 | 510 / 20 sk | +12 |
| `9bd4d55` | #53 upload_extraction | 511 / 20 sk | +1 |
| `f4878df` | #54 S0 | 522 / 20 sk | +11 |
| `7ac1a00` | #55 finalize_review | 553/553 in-container | real-PG now running |
| `2daf8cc` | #56 S1 | **572** in-container | `docs/option-b-s1-scoped-repo-base.md:218` (merge body empty) |
| `5a5cd24` | #57 S0-part-2 | **596** in-container | `docs/s0-part2-child-id-walls.md`; cross-checked by #58 subject "596 + 16" (merge body empty) |
| `92c28f7` | #58 S2a | 612 | "612 tests (596 + 16)" ✓ |
| `39567e8` | #59 S2b | **637** | "637 tests (612 + 25)" ✓ — pre-#61 baseline |
| `ac858f7` | #61 legal corpus (NOT 7.18) | **687 [derived]** | not stated in merge message; derived two ways: 727 − 40 (#60 delta) and 637 + 50 (#61 additions) |
| `f097724` | #60 obligation A–J hotfix | **727** | #60 says "637 → 677 (+40)" branch-local (cut pre-#61); after rebase onto #61's 687 = 727, confirmed by #62 baseline ✓ |
| `9396845` | #62 dashboard fix | 728 | "727 → 728" ✓ |
| `2d3988c` | #63 S2c-1 | 749 | "76 suites/728 → 79/749 (+21)" ✓ |
| `8f42e0e` | #64 S2c-2 | 778 | "79/749 → 82/778 (+29)" ✓ |
| `9d5764b` | #65 create wall | 781 | "778 → 781" ✓ |
| `4afb49c` | #66 S2d | 800 | "781 → 800" ✓ |
| `9118d0c` | #67 risk wall | 806 | "800 → 806 (+6 / +1 suite)" ✓ |
| `67db004` | #68 S2e | 880 | "806 → 880 (+74)" ✓ |
| `5491dd1` | #69 processor | 886 | "880 → 886" ✓ |
| `e8cc680` | #70 S2f | **886 → 905 → 904** | within ONE PR: Phase 1+2 add 19 (886 → 905, +3 suites); the final sub-commit removes the dead `getDocumentStatus` wall test (905 → 904, −1). **NOT a discrepancy** |
| `d7d1c7a` | #71 lint capstone | **904** | unchanged — comment-only src diff. Measured in-container at merge: 904 passed / 904 total (real-PG specs ran; 0 skipped in-container) |

**Final state: 904** on `main @ d7d1c7a`, verified in-container `--runInBand` during the
merge gate (904 passed / 100 suites; locally the 154 real-PG specs skip but ran
in-container). tsc clean; `npm run lint:contract-repo` exit 0.

**Infra note — the `--runInBand` norm.** A default parallel jest run OOM-kills worker
processes in-container (SIGKILL — "failed to run", not assertion failures). First
documented in `docs/s0-part2-child-id-walls.md`; the standard mode from #63 onward is
in-container `--runInBand` against real Postgres. Parked as a Phase 9 infra item (§8).

---

## 7. Signature changes (caller awareness)

Breaking-shape changes shipped during remediation. All verified single-caller at change
time — listed so nothing keys on old shapes silently.

- **`ExportService.generateContractSummary(contractId, orgId, format?)`** — gained
  `orgId` **mid-list** (before the defaulted `format`), S2c-1 (#63).
- **`ExportService.generateRiskReport(…, orgId)`** — gained the `orgId` the controller
  already held; bare `RiskAnalysis` repo removed, S2d (#66).
- **`ObligationsService.complete(id, userId, orgId, evidenceUrl?)`** — gained `orgId`
  mid-list (before optional `evidenceUrl`), #60/S2c-2.
- **`ObligationsService.create(dto, orgId)`** — gained `orgId`, #65.
- **`ComplianceObligationService.assignUser(obligationId, userId, assignedBy, orgId)` /
  `unassignUser(obligationId, userId, orgId)` / `updateEvidence(obligationId, evidenceUrl,
  orgId)`** — gained trailing `orgId`; assign/unassign previously mutated with **no
  obligation load at all** (#64).
- **`RiskAnalysisService.updateRiskStatus(…, orgId)` and `getByClause(…, orgId)`** —
  gained `orgId` threaded from the controller (`@CurrentUser`), #67.
- **PATCH on a nonexistent obligation now returns 404 (was 500).** No test asserted the
  old 500; flagged for the frontend in the #60 PR body.
- *(Same class, earlier: S0-part-2 (#57) threaded `orgId` into the notices / claims /
  subcontracts `:id`-route service methods — `findById`, `acknowledge`, `respond`,
  `updateStatus`, `update`, `share`, `uploadDocument`. "No service has any external
  caller (verified)" per `docs/s0-part2-child-id-walls.md`.)*

---

## 8. Deferred / future work (what 7.18 deliberately did NOT do)

Per the locked posture (CLAUDE.md: "staging gate is a Phase 9 **release-gate**, NOT a
merge-gate"), these are deferred and must block the Phase 9 production cut, not any merge.

1. **Chokepoint migration for the ~104 wall-protected sites** (compliance/*, chat,
   guest-portal, negotiation, docusign, export, ContractClause reads) — allowlisted as
   wall-protected today (tenancy-safe via `findInOrg`), NOT yet on the chokepoint. A
   **scheduled future phase** migrates them; named explicitly in CLAUDE.md Rule 11 and in
   each `// lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled`.
2. **DocumentUpload `pollAndAdvance` / `reprocess` scoping** — deferred in S2f because
   these paths are metering-entangled (changing the constructor/loaders would break the
   byte-identical metering specs). Already walled; scoping is the open item
   (`docs/option-b-s2f-document-upload-recon.md`).
3. **The denorm-read lint** — forbid *reading* the denormalized org/contract columns
   (`obligations.project_id`, etc.) as a tenancy signal. The current lint bans bare repo
   *access*; the denorm-read drift hazard (§4.8) needs its own rule. Deferred.
4. **`getExplanation` / `applyOverride` centralization** — parked (#67). Both are already
   tenancy-safe via inline `r→c→p.organization_id` joins; consolidating them onto the
   scoped chokepoint is cleanup, not a gap.
5. **`ComplianceReportProcessor` + `learned-baseline.processor`** — background loaders
   not yet routed through `findAcrossAllOrgs` (only `ObligationReminderProcessor` was, in
   #69). Own future buckets; allowlisted as system/no-orgId today.
6. **`subscription.guard.ts`** — DEAD CODE: wire-with-an-org-wall or delete. Annotated
   `// lint-exempt: DEAD CODE — DO NOT wire without an org wall`.
7. **Metering staging gate G.1–G.7** (`docs/metering-part2-staging-gate.md`):
   pooled-connection READ COMMITTED probe, p99 reserve→commit vs `RESERVATION_TTL_SECONDS`,
   the scheduled sweeper releasing an expired reserve for real, capacity gate under
   concurrent volume, migration-in-deploy pipeline, metering specs vs real Postgres on
   staging, frontend double-submit guard. Each consumer extends this list, never replaces
   it.
8. **finalize_review TTL-vs-p99** — the consumer with **no carrier row**: `reservation_id`
   lives only in the detached `pollAndSaveRisks` promise, so if the process dies
   mid-finalize the engine sweeper is the sole recovery (fail-safe toward over-denial).
   The p99 of a real finalize burst vs the 1 h TTL is exactly the number Phase 9 staging
   must produce before a lesson is written (same discipline as engine lessons #148–#150 —
   earned by evidence, not authored ahead of it).
9. **jest OOM under parallelism** — in-container parallel runs SIGKILL workers;
   `--runInBand` is the documented norm. Revisit worker memory / sharding at Phase 9.
10. **Idempotency v1 limitation (locked)** — metering consumers are non-idempotent across
    distinct user clicks (fresh `randomUUID()` per reserve); the frontend owns the
    double-submit guard until a client `Idempotency-Key` header convention lands.
11. **Lint defaults pending Ayman confirm** — the over-inclusive 24-entity set and the
    NARROW scope (allowlist F2, migrate later) are reversible defaults set by the
    implementer, not yet ratified.
12. **Hygiene lesson carried out of the phase** — lesson #168 (`eddeec1`): migration
    timestamp collisions don't make TypeORM skip (it keys class name + timestamp) but
    leave ordering between same-timestamp migrations undefined. Always pick a timestamp
    strictly greater than the current max.

---

*Final report assembled 2026-06-15 against `main @ d7d1c7a`, read-only. This is the last
artifact of Phase 7.18; the Option B contract-repo chokepoint is now CI-enforced
(`no-bare-contract-repo-access` + CLAUDE.md Rule 11).*
