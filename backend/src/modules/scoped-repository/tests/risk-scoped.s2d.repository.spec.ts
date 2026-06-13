import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Like the S1/S2a/S2c specs, this needs a real Postgres connection
// (DATABASE_URL set): the scoped org filter is a SQL JOIN predicate that only
// real cross-tenant fixtures can prove. CI is unit-test ONLY (CLAUDE.md); a
// silent skip would read green without proving the S2d RiskAnalysis tenancy gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(risk-scoped.s2d.repository.spec.ts): DATABASE_URL unset — ' +
      'these MUST run in an environment with Postgres (dev/staging). CI ' +
      'green here does NOT prove the Option B S2d RiskAnalysis tenancy gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { RiskScopedRepository } from '../risk-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — S2d: REAL-POSTGRES proof of the RiskAnalysis scoped repository
 * against a live schema.
 *
 * Two orgs, each `org → user → project → contract → risk_analyses`. The probes
 * prove:
 *   1. scopedFind TENANCY — a risk LIST under orgA returns only orgA's rows;
 *      an orgB caller gets NONE of orgA's rows, resolved through the canonical
 *      risk→contract→project→org join.
 *   2. CANONICAL chain — RiskAnalysis has NO denormalized org/project column
 *      (its only tenant link is contract_id), so resolution is inherently
 *      canonical: an orgA risk is reachable ONLY via orgA, never via orgB.
 *   3. RELATION HYDRATION coexists with the org gate — `relations: ['contract']`
 *      hydrates `risk.contract` without colliding with the org_gate_* join.
 *   4. By-id foundation (no by-id risk caller is wired in S2d — the inline-join
 *      B.3/B.5 loads are LEFT; the shape is established here for a later pass).
 *   5. COEXISTENCE — the findInOrg wall and scopedFind deny cross-tenant
 *      INDEPENDENTLY (two checks, two layers).
 */
describeReal('Option B S2d — RiskAnalysis scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let riskScoped: RiskScopedRepository;
  let wall: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // belongs to orgA
  const contractB = randomUUID(); // belongs to orgB
  const riskA1 = randomUUID();
  const riskA2 = randomUUID();
  const riskB1 = randomUUID();

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
    riskScoped = moduleRef.get(RiskScopedRepository);
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
        `s2d-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'S2d', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `s2d-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.s2d.repo.test.xx',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `s2d-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `s2d-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');

    const seedRisk = async (id: string, contractId: string, category: string) =>
      dataSource.query(
        `INSERT INTO risk_analyses (id, contract_id, risk_category, risk_level, description)
         VALUES ($1, $2, $3, 'HIGH', $4)`,
        [id, contractId, category, `s2d risk ${category}`],
      );

    await seedRisk(riskA1, contractA, 'PAYMENT');
    await seedRisk(riskA2, contractA, 'LIABILITY');
    await seedRisk(riskB1, contractB, 'TERMINATION');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM risk_analyses WHERE id IN ($1,$2,$3)`, [
      riskA1,
      riskA2,
      riskB1,
    ]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // 1. scopedFind TENANCY — the lead probe.
  describe('scopedFind tenancy (canonical risk→contract→org)', () => {
    it('in-org: orgA lists ONLY orgA risks for its contract', async () => {
      const rows = await riskScoped.scopedFind({ contract_id: contractA }, orgA);
      expect(rows.map((r) => r.id).sort()).toEqual([riskA1, riskA2].sort());
    });

    it('cross-org: orgB caller gets NONE of orgA risks — even filtering on orgA contract', async () => {
      const rows = await riskScoped.scopedFind({ contract_id: contractA }, orgB);
      expect(rows).toEqual([]);
    });

    it('foreign-contract filter cannot widen: orgA filtering orgB contract → empty', async () => {
      const rows = await riskScoped.scopedFind({ contract_id: contractB }, orgA);
      expect(rows).toEqual([]);
    });

    it('broad list is org-scoped: orgA list contains orgA risks but NEVER orgB risks', async () => {
      const rows = await riskScoped.scopedFind({}, orgA);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([riskA1, riskA2]));
      expect(ids).not.toContain(riskB1);
    });
  });

  // 3. RELATION HYDRATION — proves the gate-alias choice (risk.contract
  //    hydration must coexist with the org_gate_contract join).
  describe("relations: ['contract'] — gate join and hydration coexist", () => {
    it('hydrates risk.contract for in-org rows', async () => {
      const rows = await riskScoped.scopedFind(
        { contract_id: contractA },
        orgA,
        { relations: ['contract'], order: { created_at: 'DESC' } },
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.contract).toBeDefined();
        expect(row.contract.id).toBe(contractA);
        expect(row.contract.name).toBe('s2d-contract-a');
      }
    });

    it('cross-org with relations is still empty (gate unaffected by hydration)', async () => {
      const rows = await riskScoped.scopedFind(
        { contract_id: contractA },
        orgB,
        { relations: ['contract'] },
      );
      expect(rows).toEqual([]);
    });
  });

  // 4. By-id FOUNDATION (no by-id risk caller wired in S2d; shape established).
  describe('by-id foundation', () => {
    it('in-org: scopedFindById resolves the risk via its contract→org', async () => {
      const row = await riskScoped.scopedFindById(riskA1, orgA);
      expect(row?.id).toBe(riskA1);
    });

    it('cross-org: scopedFindById returns null (no existence leak)', async () => {
      const row = await riskScoped.scopedFindById(riskA1, orgB);
      expect(row).toBeNull();
    });

    it("cross-org: scopedFindByIdOrThrow throws the no-existence-leak 404 ('Risk analysis not found')", async () => {
      await expect(
        riskScoped.scopedFindByIdOrThrow(riskA1, orgB),
      ).rejects.toMatchObject({ status: 404, message: 'Risk analysis not found' });
    });
  });

  // 5. COEXISTENCE — the findInOrg wall and scopedFind deny INDEPENDENTLY.
  describe('coexistence with the independent findInOrg wall', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFind returns []', async () => {
      await expect(wall.findInOrg(contractB, orgA)).rejects.toBeTruthy();
      await expect(
        riskScoped.scopedFind({ contract_id: contractB }, orgA),
      ).resolves.toEqual([]);
    });

    it('in-org: the WALL returns the contract AND scopedFind returns the rows', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      await expect(
        riskScoped.scopedFind({ contract_id: contractA }, orgA),
      ).resolves.toHaveLength(2);
    });
  });
});
