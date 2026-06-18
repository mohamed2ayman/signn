import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Like every Option B scoped spec, this needs a real Postgres connection
// (DATABASE_URL set): the scoped org filter is a SQL JOIN predicate that only
// real cross-tenant fixtures can prove. CI is unit-test ONLY (CLAUDE.md); a
// silent skip would read green without proving the compliance tenancy gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(compliance-check-scoped.repository.spec.ts): DATABASE_URL unset — ' +
      'these MUST run in an environment with Postgres (dev/staging). CI green ' +
      'here does NOT prove the Option B compliance tenancy gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { ComplianceCheckScopedRepository } from '../compliance-check-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — Chokepoint migration (compliance finale, 4 of 4): REAL-POSTGRES
 * proof of the ComplianceCheck scoped repository against a live schema.
 *
 * Two orgs, each `org → user → project → contract → compliance_checks`. The
 * probes prove (LIST is the lead wired path — listForContract — plus by-id for
 * getDetail / report.request):
 *   1. by-id TENANCY — scopedFindById under orgA returns orgA's check; under
 *      orgB it returns null (no existence leak), resolved through the canonical
 *      check→contract→project→org join (NOT the denormalized project_id column).
 *   2. by-id OrThrow — the no-existence-leak 404 ('Compliance check not found')
 *      on a cross-org probe (the exact shape getDetail / request surface).
 *   3. scopedFindAndCount LIST — orgA's listForContract({contract_id}) returns
 *      orgA's checks and NEVER orgB's; the count is the ORG-GATED count.
 *   4. OVERRIDE SAFETY — the contractIdOverride only NARROWS to a parent
 *      contract; it can never widen or change the caller's org.
 *   5. COEXISTENCE — the independent wall (findInOrg) and the scoped path deny
 *      cross-tenant INDEPENDENTLY.
 *
 * NO DRIFT PROBE on the org boundary: the gate resolves org ONLY via
 * check→contract→project (Q1). ComplianceCheck carries a denormalized
 * `project_id`, but it is NEVER consulted for tenancy — there is no `org_id`
 * column to drift, and project_id is not on the org-resolution path.
 *
 * RED FORM (stated): pre-wire, listForContract / getDetail / report.request all
 * loaded the check with NO org filter (`checkRepo.find/findOne({ where:
 * { contract_id } | { id } })`). With the controller wall neutralised (a wall
 * bug / future bypass), a cross-org check would load and be returned / reported.
 * Post-wire, the scoped path denies it at the data layer INDEPENDENTLY of the
 * wall — probes #1–#3 below.
 */
describeReal('Option B chokepoint — ComplianceCheck scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let checkScoped: ComplianceCheckScopedRepository;
  let wall: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // belongs to orgA
  const contractB = randomUUID(); // belongs to orgB
  // 2 checks on contractA (orgA), 1 on contractB (orgB).
  const checkA1 = randomUUID();
  const checkA2 = randomUUID();
  const checkB1 = randomUUID();

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
    checkScoped = moduleRef.get(ComplianceCheckScopedRepository);
    wall = moduleRef.get(ContractAccessService);

    const seedOrg = async (
      orgId: string,
      userId: string,
      projectId: string,
      contractId: string,
      tag: string,
    ) => {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
        orgId,
        `cc-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'Compliance', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `cc-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.cc.repo.test.xx',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `cc-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `cc-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');

    const seedCheck = async (id: string, contractId: string, projectId: string) =>
      dataSource.query(
        `INSERT INTO compliance_checks
           (id, contract_id, project_id, overall_status, obligation_extraction_status)
         VALUES ($1, $2, $3, 'PENDING', 'PENDING')`,
        [id, contractId, projectId],
      );

    await seedCheck(checkA1, contractA, projectA);
    await seedCheck(checkA2, contractA, projectA);
    await seedCheck(checkB1, contractB, projectB);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM compliance_checks WHERE id IN ($1,$2,$3)`, [
      checkA1,
      checkA2,
      checkB1,
    ]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // 1. by-id TENANCY — getDetail / report.request load a check by id.
  describe('by-id tenancy (canonical check→contract→project→org)', () => {
    it('in-org: scopedFindById returns the orgA check', async () => {
      const row = await checkScoped.scopedFindById(checkA1, orgA);
      expect(row?.id).toBe(checkA1);
      expect(row?.contract_id).toBe(contractA);
    });

    it('cross-org: scopedFindById returns null (no existence leak)', async () => {
      const row = await checkScoped.scopedFindById(checkA1, orgB);
      expect(row).toBeNull();
    });
  });

  // 2. by-id OrThrow — the EXACT shape getDetail / request surface.
  describe('by-id OrThrow (no-existence-leak 404 — the wired getDetail/request read)', () => {
    it('in-org: scopedFindByIdOrThrow returns the row', async () => {
      const row = await checkScoped.scopedFindByIdOrThrow(checkA1, orgA);
      expect(row.id).toBe(checkA1);
    });

    it("cross-org: scopedFindByIdOrThrow throws 404 'Compliance check not found' (RED→GREEN: data-layer denial)", async () => {
      await expect(
        checkScoped.scopedFindByIdOrThrow(checkA1, orgB),
      ).rejects.toMatchObject({ status: 404, message: 'Compliance check not found' });
    });
  });

  // 3. scopedFindAndCount LIST — the wired listForContract path.
  describe('scopedFindAndCount LIST ({contract_id}) — the wired listForContract read', () => {
    it('orgA: returns orgA contract checks, count is the org-gated count, NEVER orgB', async () => {
      const [rows, total] = await checkScoped.scopedFindAndCount(
        { contract_id: contractA },
        orgA,
        { order: { created_at: 'DESC' }, take: 50 },
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([checkA1, checkA2]));
      expect(ids).not.toContain(checkB1);
      expect(total).toBe(2);
    });

    it('cross-org: orgB requesting orgA contract checks → empty + count 0 (gate bounds the count)', async () => {
      const [rows, total] = await checkScoped.scopedFindAndCount(
        { contract_id: contractA },
        orgB,
        { take: 50 },
      );
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });
  });

  // 4. OVERRIDE SAFETY — the override only NARROWS; never widens the org.
  describe('contractIdOverride safety (narrows to a parent contract; never widens the org)', () => {
    it('in-org + correct contract override → returns the row', async () => {
      const row = await checkScoped.scopedFindByIdViaContract(checkA1, orgA, {
        contractIdOverride: contractA,
      });
      expect(row?.id).toBe(checkA1);
    });

    it('in-org + FOREIGN contract override → null (override cannot widen to orgB rows)', async () => {
      const row = await checkScoped.scopedFindByIdViaContract(checkA1, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });

    it("cross-org caller + the row's own (foreign) contract as override → still null (org gate wins)", async () => {
      const row = await checkScoped.scopedFindByIdViaContract(checkA1, orgB, {
        contractIdOverride: contractA,
      });
      expect(row).toBeNull();
    });
  });

  // 5. COEXISTENCE — the wall and the scoped path deny INDEPENDENTLY.
  describe('coexistence with the independent contract-access wall', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFindByIdOrThrow 404s independently', async () => {
      await expect(wall.findInOrg(contractA, orgB)).rejects.toBeTruthy();
      await expect(
        checkScoped.scopedFindByIdOrThrow(checkA1, orgB),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('in-org: the WALL returns the contract AND scopedFindByIdOrThrow returns the row', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      const row = await checkScoped.scopedFindByIdOrThrow(checkA1, orgA);
      expect(row.id).toBe(checkA1);
    });
  });
});
