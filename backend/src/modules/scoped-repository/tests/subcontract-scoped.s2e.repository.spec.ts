import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(subcontract-scoped.s2e.repository.spec.ts): DATABASE_URL unset — these ' +
      'MUST run in an environment with Postgres (dev/staging). CI green here ' +
      'does NOT prove the Option B S2e SubContract tenancy gate, AND it does ' +
      'NOT exercise the load-bearing gate-alias / mainContract-hydration ' +
      'coexistence (which only manifests at real SQL build time).',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { SubContractScopedRepository } from '../subcontract-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — S2e: REAL-POSTGRES proof of the SubContract scoped repository.
 *
 * Two orgs, each `org → user → project → main_contract → sub_contracts`. Beyond
 * the usual five probe groups, this spec carries the LOAD-BEARING gate-alias
 * test: the wired findAllByMainContract requests `relations: ['mainContract']`,
 * and `mainContract` is the SAME relation the org gate walks. The distinct gate
 * alias (`org_gate_main_contract`) must let the gate join and the relation
 * hydration coexist on one query — proven here by hydrating `sub.mainContract`
 * for in-org rows without a duplicate-alias SQL failure.
 *
 * Canonical-only (Q1): resolution walks `subcontract.mainContract` (the
 * `main_contract_id` FK); the denormalized `sub_contract.org_id` is IGNORED.
 */
describeReal('Option B S2e — SubContract scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let subScoped: SubContractScopedRepository;
  let wall: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const mainA = randomUUID(); // main contract belongs to orgA
  const mainB = randomUUID(); // main contract belongs to orgB
  const subA1 = randomUUID();
  const subA2 = randomUUID(); // DRIFTED org_id (orgB)
  const subB1 = randomUUID();

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
    subScoped = moduleRef.get(SubContractScopedRepository);
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
        `s2e-sub-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'S2eS', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `s2e-sub-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.s2e.repo.test.xx',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `s2e-sub-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `s2e-sub-main-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, mainA, 'a');
    await seedOrg(orgB, userB, projectB, mainB, 'b');

    const seedSub = async (
      id: string,
      mainContractId: string,
      orgIdDenorm: string,
      createdBy: string,
      number: string,
    ) =>
      dataSource.query(
        `INSERT INTO sub_contracts
           (id, main_contract_id, subcontract_number, title, scope_description,
            org_id, created_by, subcontractor_name, subcontractor_email)
         VALUES ($1, $2, $3, 'S2e sub', 'scope', $4, $5, 'Sub Co', 'sub@test.local')`,
        [id, mainContractId, number, orgIdDenorm, createdBy],
      );

    await seedSub(subA1, mainA, orgA, userA, 'SC-001');
    // CANONICAL-ONLY PROBE — denormalized org_id points at ORG B; the
    // main_contract FK (the tenancy truth) is orgA's contract.
    await seedSub(subA2, mainA, orgB, userA, 'SC-002');
    await seedSub(subB1, mainB, orgB, userB, 'SC-001');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM sub_contracts WHERE id IN ($1,$2,$3)`, [subA1, subA2, subB1]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [mainA, mainB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  describe('scopedFind tenancy (canonical sub→main_contract→org)', () => {
    it('in-org: orgA lists ONLY orgA sub-contracts for its main contract', async () => {
      const rows = await subScoped.scopedFind({ main_contract_id: mainA }, orgA);
      expect(rows.map((r) => r.id).sort()).toEqual([subA1, subA2].sort());
    });

    it('cross-org: orgB caller gets NONE of orgA sub-contracts — even filtering orgA main', async () => {
      const rows = await subScoped.scopedFind({ main_contract_id: mainA }, orgB);
      expect(rows).toEqual([]);
    });

    it('foreign-main filter cannot widen: orgA filtering orgB main → empty', async () => {
      const rows = await subScoped.scopedFind({ main_contract_id: mainB }, orgA);
      expect(rows).toEqual([]);
    });

    it('broad list is org-scoped: orgA list contains orgA rows but NEVER orgB rows', async () => {
      const rows = await subScoped.scopedFind({}, orgA);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([subA1, subA2]));
      expect(ids).not.toContain(subB1);
    });
  });

  describe('canonical-only resolution — denormalized org_id never consulted', () => {
    it('an orgA sub-contract with a DRIFTED org_id (orgB) still resolves to orgA', async () => {
      const rows = await subScoped.scopedFind({ main_contract_id: mainA }, orgA);
      expect(rows.map((r) => r.id)).toContain(subA2);
    });

    it('the drifted org_id does NOT leak the sub-contract into orgB', async () => {
      const rows = await subScoped.scopedFind({}, orgB);
      expect(rows.map((r) => r.id)).not.toContain(subA2);
    });
  });

  // LOAD-BEARING gate-alias test — mainContract hydration vs the gate join.
  describe("relations: ['creator','mainContract'] — gate join and mainContract hydration coexist", () => {
    it('hydrates BOTH sub.creator and sub.mainContract for in-org rows (no duplicate-alias break)', async () => {
      const rows = await subScoped.scopedFind(
        { main_contract_id: mainA },
        orgA,
        { relations: ['creator', 'mainContract'], order: { created_at: 'DESC' } },
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.creator).toBeDefined();
        expect(row.creator.id).toBe(userA);
        // The relation that COLLIDES with the gate join — must hydrate cleanly.
        expect(row.mainContract).toBeDefined();
        expect(row.mainContract.id).toBe(mainA);
      }
    });

    it('cross-org with the colliding relation is still empty (gate unaffected by hydration)', async () => {
      const rows = await subScoped.scopedFind(
        { main_contract_id: mainA },
        orgB,
        { relations: ['creator', 'mainContract'] },
      );
      expect(rows).toEqual([]);
    });
  });

  describe('by-id OrThrow (wired by findById / update / updateStatus / share)', () => {
    it('in-org: scopedFindByIdOrThrow returns the row', async () => {
      const row = await subScoped.scopedFindByIdOrThrow(subA1, orgA);
      expect(row.id).toBe(subA1);
    });

    it("cross-org: scopedFindByIdOrThrow throws the no-existence-leak 404 ('Subcontract not found')", async () => {
      await expect(
        subScoped.scopedFindByIdOrThrow(subA1, orgB),
      ).rejects.toMatchObject({ status: 404, message: 'Subcontract not found' });
    });

    it('cross-org by-id with a DRIFTED org_id row still denied (canonical-only)', async () => {
      await expect(
        subScoped.scopedFindByIdOrThrow(subA2, orgB),
      ).rejects.toMatchObject({ status: 404 });
      const row = await subScoped.scopedFindByIdOrThrow(subA2, orgA);
      expect(row.id).toBe(subA2);
    });
  });

  describe('coexistence with the independent findInOrg wall (#57)', () => {
    it('cross-tenant: the WALL 404s on the parent main contract AND scopedFind returns []', async () => {
      await expect(wall.findInOrg(mainB, orgA)).rejects.toBeTruthy();
      await expect(
        subScoped.scopedFind({ main_contract_id: mainB }, orgA),
      ).resolves.toEqual([]);
    });

    it('in-org: the WALL returns the main contract AND scopedFind returns the rows', async () => {
      await expect(wall.findInOrg(mainA, orgA)).resolves.toMatchObject({ id: mainA });
      await expect(
        subScoped.scopedFind({ main_contract_id: mainA }, orgA),
      ).resolves.toHaveLength(2);
    });
  });
});
