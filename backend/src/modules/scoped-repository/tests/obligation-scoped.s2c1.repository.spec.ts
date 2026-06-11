import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Like the S1/S2a specs, this needs a real Postgres connection (DATABASE_URL
// set): the scoped org filter is a SQL JOIN predicate that only real
// cross-tenant fixtures can prove — and the gate-alias / relation-hydration
// coexistence ('contract' relation vs the org-gate join) only manifests at
// real SQL build/run time. CI is unit-test ONLY (CLAUDE.md); a silent skip
// would read green without proving the S2c-1 tenancy gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(obligation-scoped.s2c1.repository.spec.ts): DATABASE_URL unset — ' +
      'these MUST run in an environment with Postgres (dev/staging). CI ' +
      'green here does NOT prove the Option B S2c-1 Obligation tenancy gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { ObligationScopedRepository } from '../obligation-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — S2c-1: REAL-POSTGRES proof of the Obligation scoped repository
 * FOUNDATION against a live schema.
 *
 * Two orgs, each `org → user → project → contract → obligations`. The probes
 * prove:
 *   1. scopedFind TENANCY — an obligation LIST under orgA returns only orgA's
 *      rows; an orgB caller gets NONE of orgA's rows, resolved through the
 *      canonical obligation→contract→project→org join.
 *   2. CANONICAL-ONLY (Q1) — the denormalized `obligation.project_id` is
 *      IGNORED: an orgA obligation whose project_id maliciously/erroneously
 *      points at orgB's project still resolves to orgA via the contract FK,
 *      and never to orgB.
 *   3. RELATION HYDRATION coexists with the org gate — `relations:
 *      ['contract']` (exactly what the icalForContract wire requests)
 *      hydrates `obligation.contract` without colliding with the gate join.
 *   4. By-id foundation + override safety (no by-id caller is wired in
 *      S2c-1; the shape is established for S2c-2).
 *   5. COEXISTENCE — the #60 wall (findInOrg) and scopedFind deny
 *      cross-tenant INDEPENDENTLY (two checks, two layers).
 */
describeReal('Option B S2c-1 — Obligation scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let obligationScoped: ObligationScopedRepository;
  let wall: ContractAccessService;

  // Fixture refs.
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // belongs to orgA
  const contractB = randomUUID(); // belongs to orgB
  // obligations of contractA (orgA). obligationA2 carries a WRONG denormalized
  // project_id (orgB's project) — the canonical-only probe.
  const obligationA1 = randomUUID();
  const obligationA2 = randomUUID();
  // obligation of contractB (orgB)
  const obligationB1 = randomUUID();

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
    obligationScoped = moduleRef.get(ObligationScopedRepository);
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
        `s2c1-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'S2c1', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `s2c1-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.s2c1.repo.test.x',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `s2c1-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `s2c1-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');

    const seedObligation = async (
      id: string,
      contractId: string,
      projectId: string | null,
      desc: string,
    ) =>
      dataSource.query(
        `INSERT INTO obligations (id, contract_id, project_id, description)
         VALUES ($1, $2, $3, $4)`,
        [id, contractId, projectId, desc],
      );

    await seedObligation(obligationA1, contractA, projectA, 's2c1 obligation A1');
    // CANONICAL-ONLY PROBE — denormalized project_id points at ORG B's
    // project, but the contract FK (the tenancy truth) is orgA's contract.
    await seedObligation(obligationA2, contractA, projectB, 's2c1 obligation A2 (drifted project_id)');
    await seedObligation(obligationB1, contractB, projectB, 's2c1 obligation B1');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM obligations WHERE id IN ($1,$2,$3)`, [
      obligationA1,
      obligationA2,
      obligationB1,
    ]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 1. scopedFind TENANCY — the lead probe.
  // ───────────────────────────────────────────────────────────────────────
  describe('scopedFind tenancy (canonical obligation→contract→org)', () => {
    it('in-org: orgA lists ONLY orgA obligations for its contract', async () => {
      const rows = await obligationScoped.scopedFind({ contract_id: contractA }, orgA);
      const ids = rows.map((r) => r.id).sort();
      expect(ids).toEqual([obligationA1, obligationA2].sort());
    });

    it('cross-org: orgB caller gets NONE of orgA obligations — even filtering on orgA contract', async () => {
      const rows = await obligationScoped.scopedFind({ contract_id: contractA }, orgB);
      expect(rows).toEqual([]);
    });

    it('foreign-contract filter cannot widen: orgA caller filtering orgB contract → empty', async () => {
      const rows = await obligationScoped.scopedFind({ contract_id: contractB }, orgA);
      expect(rows).toEqual([]);
    });

    it('broad list is org-scoped: orgA list contains orgA rows but NEVER orgB rows', async () => {
      const rows = await obligationScoped.scopedFind({}, orgA);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([obligationA1, obligationA2]));
      expect(ids).not.toContain(obligationB1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. CANONICAL-ONLY (Q1) — the denormalized project_id is IGNORED.
  // ───────────────────────────────────────────────────────────────────────
  describe('canonical-only resolution — denormalized project_id never consulted', () => {
    it('an orgA obligation with a DRIFTED project_id (orgB project) still resolves to orgA', async () => {
      const rows = await obligationScoped.scopedFind({ contract_id: contractA }, orgA);
      expect(rows.map((r) => r.id)).toContain(obligationA2);
    });

    it('the drifted project_id does NOT leak the obligation into orgB', async () => {
      const rows = await obligationScoped.scopedFind({}, orgB);
      expect(rows.map((r) => r.id)).not.toContain(obligationA2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. RELATION HYDRATION — the exact shape the icalForContract wire uses.
  //    Proves the gate-alias choice: `relations: ['contract']` must coexist
  //    with the org-gate join (no duplicate-alias breakage).
  // ───────────────────────────────────────────────────────────────────────
  describe("relations: ['contract'] — gate join and hydration coexist", () => {
    it('hydrates obligation.contract for in-org rows', async () => {
      const rows = await obligationScoped.scopedFind(
        { contract_id: contractA },
        orgA,
        { relations: ['contract'], order: { due_date: 'ASC' } },
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.contract).toBeDefined();
        expect(row.contract.id).toBe(contractA);
        expect(row.contract.name).toBe('s2c1-contract-a');
      }
    });

    it('cross-org with relations is still empty (gate unaffected by hydration)', async () => {
      const rows = await obligationScoped.scopedFind(
        { contract_id: contractA },
        orgB,
        { relations: ['contract'] },
      );
      expect(rows).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. By-id FOUNDATION + override safety (wired in S2c-2; established now).
  // ───────────────────────────────────────────────────────────────────────
  describe('by-id foundation + override safety', () => {
    it('in-org: scopedFindById resolves the obligation via its parent contract→org', async () => {
      const row = await obligationScoped.scopedFindById(obligationA1, orgA);
      expect(row?.id).toBe(obligationA1);
    });

    it('cross-org: scopedFindById returns null (no existence leak — caller maps to 404)', async () => {
      const row = await obligationScoped.scopedFindById(obligationA1, orgB);
      expect(row).toBeNull();
    });

    it('override pins the parent contract; a mismatched override cannot widen → null', async () => {
      const ok = await obligationScoped.scopedFindByIdViaContract(obligationA1, orgA, {
        contractIdOverride: contractA,
      });
      expect(ok?.id).toBe(obligationA1);

      const mismatched = await obligationScoped.scopedFindByIdViaContract(obligationA1, orgA, {
        contractIdOverride: contractB,
      });
      expect(mismatched).toBeNull();
    });

    it('SAFETY: cross-org by-id + override toward orgB still denied for an orgA caller', async () => {
      const row = await obligationScoped.scopedFindByIdViaContract(obligationB1, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 5. COEXISTENCE — the #60 wall and scopedFind deny INDEPENDENTLY.
  // ───────────────────────────────────────────────────────────────────────
  describe('coexistence with the independent findInOrg wall (#60)', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFind returns []', async () => {
      await expect(wall.findInOrg(contractB, orgA)).rejects.toBeTruthy();
      await expect(
        obligationScoped.scopedFind({ contract_id: contractB }, orgA),
      ).resolves.toEqual([]);
    });

    it('in-org: the WALL returns the contract AND scopedFind returns the rows', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      await expect(
        obligationScoped.scopedFind({ contract_id: contractA }, orgA),
      ).resolves.toHaveLength(2);
    });
  });
});
