# Metering — `upload_extraction` consumer wiring (managing-user upload path)

**Phase:** 7.18 Part 3 (second metered consumer, after compliance Part 2).
**Base branch:** local working tree on `main` @ `0b3f554` (Tier 3 merged).
**Engine:** UNTOUCHED. `MeteringService.reserve` / `commit` / `release` is
called only — same call surface compliance Part 2 uses (PR #49, squash
`49f785f`).

## Framing — preps guest Step 6, doesn't complete it

The original `depends:metering` seam at
`guest-invitation.service.ts:445–451` is a captured-intent TODO stub for
the still-unbuilt guest upload bucket (`TODO(upload-bucket)`). Recon
(prior turn, STEP 0) confirmed there is **no guest upload controller, no
upload service method, no route handler at `/contracts/:id/upload`** for
guests today.

So this PR wires `upload_extraction` against the **managing-user** upload
path — `POST /contracts/:contractId/documents` →
`DocumentProcessingService.uploadAndProcess` — which IS fully implemented
and Tier-1-walled (`document-processing.service.ts:85`,
`contractAccess.findInOrg(contractId, orgId)`). The engine's resolver
already handles managing, guest, and viewer callers uniformly via
`contract → project → organization_id` — when the guest upload bucket
eventually lands, the same `reserve()` call shape works for it with no
additional engine or resolver change.

