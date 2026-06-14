import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Like the S1/S2a/S2c/S2d specs, this needs a real Postgres connection
// (DATABASE_URL set): the scoped org filter is a SQL JOIN predicate that only
// real cross-tenant fixtures can prove — and the canonical-only resolution
// (ignoring the denormalized notice.org_id) only manifests at real SQL run
// time. CI is unit-test ONLY (CLAUDE.md); a silent skip would read green
// without proving the S2e Notice tenancy gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(notice-scoped.s2e.repository.spec.ts): DATABASE_URL unset — these MUST ' +
      'run in an environment with Postgres (dev/staging). CI green here does ' +
      'NOT prove the Option B S2e Notice tenancy gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { NoticeScopedRepository } from '../notice-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — S2e: REAL-POSTGRES proof of the Notice scoped repository against a
 * live schema.
 *
 * Two orgs, each `org → user → project → contract → notices`. The probes prove:
 *   1. scopedFind TENANCY — a notice LIST under orgA returns only orgA's rows;
 *      an orgB caller gets NONE of orgA's rows, resolved through the canonical
 *      notice→contract→project→org join.
 *   2. CANONICAL-ONLY (Q1) — the denormalized `notice.org_id` is IGNORED: an
 *      orgA notice whose org_id maliciously/erroneously points at orgB still
 *      resolves to orgA via the contract FK, and never to orgB.
 *   3. RELATION HYDRATION coexists with the org gate — `relations: ['submitter']`
 *      (what the findAllByContract wire requests) hydrates without colliding
 *      with the gate join.
 *   4. By-id OrThrow — the exact 404 shape the wired findById relies on.
 *   5. COEXISTENCE — the #57 wall (findInOrg) and scopedFind deny cross-tenant
 *      INDEPENDENTLY (two checks, two layers).
 */
