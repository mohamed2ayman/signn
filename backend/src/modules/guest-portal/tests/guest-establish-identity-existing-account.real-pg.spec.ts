import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';

import {
  AccountType,
  GuestInvitation,
  User,
} from '../../../database/entities';
import { AuthService } from '../../auth/auth.service';
import { AccountLockoutService } from '../../auth/services/account-lockout.service';
import { SecurityEventService } from '../../admin-security/services/security-event.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestInvitationScopedRepository } from '../../scoped-repository/guest-invitation-scoped.repository';
import { GuestInvitationService } from '../services/guest-invitation.service';
import { InvitationTokenService } from '../services/invitation-token.service';
import { ViewerCredentialService } from '../services/viewer-credential.service';

/**
 * Unified membership Slice 1 — establish-identity branch matrix:
 * REAL-Postgres proof.
 *
 * Supersedes the Slice-0 detect-and-respond spec (409 EXISTING_ACCOUNT_EMAIL):
 * an existing REAL account (MANAGING) with a VALID invitation now takes the
 * real path — the password is verified against the account's EXISTING hash
 * (real-account-verify; never set, never overwritten) and a
 * guest_contract_access binding is attached to the EXISTING row. One identity
 * per email; no dual rows; org / sessions / password untouched.
 *
 * Matrix proven here:
 *   (iii)  existing MANAGING + valid invite + CORRECT password →
 *          binding attached to the EXISTING row; invite → ACCEPTED;
 *          account byte-untouched; session issued (stub).
 *   (anti-impersonation) WRONG password → 401; NO binding written; the
 *          account cannot be hijacked or bound onto via a stolen token.
 *   (MFA)  existing MANAGING with mfa_enabled → binding attached, but NO
 *          tokens minted here (requires_login: true) — the endpoint verifies
 *          only the password and must not bypass the account's MFA gate.
 *   (i)    brand-new email → new GUEST user + binding (unchanged).
 *   (ii)   existing GUEST re-establish → no duplicate row (unchanged).
 *   (Path A) exchange still issues a viewer credential for a real-account
 *          email and never touches the users table.
 *
 * Real here: the DataSource (live sign-postgres), the SELECT-FOR-UPDATE
 * transaction, bcrypt verification against a real stored hash, the HMAC
 * token services, and UQ_users_email itself. Stubbed: AuthService
 * .issueGuestSession (session machinery is orthogonal), ContractAccessService
 * + the scoped repository (used by create/revoke, not by these paths).
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
      'DATABASE_URL unset — the unified-membership branch matrix (real-account ' +
      'verify + binding attach + anti-impersonation) MUST run against Postgres. ' +
      'CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

const VALID_PASSWORD = 'GracefulSlice0@2026';
const WRONG_PASSWORD = 'NotTheRealPassword@2026';

describeReal(
  'GuestInvitationService.establishIdentity — unified membership branch matrix (real Postgres)',
  () => {
    let moduleRef: TestingModule;
    let dataSource: DataSource;
    let service: GuestInvitationService;
    let tokenService: InvitationTokenService;
    let issueGuestSessionMock: jest.Mock;

    // Fixture refs — deterministic ids for cleanup.
    const orgId = randomUUID();
    const managingUserId = randomUUID(); // real customer, no MFA
    const mfaUserId = randomUUID(); // real customer WITH MFA enabled
    const projectId = randomUUID();
    const contractId = randomUUID(); // fresh-guest tests
    const contractMId = randomUUID(); // managing-branch tests
    const contractMfaId = randomUUID(); // MFA-branch test
    const invitationManagingId = randomUUID(); // → MANAGING email, contractMId
    const invitationMfaId = randomUUID(); // → MFA email, contractMfaId
    const invitationFreshId = randomUUID(); // → brand-new email, contractId
    const MANAGING_EMAIL = `customer-${managingUserId.slice(0, 8)}@managing.test`;
    const MFA_EMAIL = `mfacust-${mfaUserId.slice(0, 8)}@managing.test`;
    const FRESH_EMAIL = `newguest-${invitationFreshId.slice(0, 8)}@external.test`;
    let managingHash = '';

    const issueToken = (invitationId: string) =>
      tokenService.issue(
        invitationId,
        new Date(Date.now() + 24 * 3600 * 1000),
      );

    const insertInvitation = async (
      id: string,
      email: string,
      forContractId: string,
    ) => {
      await dataSource.query(
        `INSERT INTO guest_invitations
           (id, contract_id, invited_email, invited_language, status,
            expires_at, created_by)
         VALUES ($1, $2, $3, 'en', 'PENDING', NOW() + interval '1 day', $4)`,
        [id, forContractId, email, managingUserId],
      );
    };

    const userRowsByEmail = async (email: string) =>
      dataSource.query(
        `SELECT id, email, password_hash, role, account_type, organization_id,
                is_active, failed_login_attempts, locked_until
           FROM users WHERE email = $1`,
        [email],
      );

    const bindingsFor = async (forContractId: string) =>
      dataSource.query(
        `SELECT id, user_id FROM guest_contract_access WHERE contract_id = $1`,
        [forContractId],
      );

    const invitationStatus = async (id: string) =>
      dataSource.query(
        `SELECT status, accepted_at FROM guest_invitations WHERE id = $1`,
        [id],
      );

    beforeAll(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { dataSourceOptions } = require('../../../config/data-source');

      managingHash = await bcrypt.hash(VALID_PASSWORD, 6);

      issueGuestSessionMock = jest.fn(async (user: any) => ({
        user: { id: user.id, email: user.email },
        access_token: 'stub-access',
        refresh_token: 'stub-refresh',
      }));

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
          // Real lockout stack (real PG): the establish-identity password-verify
          // branch runs the SAME AccountLockoutService the login path uses, so
          // the wrong-password path here exercises the real lockout writes.
          AccountLockoutService,
          SecurityEventService,
          {
            provide: AuthService,
            useValue: { issueGuestSession: issueGuestSessionMock },
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
        [orgId, `unified1-org-${orgId.slice(0, 8)}`],
      );
      const insertRealUser = async (
        id: string,
        email: string,
        mfaEnabled: boolean,
      ) =>
        dataSource.query(
          `INSERT INTO users (
             id, email, password_hash, first_name, last_name, role, account_type,
             organization_id, is_active, is_email_verified, mfa_enabled,
             preferred_language, failed_login_attempts, onboarding_completed,
             onboarding_level, email_digest_opt_out, marketing_email_opt_in,
             ai_training_opt_in
           )
           VALUES ($1, $2, $3, 'Real', 'Customer', 'OWNER_ADMIN', 'MANAGING', $4,
                   TRUE, TRUE, $5, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
          [id, email, managingHash, orgId, mfaEnabled],
        );
      await insertRealUser(managingUserId, MANAGING_EMAIL, false);
      await insertRealUser(mfaUserId, MFA_EMAIL, true);
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by)
         VALUES ($1, $2, 'unified1-project', $3)`,
        [projectId, orgId, managingUserId],
      );
      for (const [cid, name] of [
        [contractId, 'Unified1 Contract Fresh'],
        [contractMId, 'Unified1 Contract Managing'],
        [contractMfaId, 'Unified1 Contract MFA'],
      ] as const) {
        await dataSource.query(
          `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
           VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
          [cid, projectId, name, managingUserId],
        );
      }
      await insertInvitation(invitationManagingId, MANAGING_EMAIL, contractMId);
      await insertInvitation(invitationMfaId, MFA_EMAIL, contractMfaId);
      await insertInvitation(invitationFreshId, FRESH_EMAIL, contractId);
    });

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(
          `DELETE FROM guest_contract_access WHERE contract_id = ANY($1)`,
          [[contractId, contractMId, contractMfaId]],
        );
        await dataSource.query(
          `DELETE FROM guest_invitations WHERE id = ANY($1)`,
          [[invitationManagingId, invitationMfaId, invitationFreshId]],
        );
        await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
          [contractId, contractMId, contractMfaId],
        ]);
        await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
        await dataSource.query(
          `DELETE FROM users WHERE email = ANY($1)`,
          [[MANAGING_EMAIL, MFA_EMAIL, FRESH_EMAIL]],
        );
        await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
      }
      await moduleRef?.close();
    });

    // ⭐ ANTI-IMPERSONATION — runs FIRST so no binding exists yet.
    it('existing MANAGING email + WRONG password → 401; NO binding written; identity untouched; failed-attempt recorded (lockout parity)', async () => {
      const token = issueToken(invitationManagingId);

      await expect(
        service.establishIdentity({
          token,
          password: WRONG_PASSWORD,
        } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // NO binding, and every IDENTITY field is untouched (no auth clobber).
      expect(await bindingsFor(contractMId)).toHaveLength(0);
      const rows = await userRowsByEmail(MANAGING_EMAIL);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(managingUserId);
      expect(rows[0].password_hash).toBe(managingHash);
      expect(rows[0].account_type).toBe(AccountType.MANAGING);
      expect(rows[0].organization_id).toBe(orgId);
      // Condition 1 — the SAME lockout the login path uses: the failed attempt
      // is DURABLY recorded (survives the transaction rollback), not yet locked.
      expect(Number(rows[0].failed_login_attempts)).toBe(1);
      expect(rows[0].locked_until).toBeNull();
    });

    // ⭐ BRANCH (iii) — real-account-verify + attach binding to the EXISTING row.
    it('existing MANAGING email + CORRECT password → binding attached to the EXISTING row; invite ACCEPTED; org/hash/role untouched; session issued', async () => {
      const token = issueToken(invitationManagingId);

      const result = await service.establishIdentity({
        token,
        password: VALID_PASSWORD,
      } as any);

      expect(result.contract_id).toBe(contractMId);
      expect(result.requires_login).toBeUndefined();
      expect(result.access_token).toBe('stub-access');

      // ONE identity: still exactly one user row, the ORIGINAL MANAGING row —
      // no dual rows, no auth clobber (hash byte-identical), org untouched.
      const rows = await userRowsByEmail(MANAGING_EMAIL);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(managingUserId);
      expect(rows[0].password_hash).toBe(managingHash);
      expect(rows[0].account_type).toBe(AccountType.MANAGING);
      expect(rows[0].role).toBe('OWNER_ADMIN');
      expect(rows[0].organization_id).toBe(orgId);

      // The binding attached to the EXISTING managing row.
      const bindings = await bindingsFor(contractMId);
      expect(bindings).toHaveLength(1);
      expect(bindings[0].user_id).toBe(managingUserId);

      // Invitation flipped ACCEPTED.
      const [inv] = await invitationStatus(invitationManagingId);
      expect(inv.status).toBe('ACCEPTED');
      expect(inv.accepted_at).not.toBeNull();
    });

    // Idempotent repeat — no duplicate binding, stable success.
    it('repeat establish (same MANAGING account, same contract) → same single binding, no duplicate', async () => {
      const token = issueToken(invitationManagingId);
      const result = await service.establishIdentity({
        token,
        password: VALID_PASSWORD,
      } as any);
      expect(result.contract_id).toBe(contractMId);
      expect(await bindingsFor(contractMId)).toHaveLength(1);
      expect(await userRowsByEmail(MANAGING_EMAIL)).toHaveLength(1);
    });

    // ⭐ MFA branch — binding attaches, but NO tokens minted on this endpoint.
    it('existing MANAGING with MFA enabled + CORRECT password → binding attached, requires_login=true, NO tokens (no MFA bypass)', async () => {
      const callsBefore = issueGuestSessionMock.mock.calls.length;
      const token = issueToken(invitationMfaId);

      const result = await service.establishIdentity({
        token,
        password: VALID_PASSWORD,
      } as any);

      expect(result.requires_login).toBe(true);
      expect(result.access_token).toBeNull();
      expect(result.refresh_token).toBeNull();
      // The session machinery was NEVER invoked for the MFA account.
      expect(issueGuestSessionMock.mock.calls.length).toBe(callsBefore);

      // But the binding DID attach (that is what the invitation grants).
      const bindings = await bindingsFor(contractMfaId);
      expect(bindings).toHaveLength(1);
      expect(bindings[0].user_id).toBe(mfaUserId);
    });

    // ⭐ BRANCH (i) — unchanged: brand-new email creates GUEST + binding.
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

      const bindings = await bindingsFor(contractId);
      expect(bindings).toHaveLength(1);
      expect(bindings[0].user_id).toBe(rows[0].id);
    });

    // ⭐ BRANCH (ii) — unchanged: existing GUEST re-establish, no duplicate.
    it('existing GUEST re-establishing with the original password still works (no duplicate row)', async () => {
      const token = issueToken(invitationFreshId);

      const result = await service.establishIdentity({
        token,
        password: VALID_PASSWORD,
      } as any);

      expect(result.contract_id).toBe(contractId);
      expect(await userRowsByEmail(FRESH_EMAIL)).toHaveLength(1);
      expect(await bindingsFor(contractId)).toHaveLength(1);
    });

    // ⭐ PATH-A UNAFFECTED — view-only exchange never touches users.
    it('Path-A exchange still issues a viewer credential for a real-account email — and reports account_exists=true', async () => {
      const token = issueToken(invitationManagingId);

      const result = await service.exchange(token);

      expect(result.contract_id).toBe(contractMId);
      expect(typeof result.viewer_token).toBe('string');
      expect(result.viewer_token.length).toBeGreaterThan(10);
      expect(result.viewer_expires_at.getTime()).toBeGreaterThan(Date.now());
      // #8c Part 1 — the returning-guest signal: this email has an account.
      // A plain boolean; the payload never carries account_type/role/name.
      expect(result.account_exists).toBe(true);
      expect(result).not.toHaveProperty('account_type');
      expect(result).not.toHaveProperty('role');

      // And it changed neither the user row nor the binding count.
      const rows = await userRowsByEmail(MANAGING_EMAIL);
      expect(rows).toHaveLength(1);
      expect(rows[0].password_hash).toBe(managingHash);
    });

    // ⭐ account_exists — brand-new email (no account anywhere) reports FALSE.
    it('exchange reports account_exists=false for an invited email with no SIGN account', async () => {
      // A fresh invitation whose email NEVER establishes identity in this
      // suite — inserted + cleaned up inside the test to keep it hermetic.
      const invitationNeverId = randomUUID();
      const NEVER_EMAIL = `nevermember-${invitationNeverId.slice(0, 8)}@external.test`;
      await insertInvitation(invitationNeverId, NEVER_EMAIL, contractId);
      try {
        const token = issueToken(invitationNeverId);

        const result = await service.exchange(token);

        expect(result.account_exists).toBe(false);
        // Existence check is read-only — it must not create a user row.
        expect(await userRowsByEmail(NEVER_EMAIL)).toHaveLength(0);
      } finally {
        await dataSource.query(`DELETE FROM guest_invitations WHERE id = $1`, [
          invitationNeverId,
        ]);
      }
    });
  },
);
