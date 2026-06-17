import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(contract-scoped-relations.repository.spec.ts): DATABASE_URL unset — ' +
      'these MUST run in an environment with Postgres (dev/staging). CI green ' +
      'here does NOT prove the scopedFindByIdWithRelations gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { ContractScopedRepository } from '../contract-scoped.repository';

/**
 * Option B — Chokepoint migration (compliance finale): REAL-POSTGRES proof of the
 * base's new silent-null {@link ContractScopedRepository.scopedFindByIdWithRelations}.
 *
 * This is the ADDITIVE parent-load fix the finale chose (option b — it touches
 * the load-bearing ROOT gate's existing code NOT AT ALL). It is exercised by BOTH
 * compliance's jurisdiction load (ComplianceService.runCheck) AND chat's
 * now-un-deferred buildLegalContext, which load the parent Contract + its
 * `project` purely to read `project.country`.
 *
 * The probes prove, against a live schema:
 *   1. HYDRATION — in-org, the row returns WITH `project` hydrated (the
 *      `project.country` the callers read is present). This is the whole point:
 *      hydrating the `project` relation must NOT collide with the ROOT gate join
 *      (which the base achieves via the distinct `rel_project` hydration alias).
 *   2. SILENT-NULL CROSS-ORG (RED→GREEN) — under orgB, contractA resolves to
 *      null (NOT a throw) — the silent fallback the callers depend on. Pre-fix,
 *      the bare `contractRepo.findOne({ relations:['project'] })` applied NO org
 *      filter and would have returned the foreign contract's jurisdiction.
 *   3. SILENT-NULL MISSING — a non-existent id resolves to null, never throws.
 */
describeReal('ContractScopedRepository.scopedFindByIdWithRelations (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let scoped: ContractScopedRepository;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // orgA, project country 'Egypt'
  const contractB = randomUUID(); // orgB

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        ScopedRepositoryModule,
        TypeOrmModule.forFeature([Contract]),
      ],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    scoped = moduleRef.get(ContractScopedRepository);

    const seedOrg = async (
      orgId: string,
      userId: string,
      projectId: string,
      contractId: string,
      country: string,
      tag: string,
    ) => {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
        orgId,
        `csr-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'Relations', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `csr-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.csr.repo.test.x',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, country, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [projectId, orgId, `csr-project-${tag}`, country, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `csr-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'Egypt', 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'United Kingdom', 'b');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  it('in-org: returns the contract WITH project hydrated (no gate-alias collision)', async () => {
    const row = await scoped.scopedFindByIdWithRelations(contractA, orgA, ['project']);
    expect(row?.id).toBe(contractA);
    // The relation hydrated through the distinct `rel_project` alias — the
    // jurisdiction the callers read is present.
    expect(row?.project).toBeDefined();
    expect(row?.project?.country).toBe('Egypt');
  });

  it('cross-org: contractA under orgB resolves to null — silent fallback, no throw (RED→GREEN)', async () => {
    const row = await scoped.scopedFindByIdWithRelations(contractA, orgB, ['project']);
    expect(row).toBeNull();
  });

  it('missing id: resolves to null, never throws (silent fallback)', async () => {
    const row = await scoped.scopedFindByIdWithRelations(randomUUID(), orgA, ['project']);
    expect(row).toBeNull();
  });

  it('no relations requested: still returns the in-org row (relations arg is optional-empty)', async () => {
    const row = await scoped.scopedFindByIdWithRelations(contractA, orgA, []);
    expect(row?.id).toBe(contractA);
  });
});
