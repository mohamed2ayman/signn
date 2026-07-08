import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  AccountType,
  GuestInvitation,
  User,
} from '../../../database/entities';
import { AuthService } from '../../auth/auth.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestInvitationScopedRepository } from '../../scoped-repository/guest-invitation-scoped.repository';
import { GuestInvitationService } from '../services/guest-invitation.service';
import { InvitationTokenService } from '../services/invitation-token.service';
import { ViewerCredentialService } from '../services/viewer-credential.service';

/**
 * Slice 0 — graceful real-account collision at establish-identity:
 * REAL-Postgres proof.
 *
 * The bug: when the invited email belongs to an EXISTING non-guest SIGN
 * account (a real customer), the guest-scoped race-guard lookup misses it
 * and establishIdentity attempts to INSERT a duplicate GUEST user with the
 * same email → UQ_users_email → raw QueryFailedError → unhandled 500,
 * permanently, on every retry. The fix detects the collision BEFORE the
 * insert and throws a handled 409 with code EXISTING_ACCOUNT_EMAIL.
 * Detect-and-respond ONLY — no binding, no access, no authz change.
 *
 * Real here: the DataSource (live sign-postgres), the SELECT-FOR-UPDATE
 * transaction in establishIdentity, the HMAC InvitationTokenService +
 * ViewerCredentialService (secrets from the container .env), and the
 * UQ_users_email constraint itself. Stubbed: AuthService.issueGuestSession
 * (session machinery is orthogonal), ContractAccessService + the scoped
 * repository (used by create/revoke, not by the paths under test).
 *
 * CI is unit-test ONLY (CLAUDE.md) — this skips LOUDLY when DATABASE_URL
 * is unset.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-establish-identity] SKIPPING real-Postgres spec ' +
      '(guest-establish-identity-existing-account.real-pg.spec.ts): ' +
      'DATABASE_URL unset — the real-account-collision 409 and the ' +
      'UQ_users_email no-side-effects proof MUST run against Postgres. ' +
      'CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

const VALID_PASSWORD = 'GracefulSlice0@2026';

describeReal(
  'GuestInvitationService.establishIdentity — existing-account collision (real Postgres)',
  () => {
    let moduleRef: TestingModule;
    let dataSource: DataSource;
    let service: GuestInvitationService;
    let tokenService: InvitationTokenService;

    // Fixture refs — deterministic ids for cleanup.
    const orgId = randomUUID();
    const managingUserId = randomUUID();
    const projectId = randomUUID();
    const contractId = randomUUID();
    const invitationManagingId = randomUUID(); // invitation → MANAGING email
    const invitationFreshId = randomUUID(); // invitation → brand-new email
    const MANAGING_EMAIL = `customer-${managingUserId.slice(0, 8)}@managing.test`;
    const FRESH_EMAIL = `newguest-${invitationFreshId.slice(0, 8)}@external.test`;
    const MANAGING_HASH =
      '$2a$10$managing.hash.sentinel.value.never.rewritten.by.slice0x';

    const issueToken = (invitationId: string) =>
      tokenService.issue(
        invitationId,
        new Date(Date.now() + 24 * 3600 * 1000),
      );

    const insertInvitation = async (id: string, email: string) => {
      await dataSource.query(
        `INSERT INTO guest_invitations
           (id, contract_id, invited_email, invited_language, status,
            expires_at, created_by)
         VALUES ($1, $2, $3, 'en', 'PENDING', NOW() + interval '1 day', $4)`,
        [id, contractId, email, managingUserId],
      );
    };

    const userRowsByEmail = async (email: string) =>
      dataSource.query(
        `SELECT id, email, password_hash, role, account_type, organization_id,
                is_active
           FROM users WHERE email = $1`,
        [email],
      );

    const bindingsForContract = async () =>
      dataSource.query(
        `SELECT id, user_id FROM guest_contract_access WHERE contract_id = $1`,
        [contractId],
      );

    beforeAll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { dataSourceOptions } = require('../../../config/data-source');

      moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
          TypeOrmModule.forFeature([GuestInvitation, User]),
        ],
        providers: [
          GuestInvitationService,
          InvitationTokenService,
          ViewerCredentialService,
          {
            provide: AuthService,
            useValue: {
              issueGuestSession: jest.fn(async (user: any) => ({
                user: { id: user.id, email: user.email },
                access_token: 'stub-access',
                refresh_token: 'stub-refresh',
              })),
            },
          },
          { provide: ContractAccessService, useValue: {} },
          { provide: GuestInvitationScopedRepository, useValue: {} },
        ],
      }).compile();

      dataSource = moduleRef.get(DataSource);
      service = moduleRef.get(GuestInvitationService);
      tokenService = moduleRef.get(InvitationTokenService);

      // ─── Fixture tree (raw SQL; deterministic ids for cleanup). ───────
      await dataSource.query(
        `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
        [orgId, `graceful0-org-${orgId.slice(0, 8)}`],
      );
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           organization_id, is_active, is_email_verified, mfa_enabled,
           preferred_language, failed_login_attempts, onboarding_completed,
           onboarding_level, email_digest_opt_out, marketing_email_opt_in,
           ai_training_opt_in
         )
         VALUES ($1, $2, $3, 'Real', 'Customer', 'OWNER_ADMIN', 'MANAGING', $4,
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
        [managingUserId, MANAGING_EMAIL, MANAGING_HASH, orgId],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by)
         VALUES ($1, $2, 'graceful0-project', $3)`,
        [projectId, orgId, managingUserId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, 'Graceful0 Contract', 'FIDIC_RED_BOOK', $3)`,
        [contractId, projectId, managingUserId],
      );
      await insertInvitation(invitationManagingId, MANAGING_EMAIL);
      await insertInvitation(invitationFreshId, FRESH_EMAIL);
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(
          `DELETE FROM guest_contract_access WHERE contract_id = $1`,
          [contractId],
        );
        await dataSource.query(
          `DELETE FROM guest_invitations WHERE id = ANY($1)`,
          [[invitationManagingId, invitationFreshId]],
        );
        await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractId]);
        await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
        await dataSource.query(
          `DELETE FROM users WHERE email = ANY($1)`,
          [[MANAGING_EMAIL, FRESH_EMAIL]],
        );
        await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
      }
      await moduleRef?.close();
    });

    // ⭐ THE GRACEFUL-DETECTION / NO-SIDE-EFFECTS PROOF
    it('existing MANAGING email → handled 409 EXISTING_ACCOUNT_EMAIL; no user row, no binding, real account untouched', async () => {
      const token = issueToken(invitationManagingId);

      let thrown: unknown;
      try {
        await service.establishIdentity({
          token,
          password: VALID_PASSWORD,
        } as any);
      } catch (e) {
        thrown = e;
      }

      // A HANDLED 409 with the specific code — NOT a raw QueryFailedError
      // (the pre-fix behaviour: UQ_users_email violation → unhandled 500).
      expect(thrown).toBeInstanceOf(ConflictException);
      const resp = (thrown as ConflictException).getResponse() as Record<
        string,
        unknown
      >;
      expect((thrown as ConflictException).getStatus()).toBe(409);
      expect(resp.error).toBe('EXISTING_ACCOUNT_EMAIL');
      expect((thrown as any).name).not.toBe('QueryFailedError');

      // NO side effects: still exactly ONE user row for that email, and it
      // is the ORIGINAL MANAGING row — org, hash, type, role all intact.
      const rows = await userRowsByEmail(MANAGING_EMAIL);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(managingUserId);
      expect(rows[0].password_hash).toBe(MANAGING_HASH);
      expect(rows[0].account_type).toBe(AccountType.MANAGING);
      expect(rows[0].role).toBe('OWNER_ADMIN');
      expect(rows[0].organization_id).toBe(orgId);
      expect(rows[0].is_active).toBe(true);

      // NO binding was written.
      expect(await bindingsForContract()).toHaveLength(0);

      // Retrying is stable: the SAME handled 409, never a 500.
      await expect(
        service.establishIdentity({ token, password: VALID_PASSWORD } as any),
      ).rejects.toMatchObject({ status: 409 });
    });

    // ⭐ NO-REGRESSION — the normal paths are untouched by the detection.
    it('brand-new email still establishes guest identity (GUEST user + binding created)', async () => {
      const token = issueToken(invitationFreshId);

      const result = await service.establishIdentity({
        token,
        password: VALID_PASSWORD,
        first_name: 'Fresh',
        last_name: 'Guest',
      } as any);

      expect(result.contract_id).toBe(contractId);
      expect(result.access_token).toBe('stub-access');

      const rows = await userRowsByEmail(FRESH_EMAIL);
      expect(rows).toHaveLength(1);
      expect(rows[0].account_type).toBe(AccountType.GUEST);
      expect(rows[0].organization_id).toBeNull();

      const bindings = await bindingsForContract();
      expect(bindings).toHaveLength(1);
      expect(bindings[0].user_id).toBe(rows[0].id);
    });

    it('existing GUEST re-establishing with the original password still works (no duplicate row)', async () => {
      const token = issueToken(invitationFreshId);

      const result = await service.establishIdentity({
        token,
        password: VALID_PASSWORD,
      } as any);

      expect(result.contract_id).toBe(contractId);
      // Still exactly one user row + one binding — the race-guard
      // re-establish path, not a second create.
      expect(await userRowsByEmail(FRESH_EMAIL)).toHaveLength(1);
      expect(await bindingsForContract()).toHaveLength(1);
    });

    // ⭐ PATH-A UNAFFECTED — view-only exchange never touches users.
    it('Path-A exchange still issues a viewer credential for a real-account email', async () => {
      const token = issueToken(invitationManagingId);

      const result = await service.exchange(token);

      expect(result.contract_id).toBe(contractId);
      expect(typeof result.viewer_token).toBe('string');
      expect(result.viewer_token.length).toBeGreaterThan(10);
      expect(result.viewer_expires_at.getTime()).toBeGreaterThan(Date.now());

      // And it created neither a user row change nor a binding.
      const rows = await userRowsByEmail(MANAGING_EMAIL);
      expect(rows).toHaveLength(1);
      expect(rows[0].password_hash).toBe(MANAGING_HASH);
    });
  },
);
