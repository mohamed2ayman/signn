import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Like the S1 spec, this needs a real Postgres connection (DATABASE_URL set):
// the scoped LIST org filter is a SQL JOIN predicate that only real
// cross-tenant fixtures can prove. CI is unit-test ONLY (CLAUDE.md); a silent
// skip would read green without proving the S2a tenancy gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(scoped-find.s2a.repository.spec.ts): DATABASE_URL unset — these MUST ' +
      'run in an environment with Postgres (dev/staging). CI green here does ' +
      'NOT prove the Option B S2a scopedFind tenancy gate is verified.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { ContractVersionScopedRepository } from '../contract-version-scoped.repository';
import { ContractApproverScopedRepository } from '../contract-approver-scoped.repository';
import { ContractorResponseScopedRepository } from '../contractor-response-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — S2a: REAL-POSTGRES proof of scopedFind (the new scoped LIST
 * method) and the first CLEAN child subclasses, against a live schema.
 *
 * Two orgs, each `org → user → project → contract`, plus child rows
 * (versions, approver, contractor-response) per contract. The probes prove:
 *   1. scopedFind TENANCY (led) — a child LIST under orgA returns only orgA's
 *      rows; an orgB caller gets NONE of orgA's rows, resolved through the
 *      canonical child→contract→project→org join (denormalized columns ignored).
 *   2. STRUCTURAL org-safety — there is no way to pass an arbitrary org; a
 *      `filter` predicate (on the child alias) can never widen or change the
 *      org gate. Mirrors S1's override probe, for the list method.
 *   3. Child scopedFindById + child override resolve canonically and safely.
 *   4. The base method works across MULTIPLE subclasses (version, approver,
 *      contractor-response).
 *   5. COEXISTENCE — the wall (findInOrg) and scopedFind deny cross-tenant
 *      INDEPENDENTLY.
 */
