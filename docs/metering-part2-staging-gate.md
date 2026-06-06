# Metering Part 2 — Phase 9 release-gate runbook (compliance consumer)

**Status:** Phase 9 deploy checklist. **NOT a merge-gate.** Every item below is
**UNVERIFIED-PENDING-STAGING** and must be run against a real staging environment
before this code is promoted to production — but the items are sized to Phase 9
deploy infrastructure, not to a PR merge.

This repository is explicitly pre-deployment: CLAUDE.md "Integration & Deployment
Rules" states **"We Are NOT in the Deployment Phase Yet ... All work is local
development only,"** and CLAUDE.md Phase 9 / 9.1 is where the deployment
substrate (storage adapters, email providers, staging environment, blue-green
deploy) lands. The G.1–G.7 items below are real and will block the **Phase 9
production cut**, but they are NOT items that block merging this PR to `main` —
there is no staging environment to run them against today.

**Reading guide for reviewers:** treat this file as the deferred deploy checklist
that will be picked up when Phase 9 infrastructure exists. Do not interpret the
UNVERIFIED-PENDING-STAGING markers as merge blockers.

**Source-commit context for the items below:**
- Consumer commit: `ca1e025` on `feat/metering-compliance-consumer-7.18` (PR #49,
  squash-merged into main).
- Wired on top of: engine PR #46 (squash `9200f38`) + access wall PR #45
  (squash `63a9ed6`).
- Consumer surface: `POST /api/v1/contracts/:contractId/compliance-checks` and
  the GET reconcile path.

---

## What the dev container DID prove (recorded here for context, NOT re-verified on staging)

| # | Container-side evidence | Limit of the evidence |
|---|---|---|
| 1 | 5-scenario end-to-end against real Postgres + real Anthropic on dev (`sign-postgres`, `sign-ai-backend`); ledger / balance / log evidence in the PR description | dev pool of 10 connections; localhost paths; not under realistic prod-load concurrency |
| 2 | Scheduled sweeper IS REGISTERED (boot log) and ticks autonomously every 5 min on the cron `*/5 * * * *` | "ticking" only confirms cron fires; does NOT prove the sweeper actually releases an expired reservation end-to-end (Scenario 4 in dev was hand-simulated via SQL) |
| 3 | Migration applied to dev DB (`compliance_checks.reservation_id` column + partial index visible in `\d`) | does NOT prove the migration runs in the deploy pipeline |
| 4 | Full backend suite 446/446 (with `DATABASE_URL` set) | CI skips the 20 real-Postgres metering specs per engine PR #46's CI-fix; CI green here does NOT exercise the metering invariants |

Everything from row 2 onward needs a staging-side check below.

---

## G.1 — Pooled-connection READ COMMITTED probe under load

**UNVERIFIED-PENDING-STAGING.**

The engine's `MeteringService.onModuleInit()` runs `SHOW transaction_isolation` ONCE at
boot, against the connection the boot process happens to take from the pool. It does NOT
prove every pooled connection runs READ COMMITTED under load. A PgBouncer transaction-mode
pooler can hand the engine a different-isolation connection per checkout.

### Command (run on staging app server, while a representative load is hitting `/compliance-checks`)

```sh
# 1. Identify the pooler in front of the staging DB:
#    Common: PgBouncer (look at DATABASE_URL host pointing to :6432, or a pooler hostname)
echo "Pooler host: $(echo "$DATABASE_URL" | sed -E 's#.*@([^/]+)/.*#\1#')"

# 2. Inside the staging backend container, sample transaction_isolation from a fresh
#    pool connection 50× under load:
docker exec sign-backend node -e '
const { DataSource } = require("typeorm");
const { dataSourceOptions } = require("./dist/config/data-source");
(async () => {
  const ds = new DataSource(dataSourceOptions); await ds.initialize();
  const samples = [];
  for (let i = 0; i < 50; i++) {
    const r = await ds.query("SHOW transaction_isolation");
    samples.push(r[0].transaction_isolation);
  }
  const counts = samples.reduce((a,v)=>(a[v]=(a[v]||0)+1,a),{});
  console.log("samples by level:", counts);
  await ds.destroy();
})();
'
```

