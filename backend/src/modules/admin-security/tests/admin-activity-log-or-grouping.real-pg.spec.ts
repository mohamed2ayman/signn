import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import { AuditLog, User } from '../../../database/entities';
import { AdminActivityLogService } from '../services/admin-activity-log.service';

/**
 * Admin activity feed — operator-precedence regression guard.
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * `AdminActivityLogService.list()` restricts the feed to admin-relevant action
 * prefixes with a raw string built by `.join(' OR ')`:
 *
 *   qb.where(ADMIN_ACTION_PREFIXES.map((_, i) => `a.action LIKE :p${i}`).join(' OR '))
 *
 * then AND-chains up to five caller filters (actor_id, action, entity_type,
 * search, date range). TypeORM 0.3.28 only parenthesizes a raw-string condition
 * when `isolateWhereStatements` is enabled — it is set nowhere in this repo —
 * so the emitted SQL is:
 *
 *   WHERE a.action LIKE $1 OR ... OR a.action LIKE $7 AND a.entity_type = $8
 *
 * AND binds tighter than OR, so this parses as:
 *
 *   p0 OR p1 OR p2 OR p3 OR p4 OR p5 OR (p6 AND <all the filters>)
 *
 * i.e. the caller's filters constrain ONLY rows matching the LAST prefix
 * (`subscription.`). Every row matching any of the other six prefixes is
 * returned unfiltered — and inflates `total` via the sibling `getCount()`,
 * corrupting pagination. This is a correctness bug on a live SYSTEM_ADMIN feed;
 * `audit_logs` is platform-wide so there is no tenancy dimension to leak.
 *
 * RED→GREEN: against the pre-fix grouping, `WRONG_ENTITY` (action
 * `security.*`, a NON-matching entity_type) is returned and `total` is the
 * whole admin feed. With the disjunction wrapped in one paren pair it is
 * excluded and `total` is exactly the two genuinely-matching rows.
 *
 * DETERMINISM: the probe rows carry a unique random `entity_type`, so with
 * correct grouping the filtered result set is exactly the seeded rows
 * regardless of what else lives in `audit_logs` on the dev database.
 */

jest.setTimeout(120_000);

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[admin-activity-log-or-grouping] SKIPPING real-Postgres spec: DATABASE_URL ' +
      'unset. The bug this guards is in the generated SQL, which only a real ' +
      'database evaluates. CI green here does NOT prove the grouping is correct.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

describeReal('admin activity feed — OR grouping (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let service: AdminActivityLogService;

  // Unique per run so the filtered result set is deterministic against a dev
  // database that already holds unrelated audit_logs rows.
  const PROBE = `or-probe-${randomUUID().slice(0, 8)}`;
  const OTHER = `or-other-${randomUUID().slice(0, 8)}`;

  // action matches the FIRST prefix (security.) — the escaped branch.
  const WRONG_ENTITY = randomUUID(); // security.* + NON-matching entity_type → must NOT appear
  const RIGHT_ENTITY = randomUUID(); // security.* + matching entity_type     → must appear
  const LAST_PREFIX = randomUUID(); // subscription.* + matching entity_type → must appear
  const NON_ADMIN = randomUUID(); // non-admin prefix + matching entity_type → must NOT appear

  const ALL_IDS = [WRONG_ENTITY, RIGHT_ENTITY, LAST_PREFIX, NON_ADMIN];

  const seedLog = async (id: string, action: string, entityType: string) =>
    dataSource.query(
      `INSERT INTO audit_logs (id, action, entity_type) VALUES ($1,$2,$3)`,
      [id, action, entityType],
    );

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
      ],
    }).compile();
    dataSource = moduleRef.get(DataSource);

    service = new AdminActivityLogService(
      dataSource.getRepository(AuditLog),
      dataSource.getRepository(User),
    );

    await seedLog(WRONG_ENTITY, 'security.or_grouping_probe', OTHER);
    await seedLog(RIGHT_ENTITY, 'security.or_grouping_probe', PROBE);
    await seedLog(LAST_PREFIX, 'subscription.or_grouping_probe', PROBE);
    await seedLog(NON_ADMIN, 'contract.or_grouping_probe', PROBE);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM audit_logs WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
    }
    await moduleRef?.close();
  });

  it('entity_type filter applies to EVERY prefix branch, not just the last one', async () => {
    const page = await service.list({ entity_type: PROBE, limit: 200 });
    const ids = page.rows.map((r) => r.id);

    // The escaped branch: `security.*` matched p0 as a bare top-level disjunct,
    // so this row came back despite entity_type not matching the filter.
    expect(ids).not.toContain(WRONG_ENTITY);

    // Genuine matches survive — the fix does not over-restrict.
    expect(ids).toContain(RIGHT_ENTITY);
    expect(ids).toContain(LAST_PREFIX);

    // The prefix restriction itself still works.
    expect(ids).not.toContain(NON_ADMIN);
  });

  it('total (getCount) is not inflated by rows the filter should have excluded', async () => {
    const page = await service.list({ entity_type: PROBE, limit: 200 });

    // entity_type is unique to this run, so exactly two rows can legitimately
    // match: RIGHT_ENTITY and LAST_PREFIX. Under the un-grouped SQL this was
    // the entire admin feed, silently corrupting pagination.
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(2);
  });

  it('the action filter is likewise scoped to all branches', async () => {
    const page = await service.list({
      action: 'subscription.or_grouping_probe',
      limit: 200,
    });
    const ids = page.rows.map((r) => r.id);

    expect(ids).toContain(LAST_PREFIX);
    expect(ids).not.toContain(RIGHT_ENTITY);
    expect(ids).not.toContain(WRONG_ENTITY);
    expect(page.total).toBe(1);
  });

  /**
   * `listKnownActions()` carries the same `.join(' OR ')` string, and it was
   * wrapped in the same commit — but it is the query's ONLY clause (select
   * DISTINCT + where + orderBy, no sibling andWhere), so there is nothing for
   * the OR to mis-bind against. The parens there are therefore DEFENSIVE, not
   * a behaviour fix: this test documents equivalence, and would pass both
   * before and after. It exists so that adding a future `.andWhere()` to that
   * builder cannot silently reintroduce the bug.
   */
  it('listKnownActions returns admin-prefixed actions only (unchanged by the wrap)', async () => {
    const actions = await service.listKnownActions();

    expect(actions).toContain('security.or_grouping_probe');
    expect(actions).toContain('subscription.or_grouping_probe');
    expect(actions).not.toContain('contract.or_grouping_probe');
  });
});
