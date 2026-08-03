import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';

import { DashboardAnalyticsService } from '../dashboard-analytics.service';
import {
  Project,
  Contract,
  Clause,
  ContractClause,
  RiskAnalysis,
  Obligation,
  DocumentUpload,
  Organization,
  User,
  UserRole,
} from '../../../database/entities';

/**
 * Dashboard-analytics org-scope leak fix — real Postgres.
 *
 * The bug (Shape-i): getProjectStats used
 *   projectRepository.count({ where: { organization_id: orgId } }).
 * When orgId is undefined (a no-org principal — a SYSTEM_ADMIN is seeded with a
 * NULL organization_id, and the controller is JwtAuthGuard-only with no @Roles),
 * TypeORM's find-options DROPS the undefined key → the WHERE vanishes → the count
 * spans EVERY org's projects (a platform-wide COUNT leak, not content). The 7
 * sibling stat methods already used a QueryBuilder bound param, which fails
 * closed; getProjectStats was the lone outlier.
 *
 * The fix, two complementary controls:
 *   a) PRIMARY — a mandatory non-null orgId guard at getDashboardAnalytics entry
 *      (throws BadRequestException before any query runs).
 *   b) DEFENSE-IN-DEPTH — getProjectStats rewritten to the fail-closed
 *      QueryBuilder .where('project.organization_id = :orgId', { orgId }), so a
 *      null/undefined orgId binds as `= NULL` → 0, safe even if (a) is bypassed.
 *
 * This spec SEEDS its own fixtures (org A: 2 projects, org B: 3) and proves:
 *   - getProjectStats(orgA) counts ONLY org A (2), never org B (would be 5);
 *   - getDashboardAnalytics(orgA).projects.total is org-scoped (2);
 *   - LEAK INPUT getProjectStats(undefined) fails closed → 0 (never all-orgs);
 *   - ENTRY GUARD getDashboardAnalytics(undefined) throws BadRequestException.
 * Assertions key on the SEEDED org ids, so ambient projects don't matter (org A
 * is a fresh UUID with exactly its 2 seeded projects; the undefined case asserts
 * a hard 0, which no ambient data can inflate under the fix).
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[dashboard-analytics.org-scope] SKIPPING real-Postgres spec: DATABASE_URL ' +
      'unset. This MUST run against Postgres to prove the org-scope. CI green ' +
      'here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(60000);

describeReal('DashboardAnalyticsService — org-scope leak fix (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let projectRepo: Repository<Project>;
  let orgRepo: Repository<Organization>;
  let userRepo: Repository<User>;
  let service: DashboardAnalyticsService;

  const orgAId = randomUUID();
  const orgBId = randomUUID();
  const userId = randomUUID(); // creator FK target for the seeded projects
  const projA = [randomUUID(), randomUUID()]; // org A: 2 projects
  const projB = [randomUUID(), randomUUID(), randomUUID()]; // org B: 3 projects

  const seedProject = (id: string, orgId: string, label: string) =>
    projectRepo.save(
      projectRepo.create({
        id,
        organization_id: orgId,
        name: `orgscope-${label}-${id.slice(0, 8)}`,
        created_by: userId,
      }),
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
    projectRepo = dataSource.getRepository(Project);
    orgRepo = dataSource.getRepository(Organization);
    userRepo = dataSource.getRepository(User);

    // Real repos for all 7 constructor deps. Only getProjectStats is exercised
    // with data; the other stat methods run real (empty) org-scoped queries and
    // return zeros — no stubs, no reliance on safeQuery swallowing errors.
    service = new DashboardAnalyticsService(
      projectRepo,
      dataSource.getRepository(Contract),
      dataSource.getRepository(Clause),
      dataSource.getRepository(ContractClause),
      dataSource.getRepository(RiskAnalysis),
      dataSource.getRepository(Obligation),
      dataSource.getRepository(DocumentUpload),
    );

    await orgRepo.save(orgRepo.create({ id: orgAId, name: `orgscope-A-${orgAId.slice(0, 8)}` }));
    await orgRepo.save(orgRepo.create({ id: orgBId, name: `orgscope-B-${orgBId.slice(0, 8)}` }));
    await userRepo.save(
      userRepo.create({
        id: userId,
        email: `orgscope-${userId.slice(0, 8)}@example.test`,
        password_hash: 'x', // not a login path — FK target only
        first_name: 'Org',
        last_name: 'Scope',
        role: UserRole.OWNER_ADMIN,
      }),
    );
    for (const id of projA) await seedProject(id, orgAId, 'A');
    for (const id of projB) await seedProject(id, orgBId, 'B');
  });

  afterAll(async () => {
    await projectRepo.delete([...projA, ...projB]);
    await userRepo.delete(userId);
    await orgRepo.delete([orgAId, orgBId]);
    await moduleRef?.close();
  });

  it('getProjectStats(orgA) counts ONLY org A projects (2), never org B (would be 5)', async () => {
    const stats = await (service as any).getProjectStats(orgAId);
    expect(stats.total).toBe(2);
  });

  it('getDashboardAnalytics(orgA).projects.total is org-scoped (2)', async () => {
    const dash = await service.getDashboardAnalytics(orgAId);
    expect(dash.projects.total).toBe(2);
  });

  it('LEAK INPUT: getProjectStats(undefined) fails closed — QB binds NULL → 0, never all-orgs', async () => {
    // Pre-fix: count({ where: { organization_id: undefined } }) DROPS the key →
    // counts EVERY org's projects (>= 5 here + ambient). Post-fix: the QB binds
    // `= NULL` → matches nothing → 0.
    const stats = await (service as any).getProjectStats(undefined);
    expect(stats.total).toBe(0);
  });

  it('ENTRY GUARD: getDashboardAnalytics(undefined) throws BadRequestException before any query', async () => {
    await expect(
      service.getDashboardAnalytics(undefined as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