This consumer is **mirror-of-mirror**:
- Engine pattern (Phase 7.18 Part 1, PR #46).
- First consumer pattern (compliance Part 2, PR #49). Documented in
  CLAUDE.md "Phase 7.18 Part 2 — Compliance metering consumer".
- This consumer follows the Part 2 pattern verbatim; no new pattern
  introduced.

## Scope (locked)

- One new consumer: `DocumentProcessingService` (`uploadAndProcess` +
  `reprocess`) + the two sync-dispatch failure paths
  (`startTextExtraction`, `startClauseExtraction`) + the lazy poll-driven
  terminal reconcile in `pollAndAdvance`.
- One additive seed migration: `1755000000001` —
  `meter_definitions(upload_extraction, …)`. Compliance's row UNTOUCHED.
- One additive schema migration: `1755000000002` — adds nullable
  `reservation_id UUID` + partial index on `document_uploads`. Mirrors
  the compliance `reservation_id` column shape exactly.
- Engine code: **untouched.** Resolver code: **untouched.** Sweeper /
  scheduler / processor: **untouched** — sweeper backstop is reused.
- Guest portal code: **untouched** (still a stub; that's a separate
  Step 6 work item).

## Window / fail-mode decision

| Field | Value | Reason |
|---|---|---|
| `meter_key` | `upload_extraction` | Already in the closed `meter_key_enum` PG enum (PR #46). |
| `unit` | `extraction` | One charge per upload-and-dispatch (one user click = one charge, mirrors compliance `run`). |
| `window_type` | `per_contract` | Uniform with compliance; resolver already supports this — no engine change. |
| `fail_mode` | `closed` | Anthropic token cost + Celery worker time is real money; closed-fail on resolver / store error is the safe default per Rule 9 invariant 7. |
| `default_limit` | `5000` | **PLACEHOLDER.** Ops sets real per-plan caps via `plan_allowances` and per-org overrides via `subject_allowances`. NEVER treat this number as authoritative (Rule 9 invariant 7). Chosen generous so dev / staging do not hit it accidentally before real numbers land. |

## Wiring shape (mirror of compliance Part 2)

```
HTTP POST /contracts/:contractId/documents
  ↓ JwtAuthGuard + RolesGuard
DocumentProcessingService.uploadAndProcess(contractId, file, userId, orgId, opts)
  ↓
  1. contractAccess.findInOrg(contractId, orgId)            ← Tier 1 access wall
  ↓
  2. metering.reserve({                                     ← Phase 7.18 Part 3 GATE
       caller: { user_id, jwt_organization_id, account_type: 'MANAGING' },
       meterKey: MeterKey.UPLOAD_EXTRACTION,
       amount: 1,
       idempotencyKey: randomUUID(),                        ← fresh per click
       contractId,
       actorRef: userId,
       metadata: { route: 'POST /contracts/:contractId/documents' },
     })
     │  on MeterLimitExceededError → 403 METER_LIMIT_UPLOAD_EXTRACTION (no doc row, no dispatch)
     │  on meter SYSTEM error      → 5xx, fail closed (no doc row, no dispatch)
  ↓
  try {
  3.   storageService.uploadFile(...)
  4.   documentUploadRepository.save({ ..., reservation_id })   ← persist linkage
  } catch (err) {
       releaseReservationInFlight(reservation_id, err)         ← refund + signal
       throw err
  }
  ↓
  5. startTextExtraction(saved)
       │  Celery dispatch → returns job_id
       │  catch: set FAILED + releaseReservationOnFailure(doc)  ← SYNC-FAIL 1
  ↓ (eventually, via lazy polling)
DocumentProcessingService.pollAndAdvance(docId, orgId)
  ↓ contractAccess.findInOrg(doc.contract_id, orgId)            ← Tier 2 access wall
  ↓ getJobStatus → if 'failed' → set FAILED + releaseReservationOnFailure(doc)  ← ASYNC-FAIL
  ↓ if 'completed' + EXTRACTING_TEXT branch:
  │     if qualityFlags > 0 → set HUMAN_REVIEW_RECOMMENDED + releaseReservationOnFailure(doc)
  │                                                          ← PARKED-TERMINAL (no clauses)
  │     else → startClauseExtraction(doc)
  │            │  Celery dispatch → returns job_id
  │            │  catch: set FAILED + releaseReservationOnFailure(doc)  ← SYNC-FAIL 2
  ↓ if 'completed' + EXTRACTING_CLAUSES branch:
        createClausesFromExtraction(...)
        set CLAUSES_EXTRACTED
        commitReservationOnSuccess(doc)                       ← TERMINAL SUCCESS
```

`reprocess()` follows the same shape — a NEW intent (user click) takes a
FRESH reservation. ORDER inside reprocess:

1. **release the PRIOR `doc.reservation_id`** via `releaseReservationOnFailure(doc)`
   — defense-in-depth, fires BEFORE the new reserve. Idempotent: on the
   frontend-gated happy path (FAILED / HUMAN_REVIEW_RECOMMENDED /
   CLAUSES_EXTRACTED → terminal prior) the engine returns
   `{applied:false, status:<terminal>}` and the call is a no-op. On the
   bypassed-frontend / racing-double-click / in-progress reprocess (prior
   still `reserved`), this refunds the prior so the per_contract window
   doesn't temporally double-count until the sweeper backstop fires at
   TTL.
2. `metering.reserve(...)` — takes the NEW reservation.
3. `doc.reservation_id = reservation.reservation_id;` — overwrites with
   the new id.

NOT a double-charge — the new intent IS a distinct user click; the prior
reservation is correctly released (or already was) before the new one
takes capacity. The sweeper remains the backstop for truly orphaned
reservations (e.g. a process crash between steps 1 and 3 that leaves a
reservation with no carrier and no terminal handler).

## `reservation_id` linkage

- New nullable column `document_uploads.reservation_id UUID NULL`.
- Partial index `idx_document_uploads_reservation_id` covering
  non-NULL rows only.
- **No FK to `metering_ledger`** — attribution, not ownership. Mirrors
  the engine's own choice not to FK `ledger.actor_ref` / `contract_ref`,
  and mirrors `compliance_checks.reservation_id` (PR #49).
- NULLABLE because pre-existing rows pre-date metering, AND sync
  failures BEFORE the doc row is saved never carry one (the local
  `reservation` handle is the carrier; release fires in-request from
  local state).

## Observable signals (mirror of compliance's four)

Ops search by `metering.upload_extraction.*` surfaces every applied:false
or error occurrence across the lifecycle. Signal-name parity with
compliance is deliberate so the same Ops dashboard works across both
meters.

| Signal | Site | Means |
|---|---|---|
| `metering.upload_extraction.committed_after_release` | `commitReservationOnSuccess` warn path | Upload succeeded (clauses extracted) but reservation was already released (sweeper / peer). Upload was NOT charged. |
| `metering.upload_extraction.released_after_terminal` | `releaseReservationOnFailure` warn path + `releaseReservationInFlight` warn path | Failure release found a peer won the race. Idempotent; refund already applied. |
| `metering.upload_extraction.commit_error` | `commitReservationOnSuccess` catch | Engine `commit()` threw. Vanishingly rare; loud if it fires. |
| `metering.upload_extraction.release_error` | `releaseReservationOnFailure` catch + `releaseReservationInFlight` catch | Engine `release()` threw. The original failure error still rules; metering is best-effort here. |

## Locked design choices

1. **Intent-level.** One upload click = one reserve. The clause
   extractor's internal **4× Anthropic API retries** (`max_attempts=4`,
   exponential backoff 30 / 60 / 120s in
   `ai-backend/app/agents/clause_extractor.py:558–605`) live INSIDE the
   unit and never re-reserve.
2. **Reserve AFTER the Tier 1 wall.** The access wall authorizes the
   contract_id BEFORE the engine sees it. The engine's defense-in-depth
   JWT cross-check (MANAGING shape only) is belt-and-suspenders.
3. **Idempotency key = `randomUUID()` per intent.** Managing-user
   uploads are intentionally non-idempotent across distinct user clicks
   — the key only dedupes an in-flight retry of the SAME reserve. A
   client-supplied `Idempotency-Key` header convention is the deferred
   audit §9.2 future item (same posture as compliance).
4. **`HUMAN_REVIEW_RECOMMENDED` = release.** Phase 7.25 parked-
   terminal state — no clauses extracted from this upload, so the metered
   unit ("extraction") did not produce its deliverable. Refund. If the
   user clicks "Continue anyway" / "Reprocess", that's a NEW reserve.
5. **`reprocess()` = new reserve.** Each user-initiated reprocess is a
   distinct user click that triggers fresh Celery dispatch + Anthropic
   token cost. Mirrors compliance's re-run-as-new-reserve treatment.
6. **No engine touch.** Engine is sealed. This consumer adds NOTHING to
   `backend/src/modules/metering/`. The seed row is the only engine-
   adjacent change.

## Test evidence (live real-Postgres, run inside `sign-backend`)

Hand-run scratch spec `_step2_upload_extraction_live.spec.ts` (deleted
before commit; evidence below verbatim) exercised the four wired
scenarios against the running Postgres (`sign-postgres`, fresh
migrations applied). All four PASS.

```
PASS src/_step2_upload_extraction_live.spec.ts (7.574 s)
  upload_extraction live verification (real Postgres)
    ✓ (1) HAPPY: reserve increments consumed; commit flips ledger; consumed unchanged (97 ms)
    ✓ (2) FAILURE: release flips ledger; consumed refunded to 0 (39 ms)
    ✓ (3) CAPACITY: N=20 concurrent reserves with limit M=5 — exactly 5 succeed, 15 throw METER_LIMIT (274 ms)
    ✓ (4) APPLIED_FALSE: commit after release returns {applied:false, status:released} (29 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total

[STEP2.1 after-reserve] reservation=768dca8c-af5a-47bc-ac23-b7eb73aee4b9 status=reserved amount=1 consumed=1
[STEP2.1 after-commit] applied=true status=committed consumed=1
[STEP2.2] pre=1 applied=true status=released post=0
[STEP2.3] N=20 M=5 ok=5 limit=15 other=0 consumed=5
[STEP2.4] commit-after-release applied=false status=released
```

What each line proves:
- **STEP2.1** — Happy path: `reserve` produces ledger row `status=reserved
  amount=1`, balance bumps to `consumed=1`. `commit` flips ledger to
  `committed` (real `committed_at` timestamp) and `consumed` STAYS at 1
  (capacity was taken at reserve, not at commit). Engine
  `TransitionResult.applied=true`.
- **STEP2.2** — Failure path: post-reserve balance is 1; `release` flips
  ledger to `released` (real `released_at` timestamp) AND refunds balance
  back to 0. `TransitionResult.applied=true`.
- **STEP2.3** — Capacity gate: `subject_allowance` override sets per-org
  limit to M=5. 20 concurrent reserves on the same window
  (`subject=orgId, meter_key=upload_extraction, window_key=contractId`).
  **Exactly 5 succeed, 15 throw `MeterLimitExceededError`, 0 other
  errors. Final consumed = 5 — no oversell.** This is the gate that
  proves the atomic-conditional-UPDATE invariant holds for this consumer.
- **STEP2.4** — `applied:false` swept-then-uncharged hazard: reserve →
  release (simulating sweeper) → commit returns
  `{applied:false, status:released}`. This is the observable signal that
  `commitReservationOnSuccess` logs as
  `metering.upload_extraction.committed_after_release`. Balance stays
  at 0 because the peer release already refunded.

### Cross-tenant probe (no live re-run needed)

The existing Tier 1 access-wall spec
(`document-processing.service.access-wall.spec.ts`,
`uploadAndProcess > cross-tenant`) asserts that on a cross-tenant
`findInOrg` rejection, `storageService.uploadFile` and
`documentUploadRepository.save` are NEVER called. By construction
`metering.reserve` sits BETWEEN the wall and `storageService.uploadFile`
— if storage is never called, reserve is never called either. Full
backend suite remains green:

```
Test Suites: 2 skipped, 52 passed, 52 of 54 total
Tests:       20 skipped, 510 passed, 530 total
```

No regression. The two skipped suites are the pre-existing real-Postgres
metering specs (CI-skip per the metering PR #46), not related to this
PR.

## Staging-deferred items → `docs/metering-part2-staging-gate.md` (Phase 9)

These need representative load — not provable on the dev DB:

1. **Pooled-connection READ COMMITTED probe under PgBouncer / similar.**
   The engine's `MeteringService.onModuleInit` checks the connection IT
   happens to take at boot. Per CLAUDE.md "Phase 7.18 Part 2" open
   caveat, a per-connection or per-transaction probe under representative
   load is required before the invariant can be considered closed at
   scale. Applies UNIFORMLY to compliance and `upload_extraction` (both
   consumers ride the same engine).
2. **p99 reserve→commit vs `RESERVATION_TTL_SECONDS=3600`.** Upload +
   text-extraction + clause-extraction with Anthropic 4× retries can take
   non-trivial wall-clock on Arabic contracts. If p99 end-to-end exceeds
   the TTL, the sweeper will release in-flight reservations and the
   eventual commits will land as
   `metering.upload_extraction.committed_after_release` no-ops (work
   succeeded but un-charged). Same TTL-sizing requirement compliance
   carries. Document the observed p99 in staging.
3. **MeteringCleanupProcessor actually firing on its BullMQ cadence
   for an `upload_extraction` reservation.** Verified hand-equivalent
   (STEP2.4 fires `release` directly); the scheduled-sweeper path
   inherits the same engine behaviour as compliance but should be
   observed end-to-end on staging.
4. **Capacity gate under realistic concurrent volume.** STEP2.3 ran 20
   concurrent reserves under a 10-connection default pool. Real-load
   capacity-gate observation should include orgs with active plan
   allowances + subject overrides under representative concurrency.

## Git scope (this turn — locked)

Files modified or added:
- `backend/src/database/migrations/1755000000001-SeedUploadExtractionMeterDefinition.ts` (new — seed)
- `backend/src/database/migrations/1755000000002-AddReservationIdToDocumentUploads.ts` (new — column + partial index)
- `backend/src/database/entities/document-upload.entity.ts` (added `reservation_id` column)
- `backend/src/modules/document-processing/document-processing.module.ts` (added `MeteringModule` import)
- `backend/src/modules/document-processing/document-processing.service.ts` (reserve + commit/release at all 4 terminal points + 3 helpers + `account_type` thread on `uploadAndProcess` / `reprocess`)
- `backend/src/modules/document-processing/tests/document-processing.service.access-wall.spec.ts` (constructor positional patch — MeteringService no-op stub)
- `backend/src/modules/document-processing/tests/document-processing.service.reads-access-wall.spec.ts` (constructor positional patch — MeteringService no-op stub)
- `backend/src/modules/risk-analysis/services/tests/ai-risk-writer-integration.spec.ts` (DI provider patch — MeteringService no-op provider)
- `docs/metering-upload-extraction.md` (this file — scratch doc note)

Explicitly NOT touched:
- `backend/src/modules/metering/**` (engine — sealed)
- `backend/src/modules/guest-portal/**` (guest path — still a stub; separate Step 6)
- `backend/src/modules/compliance/**` (first consumer — unchanged)
- `CLAUDE.md`, `lessons.md` (no doc-deltas in this turn)
