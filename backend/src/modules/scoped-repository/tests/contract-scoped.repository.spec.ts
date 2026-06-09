import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// This spec needs a real Postgres connection (DATABASE_URL set). The scoped
// repository's org filter is a SQL JOIN predicate — it can only be proven by
// running it against a real schema with real cross-tenant fixtures. CI is
// unit-test ONLY (CLAUDE.md), so this guard skips the suite when DATABASE_URL
// is unset. The skip is LOUD: a silent describe.skip would let a misconfigured
// environment drop these tests invisibly and read green.
//
// data-source.ts throws at module load if DATABASE_URL is unset, so it is
// lazy-required inside beforeAll (a top-level import would explode in CI).
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(contract-scoped.repository.spec.ts): DATABASE_URL unset — these MUST ' +
      'run in an environment with Postgres (dev/staging). CI green here does ' +
      'NOT prove the Option B tenancy gate is verified.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { ContractScopedRepository } from '../contract-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — S1: REAL-POSTGRES proof of the scoped-repository base class,
 * wired through the Contract ROOT.
 *
 * Two orgs, each with a contract. The probes prove, against a live schema:
 *   1. OVERRIDE-SAFETY (led, the critical one) — the manual parent-contract
 *      override resolves correctly AND can never reach another org; the
 *      caller's orgId always governs.
 *   2. scopedFindById is binding — in-org returns the row, cross-org returns
 *      null (and *OrThrow → 404, no existence leak).
 *   3. COEXISTENCE — the wall (findInOrg) and the scoped repo both deny
 *      cross-tenant INDEPENDENTLY; both layers present, neither removed.
 *   4. findAcrossAllOrgs returns cross-org rows — the deliberate bypass works.
 *
 * Fixtures are raw-SQL seeded (independent of entity hooks/defaults) and
 * scoped to test-tagged ids so cleanup is targeted on a shared dev DB.
 */
describeReal('ContractScopedRepository (real Postgres — Option B S1 tenancy gate)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let scoped: ContractScopedRepository;
  let wall: ContractAccessService;

  // Fixture refs (set in beforeAll).
  let orgA: string;
  let orgB: string;
  let userA: string;
  let userB: string;
  let projectA: string;
  let projectB: string;
  let contractA: string; // belongs to orgA
  let contractB: string; // belongs to orgB

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        // The module under test — proves its DI wiring resolves against real PG.
        ScopedRepositoryModule,
        // For the independent wall (ContractAccessService) used in coexistence.
        TypeOrmModule.forFeature([Contract, GuestContractAccess]),
      ],
      providers: [ContractAccessService],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    scoped = moduleRef.get(ContractScopedRepository);
    wall = moduleRef.get(ContractAccessService);

    orgA = randomUUID();
    orgB = randomUUID();
    userA = randomUUID();
    userB = randomUUID();
    projectA = randomUUID();
    projectB = randomUUID();
    contractA = randomUUID();
    contractB = randomUUID();

    const seedOrg = async (orgId: string, userId: string, projectId: string, contractId: string, tag: string) => {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
        orgId,
        `scoped-repo-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'Scoped', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `scoped-repo-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.scoped.repo.test.x',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `scoped-repo-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `scoped-repo-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');
  });

  afterAll(async () => {
    // FK-safe teardown.
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1, $2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1, $2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. OVERRIDE-SAFETY PROBE — the critical one. Lead with it.
  //
  // The manual parent-contract override (Ayman B spec item 1) may help resolve
  // a parent contract, but it must NEVER let a caller reach another org. The
  // caller's orgId always governs; the override can only NARROW.
  // ─────────────────────────────────────────────────────────────────────────
  describe('override-safety (the critical probe)', () => {
    it('CORRECT override: orgA caller pinning orgA contract resolves the row', async () => {
      const row = await scoped.scopedFindByIdViaContract(contractA, orgA, {
        contractIdOverride: contractA,
      });
      expect(row?.id).toBe(contractA);
    });

    it('SAFETY: orgA caller CANNOT reach orgB by overriding toward orgB contract → null', async () => {
      // Attacker shape: caller is org A; tries to load org B's contract and
      // pins the override at org B's contract too. The org filter is still
      // :orgA, so the row's project.organization_id (org B) excludes it.
      const row = await scoped.scopedFindByIdViaContract(contractB, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });

    it('SAFETY: a mismatched override (orgA id + orgB override) cannot widen the org → null', async () => {
      // Even if the entity id is an in-org contract, an override pointing at a
      // foreign contract resolves nothing — the override never changes the org.
      const row = await scoped.scopedFindByIdViaContract(contractA, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });

    it("SAFETY: the orgId argument governs — org B's own override still can't pull an orgA contract for an orgB caller across the boundary", async () => {
      // orgB caller, orgB contract, orgB override → resolves (sanity: the gate
      // is not a blanket deny). Then orgB caller pinning orgA contract → null.
      await expect(
        scoped.scopedFindByIdViaContract(contractB, orgB, { contractIdOverride: contractB }),
      ).resolves.toMatchObject({ id: contractB });
      await expect(
        scoped.scopedFindByIdViaContract(contractA, orgB, { contractIdOverride: contractA }),
      ).resolves.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. scopedFindById is binding.
  // ─────────────────────────────────────────────────────────────────────────
  describe('scopedFindById', () => {
    it('in-org: returns the org-A contract for orgA', async () => {
      const row = await scoped.scopedFindById(contractA, orgA);
      expect(row?.id).toBe(contractA);
    });

    it('cross-org: returns null for an org-B contract requested under orgA', async () => {
      const row = await scoped.scopedFindById(contractB, orgA);
      expect(row).toBeNull();
    });

    it('cross-org *OrThrow: throws NotFoundException (404, no existence leak)', async () => {
      await expect(scoped.scopedFindByIdOrThrow(contractB, orgA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('in-org *OrThrow: returns the row', async () => {
      await expect(scoped.scopedFindByIdOrThrow(contractA, orgA)).resolves.toMatchObject({
        id: contractA,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. COEXISTENCE — the wall and the scoped repo deny cross-tenant
  //    INDEPENDENTLY. Both layers present; neither removed.
  // ─────────────────────────────────────────────────────────────────────────
  describe('coexistence with the independent findInOrg wall', () => {
    it('cross-tenant: the WALL (findInOrg) 404s AND the scoped repo returns null', async () => {
      // Wall (persona) — throws.
      await expect(wall.findInOrg(contractB, orgA)).rejects.toBeInstanceOf(NotFoundException);
      // Scoped repo (tenancy) — null, independently.
      await expect(scoped.scopedFindById(contractB, orgA)).resolves.toBeNull();
    });

    it('in-org: the WALL returns the contract AND the scoped repo returns the contract', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      await expect(scoped.scopedFindById(contractA, orgA)).resolves.toMatchObject({
        id: contractA,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. findAcrossAllOrgs — the deliberate tenancy bypass.
  // ─────────────────────────────────────────────────────────────────────────
  describe('findAcrossAllOrgs (system bypass)', () => {
    it('returns rows from BOTH orgs (proves it crosses the tenancy boundary)', async () => {
      const all = await scoped.findAcrossAllOrgs();
      const ids = all.map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining([contractA, contractB]));
    });
  });
});
