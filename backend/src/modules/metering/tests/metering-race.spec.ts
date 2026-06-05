import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// This spec needs a real Postgres connection (DATABASE_URL set) for the
// engine's correctness guarantees to be exercised at all. CI is unit-test
// ONLY per CLAUDE.md ("CI is unit-test ONLY — never start Docker containers,
// never use real database, never use real Redis"), so this guard skips the
// suite when DATABASE_URL is unset.
//
// CRITICAL: the skip MUST BE LOUD. A silent describe.skip means a
// misconfigured environment that SHOULD have Postgres would drop these
// tests invisibly and read green. The console.warn below makes it
// impossible to overlook the skip.
//
// Also: `data-source.ts` throws at module load if DATABASE_URL is unset,
// so the import below is a lazy require inside `beforeAll`. A top-level
// import would explode in CI before describe.skip could take effect.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[metering] SKIPPING real-Postgres specs (metering-race.spec.ts): DATABASE_URL ' +
      'unset — these MUST run in an environment with Postgres (dev/staging). ' +
      'CI green here does NOT prove the metering engine is verified; see ' +
      'docs/metering-doc-deltas.md staging-gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { MeteringModule } from '../metering.module';
import { MeteringService } from '../services/metering.service';
import { MeteringCleanupProcessor } from '../processors/metering-cleanup.processor';
import { MeterLimitExceededError } from '../errors/meter-limit-exceeded.error';
import {
  MeterKey,
  MeterLedgerStatus,
  MeterWindowType,
  MeterFailMode,
} from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive: REAL CONCURRENT-RACE TEST.
 *
 * This test runs against the live Postgres (sign-postgres) — NOT mocks.
 * The atomic conditional UPDATE in MeteringService.reserve() can only be
 * trusted under real concurrency. The whole point of this gate is to
 * observe N>M concurrent reservers and prove exactly M succeed.
 *
 * The DB must be migrated up to 1753000000001 before this test runs (the
 * standard `npm run migration:run` path inside the container does this).
 *
 * Test fixtures:
 *   - 1 organization (subject for metering)
 *   - 1 user (project.created_by FK)
 *   - 1 project (organization_id = org)
 *   - 1 contract (project_id = project)
 *
 * Each test cleans its own ledger + balance rows so tests are independent.
 *
 * Why we don't drop/recreate the schema: the dev DB is shared with other
 * suites. We scope all writes to a single test-tagged org id created in
 * beforeAll, then delete every metering row keyed to it in beforeEach.
 */