### Pass criterion

- `samples by level: { 'read committed': 50 }` — 100% of samples are `read committed`. **Any other level on any sample fails the gate** and requires a redesign before merge (engine code change to `SET LOCAL transaction_isolation = 'read committed'` at the top of `dataSource.transaction()` — engine follow-up PR, not consumer scope).

---

## G.2 — p99 reserve→commit interval vs `RESERVATION_TTL_SECONDS = 3600`

**UNVERIFIED-PENDING-STAGING.**

The engine's `RESERVATION_TTL_SECONDS` is a module const at `60 * 60` (1 hour). If true
p99 of reserve→commit exceeds 1h, the swept-then-uncharged path fires for real.

### Command (after ≥ 7 days of staging traffic)

```sql
-- Run inside staging Postgres
SELECT
  COUNT(*) AS sample_size,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (committed_at - reserved_at))) AS p50_seconds,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (committed_at - reserved_at))) AS p95_seconds,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (committed_at - reserved_at))) AS p99_seconds
FROM metering_ledger
WHERE meter_key = 'compliance'
  AND status = 'committed'
  AND committed_at > NOW() - INTERVAL '7 days';

-- Also count the loud applied:false-on-success signal:
SELECT COUNT(*) AS committed_after_release_warns
FROM <your log destination — Loki / CloudWatch / etc.>
WHERE log_message LIKE '%metering.compliance.committed_after_release%'
  AND log_time > NOW() - INTERVAL '7 days';
```

### Pass criterion

- **p99 < 1800s** (TTL × 0.5 — comfortable). Comfortable headroom.
- **OR p99 < 2880s** (TTL × 0.8 — acceptable). Start scheduling the TTL env-promotion.
- **p99 ≥ 2880s** (TTL × 0.8 — danger zone) OR `committed_after_release_warns / total_commits > 0.1%`: **PROMOTE `RESERVATION_TTL_SECONDS` to env-driven** before merge. This is a small engine follow-up PR (not consumer scope):
  - Add `METERING_RESERVATION_TTL_SECONDS` to the Joi schema in `app.module.ts` (`Joi.number().integer().min(60).default(3600)`)
  - Document in `.env.example`
  - Replace the module const in `metering.service.ts:77` with `this.configService.get<number>('METERING_RESERVATION_TTL_SECONDS')`
  - Per Phase 1.5 hard rule, both edits in the SAME commit.

---

## G.3 — Scheduled sweeper actually RELEASES an expired reservation (not hand-run SQL)

**UNVERIFIED-PENDING-STAGING.** (The dev verification in Scenario 4 simulated this with hand-run SQL.)

The dev container confirms the cron *fires* every 5 min, but Scenario 4 of the live
verify replaced the sweeper's actual UPDATE with hand-issued SQL. Staging must prove
the in-process scheduler genuinely flips `reserved → released` and refunds `consumed`
on a row it found by itself.

### Procedure

