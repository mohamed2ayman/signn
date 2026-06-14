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
      '(claim-scoped.s2e.repository.spec.ts): DATABASE_URL unset — these MUST ' +
      'run in an environment with Postgres (dev/staging). CI green here does ' +
      'NOT prove the Option B S2e Claim tenancy gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { ClaimScopedRepository } from '../claim-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — S2e: REAL-POSTGRES proof of the Claim scoped repository.
 *
 * Two orgs, each `org → user → project → contract → claims`. Same five probe
 * groups as the Notice spec: scopedFind tenancy, canonical-only (the
 * denormalized claim.org_id is IGNORED), relation hydration coexisting with the
 * gate, by-id OrThrow 404 shape, and independent coexistence with the #57 wall.
 */
describeReal('Option B S2e — Claim scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let claimScoped: ClaimScopedRepository;
  let wall: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID();
  const contractB = randomUUID();
  const claimA1 = randomUUID();
  const claimA2 = randomUUID(); // DRIFTED org_id (orgB)
  const claimB1 = randomUUID();

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
    claimScoped = moduleRef.get(ClaimScopedRepository);
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
        `s2e-clm-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'S2eC', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `s2e-clm-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.s2e.repo.test.xx',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `s2e-clm-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `s2e-clm-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');

    const seedClaim = async (
      id: string,
      contractId: string,
      orgIdDenorm: string,
      submittedBy: string,
      ref: string,
    ) =>
      dataSource.query(
        `INSERT INTO claims
           (id, contract_id, org_id, submitted_by, claim_reference, claim_type,
            title, description, event_date)
         VALUES ($1, $2, $3, $4, $5, 'COST', 'S2e claim', 'desc', '2026-01-01')`,
        [id, contractId, orgIdDenorm, submittedBy, ref],
      );

    await seedClaim(claimA1, contractA, orgA, userA, 'CLM-001');
    // CANONICAL-ONLY PROBE — denormalized org_id points at ORG B; contract FK is orgA.
    await seedClaim(claimA2, contractA, orgB, userA, 'CLM-002');
    await seedClaim(claimB1, contractB, orgB, userB, 'CLM-001');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM claims WHERE id IN ($1,$2,$3)`, [claimA1, claimA2, claimB1]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  describe('scopedFind tenancy (canonical claim→contract→org)', () => {
    it('in-org: orgA lists ONLY orgA claims for its contract', async () => {
      const rows = await claimScoped.scopedFind({ contract_id: contractA }, orgA);
      expect(rows.map((r) => r.id).sort()).toEqual([claimA1, claimA2].sort());
    });

    it('cross-org: orgB caller gets NONE of orgA claims — even filtering orgA contract', async () => {
      const rows = await claimScoped.scopedFind({ contract_id: contractA }, orgB);
      expect(rows).toEqual([]);
    });

    it('foreign-contract filter cannot widen: orgA filtering orgB contract → empty', async () => {
      const rows = await claimScoped.scopedFind({ contract_id: contractB }, orgA);
      expect(rows).toEqual([]);
    });

    it('broad list is org-scoped: orgA list contains orgA rows but NEVER orgB rows', async () => {
      const rows = await claimScoped.scopedFind({}, orgA);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([claimA1, claimA2]));
      expect(ids).not.toContain(claimB1);
    });
  });

  describe('canonical-only resolution — denormalized org_id never consulted', () => {
    it('an orgA claim with a DRIFTED org_id (orgB) still resolves to orgA', async () => {
      const rows = await claimScoped.scopedFind({ contract_id: contractA }, orgA);
      expect(rows.map((r) => r.id)).toContain(claimA2);
    });

    it('the drifted org_id does NOT leak the claim into orgB', async () => {
      const rows = await claimScoped.scopedFind({}, orgB);
      expect(rows.map((r) => r.id)).not.toContain(claimA2);
    });
  });

  describe("relations: ['submitter','documents'] — gate join and hydration coexist", () => {
    it('hydrates claim.submitter for in-org rows', async () => {
      const rows = await claimScoped.scopedFind(
        { contract_id: contractA },
        orgA,
        { relations: ['submitter', 'documents'], order: { created_at: 'DESC' } },
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.submitter).toBeDefined();
        expect(row.submitter.id).toBe(userA);
      }
    });

    it('cross-org with relations is still empty (gate unaffected by hydration)', async () => {
      const rows = await claimScoped.scopedFind(
        { contract_id: contractA },
        orgB,
        { relations: ['submitter', 'documents'] },
      );
      expect(rows).toEqual([]);
    });
  });

  describe('by-id OrThrow (wired by findById / uploadDocument)', () => {
    it('in-org: scopedFindByIdOrThrow returns the row', async () => {
      const row = await claimScoped.scopedFindByIdOrThrow(claimA1, orgA);
      expect(row.id).toBe(claimA1);
    });

    it("cross-org: scopedFindByIdOrThrow throws the no-existence-leak 404 ('Claim not found')", async () => {
      await expect(
        claimScoped.scopedFindByIdOrThrow(claimA1, orgB),
      ).rejects.toMatchObject({ status: 404, message: 'Claim not found' });
    });

    it('cross-org by-id with a DRIFTED org_id row still denied (canonical-only)', async () => {
      await expect(
        claimScoped.scopedFindByIdOrThrow(claimA2, orgB),
      ).rejects.toMatchObject({ status: 404 });
      const row = await claimScoped.scopedFindByIdOrThrow(claimA2, orgA);
      expect(row.id).toBe(claimA2);
    });
  });

  describe('coexistence with the independent findInOrg wall (#57)', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFind returns []', async () => {
      await expect(wall.findInOrg(contractB, orgA)).rejects.toBeTruthy();
      await expect(
        claimScoped.scopedFind({ contract_id: contractB }, orgA),
      ).resolves.toEqual([]);
    });

    it('in-org: the WALL returns the contract AND scopedFind returns the rows', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      await expect(
        claimScoped.scopedFind({ contract_id: contractA }, orgA),
      ).resolves.toHaveLength(2);
    });
  });
});
