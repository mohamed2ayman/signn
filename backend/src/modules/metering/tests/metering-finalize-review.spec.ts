import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Same posture as metering-race.spec.ts: this spec needs a real Postgres
// (DATABASE_URL set). CI is unit-test ONLY (CLAUDE.md), so the guard skips
// LOUDLY when DATABASE_URL is unset — a silent skip would read green without
// proving anything. `data-source.ts` throws at module load when DATABASE_URL
// is unset, so the require is lazy inside beforeAll.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[metering] SKIPPING real-Postgres specs (metering-finalize-review.spec.ts): ' +
      'DATABASE_URL unset — these MUST run in an environment with Postgres ' +
      '(dev/staging). CI green here does NOT prove the finalize_review consumer ' +
      'is verified; see docs/metering-finalize-review.md.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { MeteringModule } from '../metering.module';
import { MeteringService } from '../services/metering.service';
import { MeterLimitExceededError } from '../errors/meter-limit-exceeded.error';
import { MeterKey, MeterLedgerStatus } from '../enums/meter-key.enum';

/**
 * Phase 7.18 — finalize_review metered consumer: REAL-Postgres lifecycle.
 *
 * The finalize_review meter is a NEW meter_key wired in this change. This
 * spec proves the new key rides the EXISTING generic engine (no engine logic
 * change) for the four STEP-2 evidence scenarios, against live Postgres:
 *
 *   1. HAPPY    reserve → consumed+1 → commit → committed, consumed unchanged.
 *   2. FAILURE  reserve → consumed+1 → release → released, consumed refunded.
 *   3. CAPACITY subject_allowance override (low limit) + N concurrent reserves
 *               on the same contract → exactly limit succeed, rest meter-limit.
 *               No oversell.
 *   4. APPLIED:FALSE  reserve → expire → sweep (releaseByLedgerId) → commit
 *               returns {applied:false, status:'released'} (the swept-then-
 *               uncharged hazard the consumer's observable signal surfaces).
 *
 * Fixture tree (raw SQL, deterministic ids): org → user → project → contract.
 * Window is per_contract, so window_key === contractId.
 */