```sh
# 1. On staging, create a brand-new test reservation via the wired POST endpoint:
TOKEN=<staging managing-user JWT for a test org>
CONTRACT=<a test contract id you control on staging>
curl -X POST -H "Authorization: Bearer $TOKEN" "$STAGING_BASE/api/v1/contracts/$CONTRACT/compliance-checks"
# Note the returned `reservation_id` from the response body.

# 2. In the staging DB, force its expires_at to the past so it qualifies for sweep:
psql "$DATABASE_URL" <<SQL
UPDATE metering_ledger
SET expires_at = NOW() - INTERVAL '1 minute'
WHERE reservation_id = '<the reservation_id from step 1>';
SELECT reservation_id, status, expires_at, NOW() AS now
FROM metering_ledger
WHERE reservation_id = '<the reservation_id from step 1>';
SQL

# 3. Wait for the NEXT scheduled tick (the engine cron is */5 — at most 5 minutes).
#    Watch the backend log for the sweeper processor:
tail -F <your staging backend log destination> | grep -E "MeteringCleanupProcessor|metering"

# Expected — within 5 minutes of the past-expires_at update, you must see:
#   [MeteringCleanupProcessor] Metering cleanup tick: released 1/1 dangling reserves (failures: 0)
# NOT just "no dangling reserves to sweep" — the latter means the sweep didn't pick it up.

# 4. After the log line, verify the DB state:
psql "$DATABASE_URL" <<SQL
SELECT reservation_id, status, released_at, NOW() AS now
FROM metering_ledger
WHERE reservation_id = '<the reservation_id>';
-- And confirm the balance was refunded:
SELECT subject_ref, meter_key, window_key, consumed
FROM metering_balance
WHERE subject_ref = (SELECT subject_ref FROM metering_ledger WHERE reservation_id = '<the reservation_id>')
  AND window_key = (SELECT window_key FROM metering_ledger WHERE reservation_id = '<the reservation_id>');
SQL
```

### Pass criterion

- Processor log line: `Metering cleanup tick: released 1/1 dangling reserves (failures: 0)` within 5 min of step 2.
- Ledger row: `status='released'`, `released_at` stamped (within the same tick).
- `metering_balance.consumed` value reduced by `amount` (refunded).

**If the sweeper does NOT release within 10 min:** something is wrong with the Bull queue infrastructure on staging (Redis connectivity, repeatable-job persistence, worker not running). Investigate before merge — this is the ONLY autonomous reconcile path for never-polled runs.

---

## G.4 — Capacity gate holds under realistic concurrent volume

**UNVERIFIED-PENDING-STAGING.**

Dev verified N=5 / M=2 in one contract window. Production traffic may run dozens of
concurrent compliance starts per second across orgs.

### Procedure

```sh
# 1. Set a tight subject_allowance for a test org so the gate fires:
psql "$DATABASE_URL" -c "INSERT INTO subject_allowances (subject_ref, meter_key, \"limit\") VALUES ('<TEST_ORG>', 'compliance', 10) ON CONFLICT (subject_ref, meter_key) DO UPDATE SET \"limit\" = 10;"

# 2. Fire 50 concurrent POSTs across MULTIPLE contracts in that org so both
#    same-contract (limit=10 per contract) and different-contract distributions are
#    exercised. Use a tool that does true parallel HTTP (e.g. `hey`, `vegeta`, `wrk`):
hey -n 50 -c 50 -m POST -H "Authorization: Bearer $TOKEN" \
  "$STAGING_BASE/api/v1/contracts/$CONTRACT_X/compliance-checks"
hey -n 50 -c 50 -m POST -H "Authorization: Bearer $TOKEN" \
  "$STAGING_BASE/api/v1/contracts/$CONTRACT_Y/compliance-checks"
# (mix CONTRACT_X and CONTRACT_Y so the per_contract window varies)

# 3. Confirm zero oversell + reserve-latency under load:
psql "$DATABASE_URL" <<SQL
SELECT window_key, consumed FROM metering_balance
WHERE subject_ref = '<TEST_ORG>' AND meter_key = 'compliance';
-- Any row with consumed > 10 is an oversell — STOP.

-- Reserve latency under load (p50 / p95):
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (created_at - reserved_at)) * 1000) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (created_at - reserved_at)) * 1000) AS p95_ms
FROM metering_ledger
WHERE meter_key = 'compliance' AND reserved_at > NOW() - INTERVAL '5 minutes';
SQL
```

### Pass criterion

- `consumed > limit` returns zero rows for every (subject, contract) window. **No oversell.**
- All `METER_LIMIT_COMPLIANCE` responses observed during the test carry the correct `{limit, current}` envelope.
- Reserve p95 latency < 200ms under load. Target < 50ms.

---

## G.5 — `compliance_checks.reservation_id` migration runs in the DEPLOY pipeline

**UNVERIFIED-PENDING-STAGING.**

