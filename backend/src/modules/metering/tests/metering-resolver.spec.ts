import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import { dataSourceOptions } from '../../../config/data-source';

import { MeteringModule } from '../metering.module';
import { MeteringResolver } from '../services/metering-resolver.service';
import { MeteringService } from '../services/metering.service';
import { MeterLimitExceededError } from '../errors/meter-limit-exceeded.error';
import { MeterKey } from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive: RESOLVER PRECEDENCE TEST.
 *
 * Real Postgres, seeded rows. Locks the three-tier resolution invariant:
 *   subject_allowance > plan_allowance > meter_definition.default_limit.
 *
 * Crucially: a row whose `limit` is 0 is BINDING — meter disabled, deny
 * everything. NOT treated as unset. The resolver must branch on row
 * presence, never on the limit's value being falsy. STEP A confirmed the
 * existing code already does this; these tests lock it down.
 *
 * Tests use a dedicated fixture tree (org/user/project/contract) created
 * once in beforeAll and torn down in afterAll. Each test cleans its own
 * subject_allowances / plan_allowances rows so tests are independent.
 * subscription_plans + organization_subscriptions rows are also tracked
 * for cleanup (these tables are otherwise unused in dev).
 */

describe('MeteringResolver.resolveLimit precedence (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let resolver: MeteringResolver;
  let metering: MeteringService;

  // Fixture refs.
  let orgId: string;
  let userId: string;
  let projectId: string;
  let contractId: string;
  let planId: string;
  let subscriptionId: string;

  // Tier values chosen so A ≠ B ≠ C and 0 stands apart from all of them.
  const SUBJECT_LIMIT = 7;
  const PLAN_LIMIT = 17;
  const DEFAULT_LIMIT_FOR_TESTS = 23;

  beforeAll(async () => {
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
    resolver = moduleRef.get(MeteringResolver);
    metering = moduleRef.get(MeteringService);

    // ─── Fixture: org / user / project / contract ──────────────────────
    orgId = randomUUID();
    userId = randomUUID();
    projectId = randomUUID();
    contractId = randomUUID();

    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
      [orgId, `metering-resolver-test-${orgId.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         is_active, is_email_verified, mfa_enabled, preferred_language,
         failed_login_attempts, onboarding_completed, onboarding_level,
         email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
         organization_id
       )
       VALUES ($1, $2, $3, 'Resolver', 'Test', 'OWNER_ADMIN', 'MANAGING',
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE,
               $4)`,
      [
        userId,
        `metering-resolver-${userId.slice(0, 8)}@test.local`,
        '$2a$10$dummy.bcrypt.hash.placeholder.value.for.resolver.test.x',
        orgId,
      ],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, $3, $4)`,
      [projectId, orgId, `metering-resolver-project`, userId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
      [contractId, projectId, `metering-resolver-contract`, userId],
    );

    // ─── Fixture: plan + active subscription ──────────────────────────
    planId = randomUUID();
    subscriptionId = randomUUID();
    await dataSource.query(
      `INSERT INTO subscription_plans
         (id, name, description, price, currency, duration_days,
          max_projects, max_users, max_contracts_per_project,
          is_active, require_mfa)
       VALUES ($1, $2, 'resolver-test', 0, 'USD', 365, 99, 99, 99, TRUE, TRUE)`,
      [planId, `metering-resolver-plan-${planId.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO organization_subscriptions
         (id, organization_id, plan_id, status, start_date, end_date)
       VALUES ($1, $2, $3, 'ACTIVE',
               NOW() - INTERVAL '1 day',
               NOW() + INTERVAL '365 days')`,
      [subscriptionId, orgId, planId],
    );

    // Bump compliance default_limit to our deterministic test value.
    await dataSource.query(
      `UPDATE meter_definitions SET default_limit = $1 WHERE meter_key = 'compliance'`,
      [DEFAULT_LIMIT_FOR_TESTS],
    );
  });

  afterAll(async () => {
    // Restore the default_limit so other tests aren't affected.
    await dataSource.query(
      `UPDATE meter_definitions SET default_limit = 1000 WHERE meter_key = 'compliance'`,
    );

    // FK-safe teardown.
    await dataSource.query(
      `DELETE FROM metering_ledger WHERE subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM subject_allowances WHERE subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM plan_allowances WHERE plan_id = $1`,
      [planId],
    );
    await dataSource.query(
      `DELETE FROM organization_subscriptions WHERE id = $1`,
      [subscriptionId],
    );
    await dataSource.query(`DELETE FROM subscription_plans WHERE id = $1`, [
      planId,
    ]);
    await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractId]);
    await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);

    await moduleRef.close();
  });

  beforeEach(async () => {
    // Each test starts with a clean allowance set + clean ledger/balance
    // for this org. Plan + subscription survive between tests (they're
    // the "active subscription exists" baseline most tests share). Tests
    // that want NO active subscription mark the subscription INACTIVE
    // explicitly and restore it in their own cleanup.
    await dataSource.query(
      `DELETE FROM metering_ledger WHERE subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM metering_balance WHERE subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM subject_allowances WHERE subject_ref = $1`,
      [orgId],
    );
    await dataSource.query(
      `DELETE FROM plan_allowances WHERE plan_id = $1`,
      [planId],
    );
    // Keep subscription ACTIVE between tests (the "no sub" test toggles
    // and restores it itself).
    await dataSource.query(
      `UPDATE organization_subscriptions SET status = 'ACTIVE' WHERE id = $1`,
      [subscriptionId],
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.1 — Subject precedence: subject_allowance + plan_allowance +
  //   default; resolveLimit must return the SUBJECT row's limit.
  // ─────────────────────────────────────────────────────────────────────
  it('returns subject_allowance.limit when subject + plan + default all present', async () => {
    await dataSource.query(
      `INSERT INTO subject_allowances (subject_ref, meter_key, "limit")
       VALUES ($1, 'compliance', $2)`,
      [orgId, SUBJECT_LIMIT],
    );
    await dataSource.query(
      `INSERT INTO plan_allowances (plan_id, meter_key, "limit")
       VALUES ($1, 'compliance', $2)`,
      [planId, PLAN_LIMIT],
    );

    const limit = await resolver.resolveLimit(orgId, MeterKey.COMPLIANCE);
    expect(limit).toBe(SUBJECT_LIMIT);
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.2 — Plan precedence: no subject_allowance, plan_allowance
  //   present, active subscription. resolveLimit must return plan limit.
  // ─────────────────────────────────────────────────────────────────────
  it('returns plan_allowance.limit when subject_allowance absent but active sub + plan_allowance present', async () => {
    await dataSource.query(
      `INSERT INTO plan_allowances (plan_id, meter_key, "limit")
       VALUES ($1, 'compliance', $2)`,
      [planId, PLAN_LIMIT],
    );

    const limit = await resolver.resolveLimit(orgId, MeterKey.COMPLIANCE);
    expect(limit).toBe(PLAN_LIMIT);
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.3 — Default fallthrough: no subject, NO active subscription,
  //   no overrides → meter_definition.default_limit.
  // ─────────────────────────────────────────────────────────────────────
  it('falls through to meter_definition.default_limit when no subscription and no overrides', async () => {
    await dataSource.query(
      `UPDATE organization_subscriptions SET status = 'INACTIVE' WHERE id = $1`,
      [subscriptionId],
    );
    try {
      const limit = await resolver.resolveLimit(orgId, MeterKey.COMPLIANCE);
      expect(limit).toBe(DEFAULT_LIMIT_FOR_TESTS);
    } finally {
      // Restore so beforeEach's reactivation matters less.
      await dataSource.query(
        `UPDATE organization_subscriptions SET status = 'ACTIVE' WHERE id = $1`,
        [subscriptionId],
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.4 — Org on a real ACTIVE plan that has NO plan_allowance row
  //   for this meter_key → clean fall-through to default_limit.
  //   This is the "plan exists but isn't configured for this meter" case
  //   (audit §6.4). MUST NOT throw, MUST NOT return null.
  // ─────────────────────────────────────────────────────────────────────
  it('falls through to default_limit when active plan has NO plan_allowance row for the meter', async () => {
    // Active subscription is already in place from beforeEach. No plan
    // allowance, no subject allowance.
    const limit = await resolver.resolveLimit(orgId, MeterKey.COMPLIANCE);
    expect(limit).toBe(DEFAULT_LIMIT_FOR_TESTS);
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.5a — subject_allowance.limit = 0 is BINDING.
  //   The 0 must propagate through resolveLimit and through to reserve(),
  //   where any amount≥1 must throw MeterLimitExceeded. This is the
  //   "meter disabled for this org" feature.
  // ─────────────────────────────────────────────────────────────────────
  it('subject_allowance.limit=0 is binding (meter disabled), NOT coalesced to a lower tier', async () => {
    // Plan limit = generous, default = generous. Subject = 0 must win.
    await dataSource.query(
      `INSERT INTO plan_allowances (plan_id, meter_key, "limit")
       VALUES ($1, 'compliance', $2)`,
      [planId, PLAN_LIMIT],
    );
    await dataSource.query(
      `INSERT INTO subject_allowances (subject_ref, meter_key, "limit")
       VALUES ($1, 'compliance', 0)`,
      [orgId],
    );

    const limit = await resolver.resolveLimit(orgId, MeterKey.COMPLIANCE);
    expect(limit).toBe(0);

    // End-to-end: a reserve must throw MeterLimitExceededError with limit=0.
    await expect(
      metering.reserve({
        caller: {
          user_id: userId,
          jwt_organization_id: orgId,
          account_type: 'MANAGING',
        },
        meterKey: MeterKey.COMPLIANCE,
        amount: 1,
        idempotencyKey: `subject-zero-${randomUUID()}`,
        contractId,
        actorRef: userId,
      }),
    ).rejects.toMatchObject({
      meter_key: MeterKey.COMPLIANCE,
      limit: 0,
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // STEP C.5b — plan_allowance.limit = 0 is BINDING (same invariant for
  //   the middle tier).
  // ─────────────────────────────────────────────────────────────────────
  it('plan_allowance.limit=0 is binding (meter disabled), NOT coalesced to default', async () => {
    await dataSource.query(
      `INSERT INTO plan_allowances (plan_id, meter_key, "limit")
       VALUES ($1, 'compliance', 0)`,
      [planId],
    );

    const limit = await resolver.resolveLimit(orgId, MeterKey.COMPLIANCE);
    expect(limit).toBe(0);

    await expect(
      metering.reserve({
        caller: {
          user_id: userId,
          jwt_organization_id: orgId,
          account_type: 'MANAGING',
        },
        meterKey: MeterKey.COMPLIANCE,
        amount: 1,
        idempotencyKey: `plan-zero-${randomUUID()}`,
        contractId,
        actorRef: userId,
      }),
    ).rejects.toBeInstanceOf(MeterLimitExceededError);
  });
});