describeReal('MeteringService (real Postgres concurrent-race test)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let metering: MeteringService;
  let processor: MeteringCleanupProcessor;

  // Fixture refs (set in beforeAll).
  let orgId: string;
  let userId: string;
  let projectId: string;
  let contractId: string;

  // Test limit M and concurrent attempts N. Pushing N high enough that
  // the connection pool has to queue (default pool size = 10) so the
  // racy interleavings include both lock-contention and pool-queue paths.
  const M = 5;
  const N = 50;

  beforeAll(async () => {
    // Lazy require — data-source.ts throws at module load when DATABASE_URL
    // is unset. By requiring here we only evaluate when this suite is
    // actually running (i.e. when DATABASE_URL IS set + describeReal !== skip).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          ...dataSourceOptions,
          autoLoadEntities: true,
        }),
        BullModule.forRoot({
          redis: process.env.REDIS_URL || 'redis://redis:6379',
        }),
        MeteringModule,
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    metering = moduleRef.get(MeteringService);
    processor = moduleRef.get(MeteringCleanupProcessor);

    // ─── Create the fixture tree once. ─────────────────────────────────
    // Using raw SQL keeps this independent of changes to entity defaults
    // / hooks. All ids are deterministic so cleanup is targeted.
    orgId = randomUUID();
    userId = randomUUID();
    projectId = randomUUID();
    contractId = randomUUID();

    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
      [orgId, `metering-race-test-org-${orgId.slice(0, 8)}`],
    );
    // users has many NOT NULL columns with no DB defaults (see audit) — rely
    // on column-level defaults wherever they exist (is_active, mfa_enabled,
    // etc.) and explicit-set the rest.
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         is_active, is_email_verified, mfa_enabled, preferred_language,
         failed_login_attempts, onboarding_completed, onboarding_level,
         email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
         organization_id
       )
       VALUES ($1, $2, $3, 'Metering', 'RaceTest', 'OWNER_ADMIN', 'MANAGING',
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE,
               $4)`,
      [
        userId,
        `metering-race-${userId.slice(0, 8)}@test.local`,
        '$2a$10$dummy.bcrypt.hash.placeholder.value.for.race.test.fixture.x',
        orgId,
      ],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, $3, $4)`,
      [projectId, orgId, `metering-race-project`, userId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
      [contractId, projectId, `metering-race-contract`, userId],
    );

    // Force the compliance meter_definition.default_limit to M for this
    // test suite. This row was seeded by migration 1753000000001 with
    // default_limit=1000; we override to M so the race is observable.
    await dataSource.query(
      `UPDATE meter_definitions SET default_limit = $1 WHERE meter_key = 'compliance'`,
      [M],
    );
  });

  afterAll(async () => {
    // Restore the default_limit so subsequent test runs aren't affected.
    await dataSource.query(
      `UPDATE meter_definitions SET default_limit = 1000 WHERE meter_key = 'compliance'`,
    );

    // Tear down the fixture tree in FK-safe order.
    await dataSource.query(
      `DELETE FROM metering_ledger WHERE subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractId]);
    await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);

    await moduleRef.close();
  });

  beforeEach(async () => {
    // Each test starts with a clean ledger + balance for this org.
    await dataSource.query(
      `DELETE FROM metering_ledger WHERE subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
  });

  function caller() {
    return {
      user_id: userId,
      jwt_organization_id: orgId,
      account_type: 'MANAGING' as const,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // THE GATE — N>M concurrent reservers; exactly M succeed.
  // ─────────────────────────────────────────────────────────────────────
  it(`enforces capacity under N=${N} concurrent reserves with M=${M} (no oversell)`, async () => {
    const attempts = Array.from({ length: N }, (_, i) =>
      metering.reserve({
        caller: caller(),
        meterKey: MeterKey.COMPLIANCE,
        amount: 1,
        idempotencyKey: `race-${i}`, // unique per call → bypasses Pattern C dedup
        contractId,
        actorRef: userId,
      }),
    );

    const settled = await Promise.allSettled(attempts);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');

    expect(fulfilled).toHaveLength(M);
    expect(rejected).toHaveLength(N - M);

    // Every rejection is a METER_LIMIT_COMPLIANCE, never something else.
    for (const r of rejected as Array<PromiseRejectedResult>) {
      expect(r.reason).toBeInstanceOf(MeterLimitExceededError);
      expect(r.reason.meter_key).toBe(MeterKey.COMPLIANCE);
      expect(r.reason.limit).toBe(M);
    }

    // Balance reflects exactly M committed-to-balance.
    const [balanceRow] = await dataSource.query(
      `SELECT consumed FROM metering_balance
       WHERE subject_ref = $1 AND meter_key = 'compliance' AND window_key = $2`,
      [orgId, contractId],
    );
    expect(Number(balanceRow.consumed)).toBe(M);

    // Ledger has exactly M reserved rows, no orphans.
    const [{ count: reservedCount }] = await dataSource.query(
      `SELECT COUNT(*) FROM metering_ledger
       WHERE subject_ref = $1 AND status = 'reserved'`,
      [orgId],
    );
    expect(Number(reservedCount)).toBe(M);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Pattern C idempotency — same key twice → one ledger row.
  // ─────────────────────────────────────────────────────────────────────
  it('returns the existing reservation on a duplicate idempotency_key (Pattern C)', async () => {
    const idem = `idem-${randomUUID()}`;
    const first = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: idem,
      contractId,
      actorRef: userId,
    });
    const second = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: idem,
      contractId,
      actorRef: userId,
    });

    expect(second.reservation_id).toBe(first.reservation_id);
    expect(second.ledger_id).toBe(first.ledger_id);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);

    const [{ count: ledgerRows }] = await dataSource.query(
      `SELECT COUNT(*) FROM metering_ledger WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(ledgerRows)).toBe(1);

    const [balanceRow] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balanceRow.consumed)).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // release() returns capacity to balance; commit() does not.
  // ─────────────────────────────────────────────────────────────────────
  it('release() decrements consumed; commit() does not', async () => {
    const r1 = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: `commit-${randomUUID()}`,
      contractId,
      actorRef: userId,
    });
    const r2 = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: `release-${randomUUID()}`,
      contractId,
      actorRef: userId,
    });

    let [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(2);

    await metering.commit(r1.reservation_id);
    [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(2); // commit does not refund

    await metering.release(r2.reservation_id);
    [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(1); // release refunds

    // Idempotent: re-release is a no-op — applied:false, refund NOT applied
    // again.
    const reReleased = await metering.release(r2.reservation_id);
    expect(reReleased.applied).toBe(false);
    expect(reReleased.status).toBe(MeterLedgerStatus.RELEASED);
    [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(1);

    // commit-then-release on the same id is a NO-OP (post-hardening:
    // status-guarded UPDATE returns applied:false rather than throwing).
    // The work succeeded (committed) — refusing the spurious refund is the
    // correct behaviour, but it must be SILENT for the caller, since
    // release() is the failure-path call and shouldn't itself throw.
    const releaseAfterCommit = await metering.release(r1.reservation_id);
    expect(releaseAfterCommit.applied).toBe(false);
    expect(releaseAfterCommit.status).toBe(MeterLedgerStatus.COMMITTED);
    [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(1); // unchanged — no second refund
  });

  // ─────────────────────────────────────────────────────────────────────
  // Sweeper releases an expired reserve and refunds capacity.
  // ─────────────────────────────────────────────────────────────────────
  it('sweeper releases an expired reserve and refunds capacity', async () => {
    const r = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 2,
      idempotencyKey: `sweep-${randomUUID()}`,
      contractId,
      actorRef: userId,
    });

    let [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(2);

    // Make the ledger row look stale.
    await dataSource.query(
      `UPDATE metering_ledger SET expires_at = NOW() - INTERVAL '1 minute'
       WHERE reservation_id = $1`,
      [r.reservation_id],
    );

    // Trigger the processor directly (the Bull queue itself is not under
    // test here — the work the processor does is).
    await processor.handleCleanup({} as never);

    [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(0);

    const [{ status }] = await dataSource.query(
      `SELECT status FROM metering_ledger WHERE reservation_id = $1`,
      [r.reservation_id],
    );
    expect(status).toBe(MeterLedgerStatus.RELEASED);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Subject derivation — cross-tenant JWT cross-check refuses.
  // ─────────────────────────────────────────────────────────────────────
  it('refuses when managing-user JWT org does not match the contract owning org', async () => {
    const strangerOrg = randomUUID();
    await expect(
      metering.reserve({
        caller: {
          user_id: userId,
          jwt_organization_id: strangerOrg, // mismatch
          account_type: 'MANAGING',
        },
        meterKey: MeterKey.COMPLIANCE,
        amount: 1,
        idempotencyKey: `xtenant-${randomUUID()}`,
        contractId, // owned by orgId, not strangerOrg
        actorRef: userId,
      }),
    ).rejects.toThrow(/cross-check failed/i);

    // No ledger or balance row written for the failed call.
    const [{ count: ledgerRows }] = await dataSource.query(
      `SELECT COUNT(*) FROM metering_ledger WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(ledgerRows)).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Guest caller path does NOT do the JWT cross-check (subject is still
  // the contract's owning org — JWT-trust-disabled for guests is the
  // explicit design at audit §B.2 / Rule 5).
  // ─────────────────────────────────────────────────────────────────────
  it('guest caller: subject is derived from contract, JWT cross-check is skipped', async () => {
    const r = await metering.reserve({
      caller: {
        user_id: randomUUID(),
        jwt_organization_id: randomUUID(), // anything — ignored for guests
        account_type: 'GUEST',
      },
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: `guest-${randomUUID()}`,
      contractId,
      actorRef: userId,
    });
    expect(r.subject_ref).toBe(orgId); // derived, not from JWT
  });

  // ─────────────────────────────────────────────────────────────────────
  // Meter definition shape (smoke test — confirms the seed row exists).
  // ─────────────────────────────────────────────────────────────────────
  it('compliance meter_definition row matches the seed shape', async () => {
    const [row] = await dataSource.query(
      `SELECT meter_key, unit, window_type, fail_mode FROM meter_definitions
       WHERE meter_key = 'compliance'`,
    );
    expect(row.meter_key).toBe(MeterKey.COMPLIANCE);
    expect(row.unit).toBe('run');
    expect(row.window_type).toBe(MeterWindowType.PER_CONTRACT);
    expect(row.fail_mode).toBe(MeterFailMode.CLOSED);
  });

  // ═════════════════════════════════════════════════════════════════════
  // HARDENING-PASS RACE TESTS (Part 1.5 — STEP D).
  //
  // The original Part 1 tests proved the reserve race. These four prove
  // the OTHER transitions are atomic + status-guarded under real
  // concurrency. Each runs against the live Postgres connection pool.
  // ═════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────
  // STEP D.1 — Concurrent commit() + release() on the SAME reservation:
  //   exactly one transition takes effect; final state is consistent
  //   (committed → consumed still counts the row; released → refunded).
  //   No state where the row is committed AND refunded.
  // ─────────────────────────────────────────────────────────────────────
  it('concurrent commit + release on the same reservation: exactly one applies, state consistent', async () => {
    const r = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: `cr-${randomUUID()}`,
      contractId,
      actorRef: userId,
    });

    let [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(1);

    // Fire commit and release in parallel; Promise.allSettled so we see
    // both outcomes regardless of which won.
    const [commitRes, releaseRes] = await Promise.all([
      metering.commit(r.reservation_id),
      metering.release(r.reservation_id),
    ]);

    // Exactly one applied:true. The other is applied:false reporting the
    // terminal state the winner left behind.
    const applied = [commitRes.applied, releaseRes.applied].filter(
      (b) => b === true,
    );
    expect(applied).toHaveLength(1);

    // Read final ledger + balance state.
    const [ledgerRow] = await dataSource.query(
      `SELECT status FROM metering_ledger WHERE reservation_id = $1`,
      [r.reservation_id],
    );
    [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );

    if (commitRes.applied) {
      // Commit won → status=committed, refund did NOT happen.
      expect(ledgerRow.status).toBe(MeterLedgerStatus.COMMITTED);
      expect(Number(balance.consumed)).toBe(1);
      expect(releaseRes.applied).toBe(false);
      expect(releaseRes.status).toBe(MeterLedgerStatus.COMMITTED);
    } else {
      // Release won → status=released, refund DID happen.
      expect(ledgerRow.status).toBe(MeterLedgerStatus.RELEASED);
      expect(Number(balance.consumed)).toBe(0);
      expect(commitRes.applied).toBe(false);
      expect(commitRes.status).toBe(MeterLedgerStatus.RELEASED);
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP D.2 — Double release() concurrently on the same reservation:
  //   consumed refunded exactly ONCE (not twice). Status released.
  //   This is the at-most-once-refund invariant the hardening pass adds.
  // ─────────────────────────────────────────────────────────────────────
  it('concurrent double-release on the same reservation: refund happens exactly once', async () => {
    const r = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: `dr-${randomUUID()}`,
      contractId,
      actorRef: userId,
    });

    let [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(1);

    const [a, b] = await Promise.all([
      metering.release(r.reservation_id),
      metering.release(r.reservation_id),
    ]);

    // Exactly one applied:true.
    const applied = [a.applied, b.applied].filter((x) => x === true);
    expect(applied).toHaveLength(1);

    // Both report final status=released.
    expect(a.status).toBe(MeterLedgerStatus.RELEASED);
    expect(b.status).toBe(MeterLedgerStatus.RELEASED);

    // Refund happened exactly once (consumed went from 1 to 0, NOT to -1).
    [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(0);

    // Cross-check: no negative-consumed CHECK violation in PG logs would
    // have produced a CHECK error and aborted both txns. The fact that
    // we got here with consumed=0 IS the proof.
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP D.3 — Sweeper releases an expired reserve, then a LATE commit()
  //   arrives. The commit is a no-op. Ledger consistent, no double-count,
  //   consumed not negative.
  //
  //   This is the documented TTL-sizing hazard: if reservation TTL is
  //   shorter than the consumer's max end-to-end job duration, the
  //   sweeper can refund capacity while the work is still in flight. The
  //   eventual commit() lands as applied:false. The work succeeded but is
  //   recorded as un-charged.
  //
  //   Part 2 staging-gate (logged in docs/metering-doc-deltas.md):
  //   reservation TTL MUST exceed the max end-to-end duration of every
  //   consumer that calls reserve().
  // ─────────────────────────────────────────────────────────────────────
  it('sweeper-then-late-commit: commit is a no-op, ledger consistent, no double-count', async () => {
    const r = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: `swc-${randomUUID()}`,
      contractId,
      actorRef: userId,
    });

    // Backdate expires_at so the sweeper picks it up.
    await dataSource.query(
      `UPDATE metering_ledger SET expires_at = NOW() - INTERVAL '1 minute'
       WHERE reservation_id = $1`,
      [r.reservation_id],
    );

    // Sweeper releases the expired reserve.
    await processor.handleCleanup({} as never);

    // Confirm the sweep landed.
    let [ledgerRow] = await dataSource.query(
      `SELECT status FROM metering_ledger WHERE reservation_id = $1`,
      [r.reservation_id],
    );
    expect(ledgerRow.status).toBe(MeterLedgerStatus.RELEASED);

    let [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(0);

    // Late commit() arrives — the work succeeded but capacity has been
    // refunded already. commit() must NOT throw, must NOT flip status,
    // and must NOT touch consumed.
    const lateCommit = await metering.commit(r.reservation_id);
    expect(lateCommit.applied).toBe(false);
    expect(lateCommit.status).toBe(MeterLedgerStatus.RELEASED);

    [ledgerRow] = await dataSource.query(
      `SELECT status FROM metering_ledger WHERE reservation_id = $1`,
      [r.reservation_id],
    );
    expect(ledgerRow.status).toBe(MeterLedgerStatus.RELEASED);

    [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    expect(Number(balance.consumed)).toBe(0);
    expect(Number(balance.consumed)).toBeGreaterThanOrEqual(0);
  });

  // ═════════════════════════════════════════════════════════════════════
  // HARDENING-PASS RACE TESTS (Part 1.6 — IDEMPOTENCY).
  //
  // The Part 1 reserve test proved the capacity gate. The Part 1.5 tests
  // proved commit/release/sweeper atomicity. These three prove the
  // SAME-KEY-CONCURRENCY guarantee: N parallel reserve() calls with the
  // same idempotency_key always resolve to the SAME reservation, charge
  // at most once, never surface a raw DB error, and never weaken the
  // capacity gate for DIFFERENT-key contention.
  // ═════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.1 — N concurrent reserves with the SAME idempotency_key against
  //   default_limit = 1. Old code: 1 caller wins, 19 throw raw 23505 or
  //   MeterLimitExceeded. New code (insert-first / ON CONFLICT DO NOTHING):
  //   all 20 resolve to the SAME reservation_id, exactly ONE ledger row,
  //   consumed == 1.
  // ─────────────────────────────────────────────────────────────────────
  it('N=20 concurrent same-key reserves with limit=1: all dedup to one reservation, charge once, no raw errors', async () => {
    // Force the compliance meter's default_limit to 1 for this test.
    await dataSource.query(
      `UPDATE meter_definitions SET default_limit = 1 WHERE meter_key = 'compliance'`,
    );

    const SAME_KEY = `same-${randomUUID()}`;
    const N_IDEM = 20;

    const settled = await Promise.allSettled(
      Array.from({ length: N_IDEM }, () =>
        metering.reserve({
          caller: caller(),
          meterKey: MeterKey.COMPLIANCE,
          amount: 1,
          idempotencyKey: SAME_KEY,
          contractId,
          actorRef: userId,
        }),
      ),
    );

    // Reset default_limit so subsequent tests in this file see M=5 again.
    await dataSource.query(
      `UPDATE meter_definitions SET default_limit = $1 WHERE meter_key = 'compliance'`,
      [M],
    );

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');

    // No raw errors. Every caller got a Reservation.
    expect(rejected).toHaveLength(0);
    expect(fulfilled).toHaveLength(N_IDEM);

    // All N callers resolved to the same reservation_id.
    const reservationIds = (
      fulfilled as Array<PromiseFulfilledResult<{ reservation_id: string }>>
    ).map((s) => s.value.reservation_id);
    const uniqueIds = new Set(reservationIds);
    expect(uniqueIds.size).toBe(1);

    // Exactly one ledger row for this (subject, meter, idem key).
    const [{ count: ledgerRows }] = await dataSource.query(
      `SELECT COUNT(*) FROM metering_ledger
       WHERE subject_ref = $1 AND meter_key = 'compliance'
         AND idempotency_key = $2`,
      [orgId, SAME_KEY],
    );
    expect(Number(ledgerRows)).toBe(1);

    // Balance charged exactly once.
    const [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance
       WHERE subject_ref = $1 AND meter_key = 'compliance' AND window_key = $2`,
      [orgId, contractId],
    );
    expect(Number(balance.consumed)).toBe(1);

    // Exactly one caller's result has `reused:false` (the winner); the
    // other N-1 have `reused:true`.
    const reusedCount = (
      fulfilled as Array<PromiseFulfilledResult<{ reused: boolean }>>
    ).filter((s) => s.value.reused === true).length;
    expect(reusedCount).toBe(N_IDEM - 1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.2 — Same-key reserve AFTER the first is committed → returns
  //   the existing (committed) reservation, no new ledger row, no extra
  //   charge.
  //
  //   Pattern C lookup must work against ledger rows in ANY terminal
  //   status (committed / released), not just `reserved`. The unique
  //   constraint covers the row's whole lifetime.
  // ─────────────────────────────────────────────────────────────────────
  it('same-key reserve after commit returns the committed reservation, no extra charge', async () => {
    const KEY = `post-commit-${randomUUID()}`;

    const first = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: KEY,
      contractId,
      actorRef: userId,
    });
    expect(first.reused).toBe(false);

    const commitRes = await metering.commit(first.reservation_id);
    expect(commitRes.applied).toBe(true);
    expect(commitRes.status).toBe(MeterLedgerStatus.COMMITTED);

    // Re-attempt with the same idempotency_key.
    const retry = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.COMPLIANCE,
      amount: 1,
      idempotencyKey: KEY,
      contractId,
      actorRef: userId,
    });
    expect(retry.reused).toBe(true);
    expect(retry.reservation_id).toBe(first.reservation_id);
    expect(retry.ledger_id).toBe(first.ledger_id);

    // Exactly one ledger row; balance unchanged from the original reserve.
    const [{ count: ledgerRows }] = await dataSource.query(
      `SELECT COUNT(*) FROM metering_ledger
       WHERE subject_ref = $1 AND meter_key = 'compliance'
         AND idempotency_key = $2`,
      [orgId, KEY],
    );
    expect(Number(ledgerRows)).toBe(1);

    const [{ status }] = await dataSource.query(
      `SELECT status FROM metering_ledger WHERE idempotency_key = $1`,
      [KEY],
    );
    expect(status).toBe(MeterLedgerStatus.COMMITTED);

    const [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance
       WHERE subject_ref = $1 AND meter_key = 'compliance' AND window_key = $2`,
      [orgId, contractId],
    );
    expect(Number(balance.consumed)).toBe(1); // not 2 — the retry was free
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.3 — TWO DIFFERENT idempotency_keys against default_limit=1,
  //   concurrent. The dedup MUST NOT weaken the capacity gate. Exactly
  //   one succeeds; the other throws MeterLimitExceeded.
  // ─────────────────────────────────────────────────────────────────────
  it('two different idempotency_keys at limit=1 concurrent: exactly one wins, one throws MeterLimitExceeded', async () => {
    await dataSource.query(
      `UPDATE meter_definitions SET default_limit = 1 WHERE meter_key = 'compliance'`,
    );

    const KEY_A = `diff-a-${randomUUID()}`;
    const KEY_B = `diff-b-${randomUUID()}`;

    const [a, b] = await Promise.allSettled([
      metering.reserve({
        caller: caller(),
        meterKey: MeterKey.COMPLIANCE,
        amount: 1,
        idempotencyKey: KEY_A,
        contractId,
        actorRef: userId,
      }),
      metering.reserve({
        caller: caller(),
        meterKey: MeterKey.COMPLIANCE,
        amount: 1,
        idempotencyKey: KEY_B,
        contractId,
        actorRef: userId,
      }),
    ]);

    await dataSource.query(
      `UPDATE meter_definitions SET default_limit = $1 WHERE meter_key = 'compliance'`,
      [M],
    );

    const fulfilled = [a, b].filter((s) => s.status === 'fulfilled');
    const rejected = [a, b].filter((s) => s.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const reject = rejected[0] as PromiseRejectedResult;
    expect(reject.reason).toBeInstanceOf(MeterLimitExceededError);
    expect(reject.reason.meter_key).toBe(MeterKey.COMPLIANCE);
    expect(reject.reason.limit).toBe(1);

    // Exactly one ledger row across both keys.
    const [{ count: ledgerRows }] = await dataSource.query(
      `SELECT COUNT(*) FROM metering_ledger
       WHERE subject_ref = $1 AND meter_key = 'compliance'
         AND idempotency_key IN ($2, $3)`,
      [orgId, KEY_A, KEY_B],
    );
    expect(Number(ledgerRows)).toBe(1);

    // Balance respects the cap.
    const [balance] = await dataSource.query(
      `SELECT consumed FROM metering_balance
       WHERE subject_ref = $1 AND meter_key = 'compliance' AND window_key = $2`,
      [orgId, contractId],
    );
    expect(Number(balance.consumed)).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.4 — Regression: reserve N=50/M=5 race STILL holds after the
  //   insert-first refactor.
  // ─────────────────────────────────────────────────────────────────────
  it('regression — reserve race still enforces capacity after hardening (N=50 / M=5)', async () => {
    const RN = 50;
    const attempts = Array.from({ length: RN }, (_, i) =>
      metering.reserve({
        caller: caller(),
        meterKey: MeterKey.COMPLIANCE,
        amount: 1,
        idempotencyKey: `reg-race-${i}-${randomUUID()}`,
        contractId,
        actorRef: userId,
      }),
    );

    const settled = await Promise.allSettled(attempts);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');

    expect(fulfilled).toHaveLength(M); // M = 5 from the suite header
    expect(rejected).toHaveLength(RN - M);

    const [balanceRow] = await dataSource.query(
      `SELECT consumed FROM metering_balance
       WHERE subject_ref = $1 AND meter_key = 'compliance' AND window_key = $2`,
      [orgId, contractId],
    );
    expect(Number(balanceRow.consumed)).toBe(M);
  });
});