Dev applied the migration via direct `npm run typeorm — migration:run`. The deploy
pipeline path is different (may run via `npm start` with `migrationsRun: true`, or via a
dedicated migration job).

### Procedure

```sh
# On staging, AFTER the deploy:
psql "$DATABASE_URL" <<SQL
-- 1. Confirm the column exists:
\d compliance_checks
-- Expect `reservation_id | uuid | nullable` in the output.

-- 2. Confirm the partial index exists:
\di idx_compliance_checks_reservation_id
-- Expect: idx_compliance_checks_reservation_id | btree (reservation_id) WHERE reservation_id IS NOT NULL.

-- 3. Confirm migration row recorded:
SELECT name FROM migrations WHERE name LIKE '%Reservation%';
-- Expect: AddReservationIdToComplianceChecks1754000000001.
SQL
```

### Pass criterion

All three SELECTs return the expected rows. **If column is missing, the deploy did NOT run migrations — STOP and inspect the pipeline before retrying.**

---

## G.6 — Metering specs run against REAL Postgres on staging (CI skips them)

**UNVERIFIED-PENDING-STAGING.**

Per the engine PR #46's CI-fix (now part of `9200f38`), the two metering specs SKIP
themselves when `DATABASE_URL` is unset. CI green does NOT exercise the engine. Staging
must run them against the staging Postgres.

### Procedure

```sh
# Inside the staging backend container OR a staging CI job with DATABASE_URL pointed
# at the staging DB:
npx jest --runInBand --testPathPattern="modules/metering" 2>&1 | tail -25
```

### Pass criterion

```
Test Suites: 2 passed, 2 total
Tests:       20 passed, 20 total
```

AND zero `[metering] SKIPPING real-Postgres specs` warns in stdout — if any fire, `DATABASE_URL` is misconfigured on staging.

**If either spec fails on staging (passes locally):** investigate immediately — staging-specific Postgres config (isolation level, lock timeout, advisory locks, pooler-injected SET commands) is the most likely cause. Block merge until resolved.

---

## G.7 — Frontend double-submit guard (idempotency v1 limit)

**UNVERIFIED-PENDING-STAGING.**

Compliance is intentionally non-idempotent across distinct user clicks (matches existing
behaviour). The engine `idempotency_key` is `randomUUID()` per call — two clicks =
two charges. Until/unless a client-supplied `Idempotency-Key` HTTP header lands (audit
§9.2 deferred), the frontend MUST disable the "Run check" button on click.

### Procedure

1. On staging, open the compliance run UI as a managing user.
2. Open browser DevTools → Network tab.
3. Click "Run check" once, hard, on a clauseful contract.
4. **Within 100 ms,** before the button visually settles, click it 3 more times rapidly.

### Pass criterion

Only **one** `POST /compliance-checks` request appears in the Network tab. If two or more fire, the frontend lacks a click-disable guard — file the frontend bug AND decide whether to ship the metered backend without it (pricing impact: a clicky user gets charged twice for one intent).

---

## When G.1–G.7 all PASS (on the Phase 9 staging environment)

- The metering compliance consumer is cleared for **Phase 9 production cut**, not for
  merge into `main` (which has already happened — Part 2 lives on `main`).
- Within the Phase 9 prep window:
  - Run any earned lessons.md additions against the then-current merged SHA — anything
    earned by G.2 promoting the TTL, or by G.3 finding a sweeper-fires-but-doesn't-release
    bug, or by G.4 finding an oversell at scale, goes into lessons.md THEN. (Substantive
    Part 2 lessons need real load = Phase 9; do not invent them earlier.)
  - If G.2 demanded it, promote `RESERVATION_TTL_SECONDS` to env-driven with its Joi
    schema entry + `.env.example` line in a small engine follow-up commit (Phase 1.5
    hard rule).

**G.1–G.7 are merge-orthogonal.** Part 2 is on `main` because the wiring is correct and
the engine-level invariants are proven by the engine's own real-Postgres specs (see G.6).
The G-items above gate the production cut, not the merge.