describeReal('Option B S2a — scopedFind + clean child scoped repos (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let versionScoped: ContractVersionScopedRepository;
  let approverScoped: ContractApproverScopedRepository;
  let responseScoped: ContractorResponseScopedRepository;
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
  const partyA = randomUUID();
  const partyB = randomUUID();
  // children of contractA (orgA)
  const versionA1 = randomUUID();
  const versionA2 = randomUUID(); // milestone
  const approverA = randomUUID();
  const responseA = randomUUID();
  // children of contractB (orgB)
  const versionB1 = randomUUID();
  const approverB = randomUUID();
  const responseB = randomUUID();

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
    versionScoped = moduleRef.get(ContractVersionScopedRepository);
    approverScoped = moduleRef.get(ContractApproverScopedRepository);
    responseScoped = moduleRef.get(ContractorResponseScopedRepository);
    wall = moduleRef.get(ContractAccessService);

    const seedOrg = async (
      orgId: string,
      userId: string,
      projectId: string,
      contractId: string,
      partyId: string,
      tag: string,
    ) => {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
        orgId,
        `s2a-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'S2a', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `s2a-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.s2a.repo.test.xy',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `s2a-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `s2a-contract-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO project_parties (id, owner_organization_id, name, email)
         VALUES ($1, $2, $3, $4)`,
        [partyId, orgId, `s2a-party-${tag}`, `s2a-party-${tag}@test.local`],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, partyA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, partyB, 'b');

    // Child rows. Versions: orgA has 2 (v1 normal, v2 milestone); orgB has 1.
    const seedVersion = async (id: string, contractId: string, num: number, milestone: boolean) =>
      dataSource.query(
        `INSERT INTO contract_versions (id, contract_id, version_number, snapshot, is_milestone)
         VALUES ($1, $2, $3, '{}'::jsonb, $4)`,
        [id, contractId, num, milestone],
      );
    await seedVersion(versionA1, contractA, 1, false);
    await seedVersion(versionA2, contractA, 2, true);
    await seedVersion(versionB1, contractB, 1, false);

    const seedApprover = async (id: string, contractId: string, userId: string) =>
      dataSource.query(
        `INSERT INTO contract_approvers (id, contract_id, user_id) VALUES ($1, $2, $3)`,
        [id, contractId, userId],
      );
    await seedApprover(approverA, contractA, userA);
    await seedApprover(approverB, contractB, userB);

    const seedResponse = async (id: string, contractId: string, partyId: string) =>
      dataSource.query(
        `INSERT INTO contractor_responses (id, contract_id, party_id) VALUES ($1, $2, $3)`,
        [id, contractId, partyId],
      );
    await seedResponse(responseA, contractA, partyA);
    await seedResponse(responseB, contractB, partyB);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM contract_versions WHERE id IN ($1,$2,$3)`, [versionA1, versionA2, versionB1]);
    await dataSource.query(`DELETE FROM contract_approvers WHERE id IN ($1,$2)`, [approverA, approverB]);
    await dataSource.query(`DELETE FROM contractor_responses WHERE id IN ($1,$2)`, [responseA, responseB]);
    await dataSource.query(`DELETE FROM project_parties WHERE id IN ($1,$2)`, [partyA, partyB]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 1. scopedFind TENANCY — the lead. Child LIST is org-scoped via the
  //    canonical child→contract→project→org join.
  // ───────────────────────────────────────────────────────────────────────
  describe('scopedFind tenancy (canonical child→contract→org)', () => {
    it('in-org: orgA lists ONLY orgA versions for its contract', async () => {
      const rows = await versionScoped.scopedFind({ contract_id: contractA }, orgA);
      const ids = rows.map((r) => r.id).sort();
      expect(ids).toEqual([versionA1, versionA2].sort());
    });

    it('cross-org: orgB caller gets NONE of orgA versions — even filtering on orgA contract', async () => {
      // The org gate dominates the contract_id filter: orgB cannot read orgA's
      // contract's versions, period.
      const rows = await versionScoped.scopedFind({ contract_id: contractA }, orgB);
      expect(rows).toEqual([]);
    });

    it('broad list is org-scoped: orgA list contains orgA rows but NEVER orgB rows', async () => {
      const rows = await versionScoped.scopedFind({}, orgA);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([versionA1, versionA2]));
      expect(ids).not.toContain(versionB1);
    });

    it('filter narrows: is_milestone:true under orgA returns only the milestone version', async () => {
      const rows = await versionScoped.scopedFind(
        { contract_id: contractA, is_milestone: true },
        orgA,
      );
      expect(rows.map((r) => r.id)).toEqual([versionA2]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. STRUCTURAL org-safety — no way to pass an arbitrary org; a filter
  //    predicate can never widen the org gate. (List analog of S1's override.)
  // ───────────────────────────────────────────────────────────────────────
  describe('structural org-safety on scopedFind', () => {
    it('a filter pointing at a FOREIGN contract cannot widen the org → empty', async () => {
      // orgA caller filters by orgB's contract_id. The filter predicate is on
      // the child alias; the `project.organization_id = :orgA` gate still
      // excludes every orgB row. The caller cannot reach org B.
      const rows = await versionScoped.scopedFind({ contract_id: contractB }, orgA);
      expect(rows).toEqual([]);
    });

    it('the org argument governs: same foreign filter UNDER orgB returns orgB rows', async () => {
      // Sanity that the gate is not a blanket deny — orgB caller, orgB contract.
      const rows = await versionScoped.scopedFind({ contract_id: contractB }, orgB);
      expect(rows.map((r) => r.id)).toEqual([versionB1]);
    });

    it('relations + order are drop-in faithful (leftJoin never drops rows; ordered)', async () => {
      const rows = await versionScoped.scopedFind(
        { contract_id: contractA },
        orgA,
        { relations: ['creator', 'triggered_by_user'], order: { version_number: 'DESC' } },
      );
      // Order honored (DESC), and the nullable relation join did not drop rows.
      expect(rows.map((r) => r.version_number)).toEqual([2, 1]);
      expect(rows).toHaveLength(2);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. Child by-id + child override (first real CHILD override usage).
  // ───────────────────────────────────────────────────────────────────────
  describe('child scopedFindById + override', () => {
    it('in-org: scopedFindById resolves the version via its own parent contract→org', async () => {
      const row = await versionScoped.scopedFindById(versionA1, orgA);
      expect(row?.id).toBe(versionA1);
    });

    it('cross-org: scopedFindById returns null (canonical resolution denies)', async () => {
      const row = await versionScoped.scopedFindById(versionA1, orgB);
      expect(row).toBeNull();
    });

    it('CORRECT child override: pinning the version OWN parent contract resolves the row', async () => {
      const row = await versionScoped.scopedFindByIdViaContract(versionA1, orgA, {
        contractIdOverride: contractA,
      });
      expect(row?.id).toBe(versionA1);
    });

    it('SAFETY: a mismatched override (foreign parent contract) cannot widen → null', async () => {
      const row = await versionScoped.scopedFindByIdViaContract(versionA1, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });

    it('SAFETY: cross-org child + override toward orgB still denied for an orgA caller', async () => {
      const row = await versionScoped.scopedFindByIdViaContract(versionB1, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. The base method works across MULTIPLE subclasses.
  // ───────────────────────────────────────────────────────────────────────
  describe('scopedFind across multiple clean child subclasses', () => {
    it('ContractApprover: in-org returns, cross-org empty', async () => {
      await expect(
        approverScoped.scopedFind({ contract_id: contractA }, orgA),
      ).resolves.toEqual([expect.objectContaining({ id: approverA })]);
      await expect(
        approverScoped.scopedFind({ contract_id: contractA }, orgB),
      ).resolves.toEqual([]);
    });

    it('ContractorResponse: in-org returns, cross-org empty', async () => {
      await expect(
        responseScoped.scopedFind({ contract_id: contractA }, orgA),
      ).resolves.toEqual([expect.objectContaining({ id: responseA })]);
      await expect(
        responseScoped.scopedFind({ contract_id: contractA }, orgB),
      ).resolves.toEqual([]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 5. COEXISTENCE — the wall and scopedFind deny cross-tenant INDEPENDENTLY.
  // ───────────────────────────────────────────────────────────────────────
  describe('coexistence with the independent findInOrg wall', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFind returns []', async () => {
      await expect(wall.findInOrg(contractB, orgA)).rejects.toBeTruthy();
      await expect(
        versionScoped.scopedFind({ contract_id: contractB }, orgA),
      ).resolves.toEqual([]);
    });

    it('in-org: the WALL returns the contract AND scopedFind returns the rows', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      await expect(
        versionScoped.scopedFind({ contract_id: contractA }, orgA),
      ).resolves.toHaveLength(2);
    });
  });
});
