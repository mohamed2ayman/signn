import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Like the S1/S2a-S2f + negotiation scoped specs, this needs a real Postgres
// connection (DATABASE_URL set): the scoped org filter is a SQL JOIN predicate
// that only real cross-tenant fixtures can prove. CI is unit-test ONLY
// (CLAUDE.md); a silent skip would read green without proving the guest-portal
// tenancy gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(guest-invitation-scoped.repository.spec.ts): DATABASE_URL unset — ' +
      'these MUST run in an environment with Postgres (dev/staging). CI green ' +
      'here does NOT prove the Option B guest-portal tenancy gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { GuestInvitationScopedRepository } from '../guest-invitation-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — Chokepoint migration (guest-portal, 2 of 4): REAL-POSTGRES proof of
 * the GuestInvitation scoped repository against a live schema.
 *
 * Two orgs, each `org → user → project → contract → guest_invitations`. The
 * probes prove (BY-ID is the primary path — the wired GuestInvitationService.revoke
 * read is a by-id load):
 *   1. by-id TENANCY — scopedFindById under orgA returns orgA's invitation;
 *      under orgB it returns null (no existence leak), resolved through the
 *      canonical invitation→contract→project→org join.
 *   2. by-id OrThrow — the no-existence-leak 404 ('Invitation not found') on a
 *      cross-org probe (the exact shape revoke surfaces).
 *   3. OVERRIDE SAFETY — the contractIdOverride only NARROWS to a parent contract;
 *      it can never widen or change the caller's org (orgA passing orgB's contract
 *      as override → null; orgB passing the correct contract → still null).
 *   4. LIST gate (faithful base) — scopedFind({}, org) is org-bounded: orgA's list
 *      contains orgA invitations and NEVER orgB's, even though no list CALLER is
 *      wired (the empty-allowlist enforcement is proven in the allowlist spec).
 *   5. COEXISTENCE — the independent wall (findInOrg, the generic primitive that
 *      enforces the SAME gate as revoke's inline findInOrg) and the scoped path
 *      deny cross-tenant INDEPENDENTLY.
 *
 * NO DRIFT PROBE: like NegotiationEvent / RiskAnalysis, GuestInvitation carries
 * NO denormalized org column — there is no drift surface to test. The
 * `contract_id` FK is the sole tenancy truth and the canonical join is the only
 * resolution path.
 *
 * RED FORM (stated): pre-wire, revoke's bare `invitationRepo.findOne({ where:
 * { id } })` applied NO org filter — with the wall neutralized (a wall bug /
 * bypass), a cross-org invitation id would load and be revoked (a cross-org
 * write). Post-wire, scopedFindByIdOrThrow denies it with the no-existence-leak
 * 404 at the data layer, INDEPENDENTLY of the wall — probe #2 below.
 */
describeReal('Option B chokepoint — GuestInvitation scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let invitationScoped: GuestInvitationScopedRepository;
  let wall: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // belongs to orgA
  const contractB = randomUUID(); // belongs to orgB
  // 2 invitations on contractA (orgA), 1 on contractB (orgB).
  const inviteA1 = randomUUID();
  const inviteA2 = randomUUID();
  const inviteB1 = randomUUID();

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
    invitationScoped = moduleRef.get(GuestInvitationScopedRepository);
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
        `gi-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'Guest', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `gi-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.gi.repo.test.xx',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `gi-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `gi-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');

    const seedInvite = async (
      id: string,
      contractId: string,
      createdBy: string,
      email: string,
    ) =>
      dataSource.query(
        `INSERT INTO guest_invitations
           (id, contract_id, invited_email, invited_language, status, expires_at, created_by)
         VALUES ($1, $2, $3, 'en', 'PENDING', NOW() + INTERVAL '30 days', $4)`,
        [id, contractId, email, createdBy],
      );

    await seedInvite(inviteA1, contractA, userA, 'a1@guest.test');
    await seedInvite(inviteA2, contractA, userA, 'a2@guest.test');
    await seedInvite(inviteB1, contractB, userB, 'b1@guest.test');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM guest_invitations WHERE id IN ($1,$2,$3)`, [
      inviteA1,
      inviteA2,
      inviteB1,
    ]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // 1. by-id TENANCY — the lead probe (the wired revoke path is a by-id load).
  describe('by-id tenancy (canonical invitation→contract→org)', () => {
    it('in-org: scopedFindById returns the orgA invitation', async () => {
      const row = await invitationScoped.scopedFindById(inviteA1, orgA);
      expect(row?.id).toBe(inviteA1);
      expect(row?.contract_id).toBe(contractA);
    });

    it('cross-org: scopedFindById returns null (no existence leak)', async () => {
      const row = await invitationScoped.scopedFindById(inviteA1, orgB);
      expect(row).toBeNull();
    });
  });

  // 2. by-id OrThrow — the EXACT shape revoke surfaces (the no-leak 404).
  describe('by-id OrThrow (no-existence-leak 404 — the wired revoke read)', () => {
    it('in-org: scopedFindByIdOrThrow returns the row', async () => {
      const row = await invitationScoped.scopedFindByIdOrThrow(inviteA1, orgA);
      expect(row.id).toBe(inviteA1);
    });

    it("cross-org: scopedFindByIdOrThrow throws 404 'Invitation not found' (RED→GREEN: data-layer denial)", async () => {
      await expect(
        invitationScoped.scopedFindByIdOrThrow(inviteA1, orgB),
      ).rejects.toMatchObject({ status: 404, message: 'Invitation not found' });
    });
  });

  // 3. OVERRIDE SAFETY — the override only NARROWS; never widens the org.
  describe('contractIdOverride safety (narrows to a parent contract; never widens the org)', () => {
    it('in-org + correct contract override → returns the row', async () => {
      const row = await invitationScoped.scopedFindByIdViaContract(inviteA1, orgA, {
        contractIdOverride: contractA,
      });
      expect(row?.id).toBe(inviteA1);
    });

    it('in-org + FOREIGN contract override → null (override cannot widen to orgB rows)', async () => {
      const row = await invitationScoped.scopedFindByIdViaContract(inviteA1, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });

    it('cross-org caller + the row’s own (foreign) contract as override → still null (org gate wins)', async () => {
      const row = await invitationScoped.scopedFindByIdViaContract(inviteA1, orgB, {
        contractIdOverride: contractA,
      });
      expect(row).toBeNull();
    });
  });

  // 4. LIST gate (faithful base) — scopedFind({}) is org-bounded even with an
  //    EMPTY allowlist (the org gate lives in buildScopedListQuery, independent
  //    of filter keys; the empty-allowlist enforcement is in the allowlist spec).
  describe('scopedFind({}) list gate (faithful base; org-scoped)', () => {
    it('orgA list contains orgA invitations and NEVER orgB invitations', async () => {
      const rows = await invitationScoped.scopedFind({}, orgA);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([inviteA1, inviteA2]));
      expect(ids).not.toContain(inviteB1);
    });

    it('orgB list contains orgB invitation and NEVER orgA invitations', async () => {
      const rows = await invitationScoped.scopedFind({}, orgB);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(inviteB1);
      expect(ids).not.toContain(inviteA1);
      expect(ids).not.toContain(inviteA2);
    });
  });

  // 5. COEXISTENCE — the wall and the scoped path deny INDEPENDENTLY.
  describe('coexistence with the independent contract-access wall', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFindByIdOrThrow 404s independently', async () => {
      await expect(wall.findInOrg(contractA, orgB)).rejects.toBeTruthy();
      await expect(
        invitationScoped.scopedFindByIdOrThrow(inviteA1, orgB),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('in-org: the WALL returns the contract AND scopedFindByIdOrThrow returns the row', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      const row = await invitationScoped.scopedFindByIdOrThrow(inviteA1, orgA);
      expect(row.id).toBe(inviteA1);
    });
  });
});
