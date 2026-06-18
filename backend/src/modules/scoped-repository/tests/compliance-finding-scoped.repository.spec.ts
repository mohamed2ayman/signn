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
      '(compliance-finding-scoped.repository.spec.ts): DATABASE_URL unset — ' +
      'these MUST run in an environment with Postgres (dev/staging). CI green ' +
      'here does NOT prove the Option B compliance tenancy gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { ComplianceFindingScopedRepository } from '../compliance-finding-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — Chokepoint migration (compliance finale, 4 of 4): REAL-POSTGRES
 * proof of the ComplianceFinding scoped repository against a live schema.
 *
 * ComplianceFinding is a TRANSITIVE child — it has NO direct contract_id, so
 * org resolves via the FOUR-hop join `finding → compliance_check → contract →
 * project → organization_id`. The fixtures seed the full chain in BOTH orgs
 * (`org → user → project → contract → compliance_check → compliance_finding`).
 *
 * The wired path is `ComplianceFindingService.updateStatus`'s by-id load, so the
 * probes lead with by-id (and OrThrow, the exact 'Finding not found' 404 shape):
 *   1. by-id TENANCY — orgA returns orgA's finding; orgB returns null (no leak),
 *      resolved through the transitive check→contract→project→org chain.
 *   2. by-id OrThrow — the no-existence-leak 404 ('Finding not found').
 *   3. OVERRIDE SAFETY — contractIdOverride (pinning the check's parent contract)
 *      only NARROWS; never widens the caller's org.
 *   4. LIST gate (faithful base) — scopedFind({}, org) is org-bounded across the
 *      transitive chain even with an EMPTY allowlist; no list CALLER is wired.
 *   5. COEXISTENCE — the independent wall and the scoped path deny independently.
 *
 * RED FORM (stated): pre-wire, updateStatus's bare `findingRepo.findOne({ where:
 * { id } })` applied NO org filter — with the controller wall neutralised, a
 * cross-org finding would load and be mutated. Post-wire, scopedFindByIdOrThrow
 * denies it with the no-existence-leak 404 at the data layer, INDEPENDENTLY of
 * the wall — probe #2 below.
 */
describeReal('Option B chokepoint — ComplianceFinding scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let findingScoped: ComplianceFindingScopedRepository;
  let wall: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // belongs to orgA
  const contractB = randomUUID(); // belongs to orgB
  const checkA = randomUUID();
  const checkB = randomUUID();
  // 2 findings under checkA (orgA), 1 under checkB (orgB).
  const findA1 = randomUUID();
  const findA2 = randomUUID();
  const findB1 = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        ScopedRepositoryModule,
        TypeOrmModule.forFeature([Contract, GuestContractAccess]),
      ],
      providers: [ContractAccessService],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    findingScoped = moduleRef.get(ComplianceFindingScopedRepository);
    wall = moduleRef.get(ContractAccessService);

    const seedOrg = async (
      orgId: string,
      userId: string,
      projectId: string,
      contractId: string,
      checkId: string,
      tag: string,
    ) => {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
        orgId,
        `cf-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'Finding', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `cf-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.cf.repo.test.xx',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `cf-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `cf-contract-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO compliance_checks
           (id, contract_id, project_id, overall_status, obligation_extraction_status)
         VALUES ($1, $2, $3, 'PENDING', 'PENDING')`,
        [checkId, contractId, projectId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, checkA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, checkB, 'b');

    const seedFinding = async (id: string, checkId: string) =>
      dataSource.query(
        `INSERT INTO compliance_findings
           (id, compliance_check_id, layer, finding_type, severity, requirement, status)
         VALUES ($1, $2, 'STANDARD', 'DEVIATION', 'MEDIUM', 'test requirement', 'OPEN')`,
        [id, checkId],
      );

    await seedFinding(findA1, checkA);
    await seedFinding(findA2, checkA);
    await seedFinding(findB1, checkB);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM compliance_findings WHERE id IN ($1,$2,$3)`, [
      findA1,
      findA2,
      findB1,
    ]);
    await dataSource.query(`DELETE FROM compliance_checks WHERE id IN ($1,$2)`, [checkA, checkB]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // 1. by-id TENANCY — the wired updateStatus path is a by-id load.
  describe('by-id tenancy (transitive finding→check→contract→project→org)', () => {
    it('in-org: scopedFindById returns the orgA finding', async () => {
      const row = await findingScoped.scopedFindById(findA1, orgA);
      expect(row?.id).toBe(findA1);
      expect(row?.compliance_check_id).toBe(checkA);
    });

    it('cross-org: scopedFindById returns null (no existence leak across the transitive chain)', async () => {
      const row = await findingScoped.scopedFindById(findA1, orgB);
      expect(row).toBeNull();
    });
  });

  // 2. by-id OrThrow — the EXACT shape updateStatus surfaces.
  describe('by-id OrThrow (no-existence-leak 404 — the wired updateStatus read)', () => {
    it('in-org: scopedFindByIdOrThrow returns the row', async () => {
      const row = await findingScoped.scopedFindByIdOrThrow(findA1, orgA);
      expect(row.id).toBe(findA1);
    });

    it("cross-org: scopedFindByIdOrThrow throws 404 'Finding not found' (RED→GREEN: data-layer denial)", async () => {
      await expect(
        findingScoped.scopedFindByIdOrThrow(findA1, orgB),
      ).rejects.toMatchObject({ status: 404, message: 'Finding not found' });
    });
  });

  // 3. OVERRIDE SAFETY — the override (the check's parent contract) only NARROWS.
  describe('contractIdOverride safety (narrows to the check parent contract; never widens the org)', () => {
    it('in-org + correct contract override → returns the row', async () => {
      const row = await findingScoped.scopedFindByIdViaContract(findA1, orgA, {
        contractIdOverride: contractA,
      });
      expect(row?.id).toBe(findA1);
    });

    it('in-org + FOREIGN contract override → null (override cannot widen to orgB rows)', async () => {
      const row = await findingScoped.scopedFindByIdViaContract(findA1, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });

    it("cross-org caller + the row's own (foreign) contract as override → still null (org gate wins)", async () => {
      const row = await findingScoped.scopedFindByIdViaContract(findA1, orgB, {
        contractIdOverride: contractA,
      });
      expect(row).toBeNull();
    });
  });

  // 4. LIST gate (faithful base) — org-bounded even with an EMPTY allowlist.
  describe('scopedFind({}) list gate (faithful base; org-scoped across the transitive chain)', () => {
    it('orgA list contains orgA findings and NEVER orgB findings', async () => {
      const rows = await findingScoped.scopedFind({}, orgA);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([findA1, findA2]));
      expect(ids).not.toContain(findB1);
    });

    it('orgB list contains orgB finding and NEVER orgA findings', async () => {
      const rows = await findingScoped.scopedFind({}, orgB);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(findB1);
      expect(ids).not.toContain(findA1);
      expect(ids).not.toContain(findA2);
    });
  });

  // 5. COEXISTENCE — the wall and the scoped path deny INDEPENDENTLY.
  describe('coexistence with the independent contract-access wall', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFindByIdOrThrow 404s independently', async () => {
      await expect(wall.findInOrg(contractA, orgB)).rejects.toBeTruthy();
      await expect(
        findingScoped.scopedFindByIdOrThrow(findA1, orgB),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('in-org: the WALL returns the contract AND scopedFindByIdOrThrow returns the row', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      const row = await findingScoped.scopedFindByIdOrThrow(findA1, orgA);
      expect(row.id).toBe(findA1);
    });
  });
});