describeReal('MeteringService — finalize_review consumer (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let metering: MeteringService;

  let orgId: string;
  let userId: string;
  let projectId: string;
  let contractId: string;

  // Capacity-gate parameters: subject_allowance limit M, N concurrent reserves.
  const M = 3;
  const N = 25;

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        BullModule.forRoot({
          redis: process.env.REDIS_URL || 'redis://redis:6379',
        }),
        MeteringModule,
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    metering = moduleRef.get(MeteringService);

    orgId = randomUUID();
    userId = randomUUID();
    projectId = randomUUID();
    contractId = randomUUID();

    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
      [orgId, `finalize-review-test-org-${orgId.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         is_active, is_email_verified, mfa_enabled, preferred_language,
         failed_login_attempts, onboarding_completed, onboarding_level,
         email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
         organization_id
       )
       VALUES ($1, $2, $3, 'Finalize', 'ReviewTest', 'OWNER_ADMIN', 'MANAGING',
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE,
               $4)`,
      [
        userId,
        `finalize-review-${userId.slice(0, 8)}@test.local`,
        '$2a$10$dummy.bcrypt.hash.placeholder.value.for.finalize.test.fixture',
        orgId,
      ],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, $3, $4)`,
      [projectId, orgId, `finalize-review-project`, userId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
      [contractId, projectId, `finalize-review-contract`, userId],
    );
  });

  afterAll(async () => {
    // FK-safe teardown.
    await dataSource.query(`DELETE FROM subject_allowances WHERE subject_ref = $1`, [orgId]);
    await dataSource.query(`DELETE FROM metering_ledger WHERE subject_ref = $1`, [orgId]);
    await dataSource.query(`DELETE FROM metering_balance WHERE subject_ref = $1`, [orgId]);
    await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractId]);
    await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    await moduleRef.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM subject_allowances WHERE subject_ref = $1`, [orgId]);
    await dataSource.query(`DELETE FROM metering_ledger WHERE subject_ref = $1`, [orgId]);
    await dataSource.query(`DELETE FROM metering_balance WHERE subject_ref = $1`, [orgId]);
  });

  function caller() {
    return {
      user_id: userId,
      jwt_organization_id: orgId,
      account_type: 'MANAGING' as const,
    };
  }

  async function consumed(): Promise<number> {
    const rows = await dataSource.query(
      `SELECT consumed FROM metering_balance
       WHERE subject_ref = $1 AND meter_key = 'finalize_review' AND window_key = $2`,
      [orgId, contractId],
    );
    return rows[0] ? Number(rows[0].consumed) : 0;
  }

  async function ledgerStatus(reservationId: string): Promise<string | null> {
    const rows = await dataSource.query(
      `SELECT status FROM metering_ledger WHERE reservation_id = $1`,
      [reservationId],
    );
    return rows[0] ? rows[0].status : null;
  }

  // ── 1. HAPPY: reserve → commit ──────────────────────────────────────────
  it('HAPPY: reserve consumes 1, commit flips reserved→committed and leaves consumed at 1', async () => {
    const reservation = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.FINALIZE_REVIEW,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId,
      actorRef: userId,
      metadata: { route: 'POST /contracts/:contractId/review/finalize' },
    });

    // window_key === contractId (per_contract).
    expect(reservation.window_key).toBe(contractId);
    expect(reservation.meter_key).toBe(MeterKey.FINALIZE_REVIEW);
    expect(await consumed()).toBe(1);
    expect(await ledgerStatus(reservation.reservation_id)).toBe('reserved');

    const result = await metering.commit(reservation.reservation_id);
    expect(result).toEqual({ applied: true, status: MeterLedgerStatus.COMMITTED });

    // Capacity stays consumed; ledger is committed.
    expect(await consumed()).toBe(1);
    expect(await ledgerStatus(reservation.reservation_id)).toBe('committed');
  });

  // ── 2. FAILURE: reserve → release (refund) ──────────────────────────────
  it('FAILURE: reserve consumes 1, release flips reserved→released and refunds consumed to 0', async () => {
    const reservation = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.FINALIZE_REVIEW,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId,
      actorRef: userId,
    });
    expect(await consumed()).toBe(1);

    const result = await metering.release(reservation.reservation_id);
    expect(result).toEqual({ applied: true, status: MeterLedgerStatus.RELEASED });

    expect(await consumed()).toBe(0);
    expect(await ledgerStatus(reservation.reservation_id)).toBe('released');
  });

  // ── 3. CAPACITY: subject_allowance=M, N concurrent reserves → exactly M ──
  it(`CAPACITY: subject_allowance=${M}, N=${N} concurrent reserves → exactly ${M} succeed, no oversell`, async () => {
    // Per-org override via subject_allowances (precedence tier 1) — proves
    // the new key resolves limits through the same precedence chain.
    await dataSource.query(
      `INSERT INTO subject_allowances (subject_ref, meter_key, "limit")
       VALUES ($1, 'finalize_review', $2)`,
      [orgId, M],
    );

    const attempts = Array.from({ length: N }, (_, i) =>
      metering.reserve({
        caller: caller(),
        meterKey: MeterKey.FINALIZE_REVIEW,
        amount: 1,
        idempotencyKey: `finalize-cap-${i}`, // unique → bypasses Pattern C dedup
        contractId,
        actorRef: userId,
      }),
    );
    const settled = await Promise.allSettled(attempts);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(fulfilled).toHaveLength(M);
    expect(rejected).toHaveLength(N - M);

    for (const r of rejected as Array<PromiseRejectedResult>) {
      expect(r.reason).toBeInstanceOf(MeterLimitExceededError);
      expect(r.reason.meter_key).toBe(MeterKey.FINALIZE_REVIEW);
      expect(r.reason.limit).toBe(M);
    }

    // No oversell — exactly M consumed, exactly M reserved ledger rows.
    expect(await consumed()).toBe(M);
    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*) FROM metering_ledger
       WHERE subject_ref = $1 AND meter_key = 'finalize_review' AND status = 'reserved'`,
      [orgId],
    );
    expect(Number(count)).toBe(M);
  });

  // ── 4. APPLIED:FALSE: swept-then-commit ─────────────────────────────────
  it('APPLIED:FALSE: a swept (expired→released) reservation makes commit a no-op {applied:false, released}', async () => {
    const reservation = await metering.reserve({
      caller: caller(),
      meterKey: MeterKey.FINALIZE_REVIEW,
      amount: 1,
      idempotencyKey: randomUUID(),
      contractId,
      actorRef: userId,
    });
    expect(await consumed()).toBe(1);

    // Force-expire the reservation so the sweeper-shaped releaseByLedgerId
    // (guarded on expires_at < NOW()) can reap it.
    await dataSource.query(
      `UPDATE metering_ledger SET expires_at = NOW() - INTERVAL '1 second'
       WHERE reservation_id = $1`,
      [reservation.reservation_id],
    );

    const swept = await metering.releaseByLedgerId(reservation.ledger_id);
    expect(swept).toEqual({ applied: true, status: MeterLedgerStatus.RELEASED });
    expect(await consumed()).toBe(0); // refunded by the sweep

    // The consumer's late commit lands as a no-op — this is what the
    // `metering.finalize_review.committed_after_release` observable signal
    // fires on.
    const late = await metering.commit(reservation.reservation_id);
    expect(late).toEqual({ applied: false, status: MeterLedgerStatus.RELEASED });
    expect(await consumed()).toBe(0); // still 0 — not re-charged
  });
});