describeReal('Option B S2e — Notice scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let noticeScoped: NoticeScopedRepository;
  let wall: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // belongs to orgA
  const contractB = randomUUID(); // belongs to orgB
  // notices of contractA (orgA). noticeA2 carries a WRONG denormalized org_id
  // (orgB) — the canonical-only probe.
  const noticeA1 = randomUUID();
  const noticeA2 = randomUUID();
  // notice of contractB (orgB)
  const noticeB1 = randomUUID();

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
    noticeScoped = moduleRef.get(NoticeScopedRepository);
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
        `s2e-ntc-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'S2eN', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `s2e-ntc-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.s2e.repo.test.xx',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `s2e-ntc-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `s2e-ntc-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');

    const seedNotice = async (
      id: string,
      contractId: string,
      orgIdDenorm: string,
      submittedBy: string,
      ref: string,
    ) =>
      dataSource.query(
        `INSERT INTO notices
           (id, contract_id, org_id, submitted_by, notice_reference, notice_type,
            title, description, event_date)
         VALUES ($1, $2, $3, $4, $5, 'GENERAL', 'S2e notice', 'desc', '2026-01-01')`,
        [id, contractId, orgIdDenorm, submittedBy, ref],
      );

    await seedNotice(noticeA1, contractA, orgA, userA, 'NTC-001');
    // CANONICAL-ONLY PROBE — denormalized org_id points at ORG B, but the
    // contract FK (the tenancy truth) is orgA's contract.
    await seedNotice(noticeA2, contractA, orgB, userA, 'NTC-002');
    await seedNotice(noticeB1, contractB, orgB, userB, 'NTC-001');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM notices WHERE id IN ($1,$2,$3)`, [
      noticeA1,
      noticeA2,
      noticeB1,
    ]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // 1. scopedFind TENANCY — the lead probe.
  describe('scopedFind tenancy (canonical notice→contract→org)', () => {
    it('in-org: orgA lists ONLY orgA notices for its contract', async () => {
      const rows = await noticeScoped.scopedFind({ contract_id: contractA }, orgA);
      expect(rows.map((r) => r.id).sort()).toEqual([noticeA1, noticeA2].sort());
    });

    it('cross-org: orgB caller gets NONE of orgA notices — even filtering orgA contract', async () => {
      const rows = await noticeScoped.scopedFind({ contract_id: contractA }, orgB);
      expect(rows).toEqual([]);
    });

    it('foreign-contract filter cannot widen: orgA caller filtering orgB contract → empty', async () => {
      const rows = await noticeScoped.scopedFind({ contract_id: contractB }, orgA);
      expect(rows).toEqual([]);
    });

    it('broad list is org-scoped: orgA list contains orgA rows but NEVER orgB rows', async () => {
      const rows = await noticeScoped.scopedFind({}, orgA);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([noticeA1, noticeA2]));
      expect(ids).not.toContain(noticeB1);
    });
  });

  // 2. CANONICAL-ONLY (Q1) — the denormalized org_id is IGNORED.
  describe('canonical-only resolution — denormalized org_id never consulted', () => {
    it('an orgA notice with a DRIFTED org_id (orgB) still resolves to orgA', async () => {
      const rows = await noticeScoped.scopedFind({ contract_id: contractA }, orgA);
      expect(rows.map((r) => r.id)).toContain(noticeA2);
    });

    it('the drifted org_id does NOT leak the notice into orgB', async () => {
      const rows = await noticeScoped.scopedFind({}, orgB);
      expect(rows.map((r) => r.id)).not.toContain(noticeA2);
    });
  });

  // 3. RELATION HYDRATION — the exact shape the findAllByContract wire uses.
  describe("relations: ['submitter'] — gate join and hydration coexist", () => {
    it('hydrates notice.submitter for in-org rows', async () => {
      const rows = await noticeScoped.scopedFind(
        { contract_id: contractA },
        orgA,
        { relations: ['submitter'], order: { created_at: 'DESC' } },
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.submitter).toBeDefined();
        expect(row.submitter.id).toBe(userA);
      }
    });

    it('cross-org with relations is still empty (gate unaffected by hydration)', async () => {
      const rows = await noticeScoped.scopedFind(
        { contract_id: contractA },
        orgB,
        { relations: ['submitter'] },
      );
      expect(rows).toEqual([]);
    });
  });

  // 4. By-id OrThrow — the form the wired findById consumes.
  describe('by-id OrThrow (wired by findById and its mutation inheritors)', () => {
    it('in-org: scopedFindByIdOrThrow returns the row', async () => {
      const row = await noticeScoped.scopedFindByIdOrThrow(noticeA1, orgA);
      expect(row.id).toBe(noticeA1);
    });

    it("cross-org: scopedFindByIdOrThrow throws the no-existence-leak 404 ('Notice not found')", async () => {
      await expect(
        noticeScoped.scopedFindByIdOrThrow(noticeA1, orgB),
      ).rejects.toMatchObject({ status: 404, message: 'Notice not found' });
    });

    it('cross-org by-id with a DRIFTED org_id row still denied (canonical-only)', async () => {
      // noticeA2 lives in orgA (by contract) but its denorm org_id is orgB.
      // An orgB caller must STILL be denied — resolution ignores org_id.
      await expect(
        noticeScoped.scopedFindByIdOrThrow(noticeA2, orgB),
      ).rejects.toMatchObject({ status: 404 });
      // ...and the rightful orgA owner can load it.
      const row = await noticeScoped.scopedFindByIdOrThrow(noticeA2, orgA);
      expect(row.id).toBe(noticeA2);
    });
  });

  // 5. COEXISTENCE — the #57 wall and scopedFind deny INDEPENDENTLY.
  describe('coexistence with the independent findInOrg wall (#57)', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFind returns []', async () => {
      await expect(wall.findInOrg(contractB, orgA)).rejects.toBeTruthy();
      await expect(
        noticeScoped.scopedFind({ contract_id: contractB }, orgA),
      ).resolves.toEqual([]);
    });

    it('in-org: the WALL returns the contract AND scopedFind returns the rows', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      await expect(
        noticeScoped.scopedFind({ contract_id: contractA }, orgA),
      ).resolves.toHaveLength(2);
    });
  });
});
