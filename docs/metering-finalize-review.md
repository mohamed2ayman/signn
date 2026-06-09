# Metering — `finalize_review` consumer (Phase 7.18)

**Branch:** `feat/metering-finalize-review-consumer` (from `main` @ `f4878df`)
**Scratch doc** — NOT CLAUDE.md / lessons.md. Records the model, the one engine line, the
carrier divergence, test evidence, and staging-deferred items.

Third metered consumer, after compliance (PR #49) and upload_extraction (PR #53). Mirrors the
proven pattern: reserve in-request BEHIND the access wall, commit/release at the terminal
handler + sync fail paths, intent-level (one user action = one reserve), inspect
`TransitionResult`, sweeper backstop.

---

## The model — one finalize click = ONE charge (Ayman's decision)

`finalizeReview` dispatches a **3-agent burst** — risk + obligations + conflict-detection
(`document-processing.service.ts` ~`:923/:940/:955`). Per Ayman: this is metered as **ONE
charge** covering the whole burst under a new `finalize_review` meter_key — **NOT** a per-agent
charge. The risk / obligations / conflict agents are **not** metered separately.

- ONE `reserve()` wraps the whole burst (`meterKey: finalize_review`, `amount: 1`).
- The dead `risk` route (`POST /ai/risk-analysis`) is **not** metered — recon
  (`docs/metering-risk-recon.md`) confirmed it is UI-dead + result-orphaned. `risk` stays in
  the `MeterKey` enum as a **RESERVED, unused** value — do NOT remove it.
- No backend cap on re-finalize beyond the `per_contract` window (a second finalize on the
  same contract draws from the same window). Frontend owns the double-submit guard.

Why one charge, not per-agent: the three agents are one logical user action ("finalize this
contract's review"). Billing the action once matches how the user experiences it and avoids
charging 3× for one click. If obligations/conflict ever need independent metering, they get
their own meter_key later — this consumer does not pre-empt that.

---

## The one engine line — minimal, additive

The metering engine is **fully generic over `meterKey`**. Confirmed before touching anything
(STEP 0):

- `resolveMeteringSubject` — no branch on meterKey (walks contract→project→org).
- `resolveLimit` — branches on **row presence** only (subject_allowance → plan_allowance →
  meter_definition.default_limit), keyed by the meterKey value; no per-key logic.
- `computeWindowKey` — branches on `def.window_type` (`per_contract` supported at
  `metering-resolver.service.ts:222-229`), never on the key.
- `reserve` reads `fail_mode` from the def row generically; `commit` / `release` /
  `releaseByLedgerId` key on `reservation_id` / `ledger_id` with **zero** meterKey branch.
- The sweeper reaps `status='reserved' AND expires_at < NOW()` — meter-key-agnostic.

So a new `per_contract` / `closed` meter rides every path with **no engine logic change** —
exactly like compliance + upload_extraction.

**The ONLY engine change** is the additive enum value:

```
// backend/src/modules/metering/enums/meter-key.enum.ts
export enum MeterKey {
  COMPLIANCE = 'compliance',
  RISK = 'risk',                       // RESERVED, now has NO consumer (route dead)
  AI_ASSISTANT_MESSAGE = 'ai_assistant_message',
  UPLOAD_EXTRACTION = 'upload_extraction',
  FINALIZE_REVIEW = 'finalize_review', // ← the one added line (+ doc comment)
}
```

`git diff --stat` over `backend/src/modules/metering/` = **1 file changed** (`meter-key.enum.ts`,
+14 incl. comment). The engine services / processors / schedulers / entities are **untouched**.

The matching PG `meter_key_enum` value is added by migration `1756000000001` via
`ALTER TYPE meter_key_enum ADD VALUE IF NOT EXISTS 'finalize_review'` (`transaction = false` —
ADD VALUE can't run in a tx block, and the seed INSERT must see it committed; same pattern as
Phase 7.25 / 7.3).

---

## meter_definition (window / fail_mode)

Seeded by `1756000000001`, mirroring the two existing AI-token-cost meters:

| meter_key | unit | window_type | fail_mode | default_limit |
|---|---|---|---|---|
| compliance | run | per_contract | closed | 1000 |
| upload_extraction | extraction | per_contract | closed | 5000 |
| **finalize_review** | **finalize** | **per_contract** | **closed** | **5000 (placeholder)** |

- **per_contract** — window_key = contractId. One window per contract for finalize runs.
- **closed** — the burst runs three Anthropic agents (real token cost); fail-closed on a
  meter SYSTEM error is the safe default (Rule 9 invariant 7).
- **default_limit = 5000** — a generous **PLACEHOLDER** so dev/staging don't trip it. Ops sets
  real caps via `plan_allowances` / `subject_allowances`. NEVER treat this number as
  authoritative.

Verified live on the dev DB after `migration:run`:

```
     meter_key     |    unit    | window_type  | fail_mode | default_limit
-------------------+------------+--------------+-----------+---------------
 compliance        | run        | per_contract | closed    |          1000
 upload_extraction | extraction | per_contract | closed    |          5000
 finalize_review   | finalize   | per_contract | closed    |          5000
```
`meter_key_enum` now: `compliance, risk, ai_assistant_message, upload_extraction, finalize_review`.

---

## Wiring (mirror of upload_extraction)

`finalizeReview(contractId, orgId, { user_id, account_type? })`:

1. **Wall** — `contractAccess.findInOrg(contractId, orgId)` (unchanged, `:900`). Throws 404 on
   cross-tenant probe BEFORE reserve.
2. **Reserve** — `meterKey: FINALIZE_REVIEW, amount: 1, contractId, idempotencyKey: randomUUID(),
   caller: { user_id, jwt_organization_id: orgId, account_type: MANAGING }, actorRef: user_id`.
   Sits DOWNSTREAM of the wall, BEFORE any AI dispatch. Capacity exhaustion →
   `MeterLimitExceededError` → 403 `METER_LIMIT_FINALIZE_REVIEW` (dispatches nothing). Meter
   SYSTEM error → fail closed.
3. **Sync-fail in-flight release** — clause-load + risk dispatch are wrapped in a try/catch; a
   throw BEFORE the poller is launched calls `releaseFinalizeReservationInFlight(reservation_id)`
   then re-throws (no charge for a finalize that never dispatched).
4. **Poller owns the terminal** — `pollAndSaveRisks(contractId, jobId, orgId, reservation_id)`:
   - risk job **completed** → `commitFinalizeReservationOnSuccess` (the ONE charge; obligations
     + conflict ride inside it).
   - risk job **failed** → `releaseFinalizeReservationOnFailure`.
   - poll **timeout** (60×3s) → `releaseFinalizeReservationOnFailure`.
5. Obligations + conflict dispatch run alongside; if one throws after the poller launched, the
   poller (already owns the reservation) still reconciles via the risk outcome.

Controller threads `@CurrentUser()` into the finalize endpoint so `actor_ref` (NOT NULL UUID)
and the engine's MANAGING JWT cross-check have the user id.

Observable signals on `{applied:false}` (mirror compliance/upload naming), so one Ops search
finds every applied:false occurrence:
- `metering.finalize_review.committed_after_release`
- `metering.finalize_review.released_after_terminal`
- `metering.finalize_review.commit_error`
- `metering.finalize_review.release_error`

### Carrier divergence — `reservation_id` as a poller param (NOT a DB column)

compliance carries `reservation_id` on `compliance_checks`; upload_extraction carries it on
`document_uploads`. **finalize_review has NO natural carrier row** — a finalize run writes MANY
per-clause `risk_analyses` rows, none of which is a single per-run row. So `reservation_id` is
threaded **IN-MEMORY** into `pollAndSaveRisks` (the risk poller is the sole terminal owner).

- **No migration for a carrier column.** Lighter than the prior two consumers.
- **Consequence:** if the Node process dies mid-finalize, there is no DB carrier to drive a
  reconcile-on-next-poll. The **engine sweeper is the SOLE backstop** — it releases the
  dangling reserve at `RESERVATION_TTL_SECONDS` (1h). Fail-safe toward over-denial (capacity is
  refunded; the finalize is recorded as released/uncharged), matching the documented v1 posture.

### Intent-level

One finalize = one reserve. The 60×3s poll loop is *polling*, not re-dispatch — it never
re-reserves. Any in-agent Anthropic retries happen inside the single Celery job, inside the one
reserve unit.

---

## Test evidence (real Postgres + consumer wiring)

Run in-container (`DATABASE_URL` set, so the real-PG specs RUN, not skip):

**`metering/tests/metering-finalize-review.spec.ts` (real Postgres — 4 tests):**
- ✓ HAPPY: reserve consumes 1, commit flips reserved→committed and leaves consumed at 1
- ✓ FAILURE: reserve consumes 1, release flips reserved→released and refunds consumed to 0
- ✓ CAPACITY: subject_allowance=3, N=25 concurrent reserves → exactly 3 succeed, no oversell
  (every rejection is `METER_LIMIT_FINALIZE_REVIEW`, limit 3; consumed=3; reserved rows=3)
- ✓ APPLIED:FALSE: a swept (expired→released) reservation makes commit a no-op
  `{applied:false, released}`; consumed stays 0 (not re-charged)

**`document-processing/tests/finalize-review-metering.spec.ts` (consumer wiring — 7 tests):**
- ✓ commits the reservation when the risk job completes
- ✓ releases the reservation when the risk job fails
- ✓ releases the reservation when the risk job poll times out
- ✓ touches neither commit nor release when invoked without a reservation_id (backward-compat)
- ✓ finalizeReview reserves finalize_review (amount 1, URL contractId) AFTER the access wall
  (asserts wall invocation strictly precedes reserve)
- ✓ does NOT reserve when the access wall rejects (cross-tenant probe) — proves reserve sits
  downstream of the wall; no meter charged
- ✓ releases the reservation in-request when the risk dispatch throws synchronously

**Totals:** Full backend suite **553 passed / 553 total, 60 suites, 0 failed, 0 skipped**
(in-container — real-PG specs ran). `tsc --noEmit` clean. (+11 over the pre-change baseline:
4 real-PG + 7 consumer.)

---

## Staging-deferred (same #135 posture as the prior consumers)

Unit + real-PG integration prove no-crash + logic-unit correctness + no oversell on the dev DB.
Deferred to the Phase 9 staging gate (`docs/metering-part2-staging-gate.md` carries forward):

1. **Full end-to-end HTTP concurrent finalize** at representative volume — the capacity gate is
   proven via concurrent `reserve()` against real PG (same engine path), NOT yet via concurrent
   `POST /contracts/:id/review/finalize` through the live stack with seeded approvable contracts.
2. **TTL vs p99 finalize duration** — `RESERVATION_TTL_SECONDS = 1h` must exceed the max
   end-to-end finalize (3-agent burst) duration, or the sweeper releases an in-flight reservation
   and the late commit lands as `committed_after_release` (succeeded-but-uncharged). The carrier
   divergence makes the sweeper the SOLE backstop here, so this gate matters more for
   finalize_review than for the row-carried consumers — measure finalize p99 on representative
   Arabic-contract load.
3. **`applied:false` alert cadence** — wire the four `metering.finalize_review.*` signals to log
   search / alerting; observe real rates under load.
4. **Pooled-connection READ COMMITTED probe** — inherited engine staging-gate (G.1).

No new lessons added — substantive lessons need real load, deferred to the staging pass (same
discipline as engine lessons #148–#150).
