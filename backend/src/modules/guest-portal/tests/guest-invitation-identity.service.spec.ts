import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { GuestInvitationService } from '../services/guest-invitation.service';
import { InvitationTokenService } from '../services/invitation-token.service';
import { ViewerCredentialService } from '../services/viewer-credential.service';
import { AuthService } from '../../auth/auth.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

import {
  AccountType,
  ContractComment,
  GuestContractAccess,
  GuestInvitation,
  GuestInvitationStatus,
  User,
  UserRole,
} from '../../../database/entities';
import { GuestIntentKind } from '../dto/establish-identity.dto';

/**
 * Phase 7.18 bucket 1b-ii — service-level unit tests for
 * GuestInvitationService.establishIdentity + writeGuestComment.
 *
 * The atomic transaction is exercised LIVE in the probe (1b-ii (c) and (d))
 * because the SELECT-FOR-UPDATE serialization and unique-key collisions
 * are DB-level invariants that mocks cannot honestly assert. Here we
 * cover the in-process branches: token verification, race-guard
 * password check, resume-intent dispatch, and the guest comment
 * authority check (404 on non-bound contract).
 */

const INVITATION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONTRACT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GUEST_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const mkInvitation = (overrides: Partial<GuestInvitation> = {}): GuestInvitation =>
  ({
    id: INVITATION_ID,
    contract_id: CONTRACT_ID,
    invited_email: 'guest@example.test',
    invited_language: 'en',
    status: GuestInvitationStatus.PENDING,
    expires_at: new Date(Date.now() + 24 * 3600 * 1000),
    revoked_at: null,
    accepted_at: null,
    created_by: 'inviter-uuid',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }) as any;

describe('GuestInvitationService — 1b-ii identity transition', () => {
  let service: GuestInvitationService;
  let tokenService: jest.Mocked<InvitationTokenService>;
  let viewerService: jest.Mocked<ViewerCredentialService>;
  let authService: jest.Mocked<AuthService>;
  let contractAccess: jest.Mocked<ContractAccessService>;
  let dataSource: jest.Mocked<DataSource>;

  // In-test manager that captures inserts and exposes them for assertions.
  const captured: {
    userInsert: User | null;
    bindingInsert: GuestContractAccess | null;
    invitationUpdate: GuestInvitation | null;
    commentInsert: ContractComment | null;
  } = {
    userInsert: null,
    bindingInsert: null,
    invitationUpdate: null,
    commentInsert: null,
  };
  let invitationInBackingStore: GuestInvitation;
  let existingGuestUser: User | null;
  let existingBinding: GuestContractAccess | null;

  beforeEach(async () => {
    captured.userInsert = null;
    captured.bindingInsert = null;
    captured.invitationUpdate = null;
    captured.commentInsert = null;
    invitationInBackingStore = mkInvitation();
    existingGuestUser = null;
    existingBinding = null;

    tokenService = { verify: jest.fn(), issue: jest.fn() } as any;
    viewerService = { issue: jest.fn(), verify: jest.fn(), ttlMinutes: jest.fn() } as any;
    authService = {
      issueGuestSession: jest.fn().mockImplementation(async (user: User) => ({
        user: { id: user.id, email: user.email },
        access_token: 'access-jwt',
        refresh_token: 'refresh-jwt',
      })),
    } as any;
    contractAccess = {
      findInOrg: jest.fn(),
      findAccessibleContract: jest.fn().mockResolvedValue({ id: CONTRACT_ID }),
    } as any;

    const buildManager = (): EntityManager => {
      const qbForInvitation = {
        setLock: undefined as any,
        where: undefined as any,
        getOne: async () => invitationInBackingStore,
      };
      qbForInvitation.setLock = () => qbForInvitation;
      qbForInvitation.where = () => qbForInvitation;

      return {
        getRepository: (entity: any) => {
          if (entity === GuestInvitation) {
            return {
              createQueryBuilder: () => qbForInvitation,
              save: async (inv: GuestInvitation) => {
                captured.invitationUpdate = inv;
                invitationInBackingStore = { ...invitationInBackingStore, ...inv };
                return invitationInBackingStore;
              },
            };
          }
          if (entity === User) {
            return {
              findOne: async ({ where }: any) => {
                if (where?.id && captured.userInsert?.id === where.id) {
                  return captured.userInsert;
                }
                return existingGuestUser;
              },
              create: (data: any) => ({ ...data, id: GUEST_USER_ID }),
              save: async (u: User) => {
                captured.userInsert = u;
                return u;
              },
            };
          }
          if (entity === GuestContractAccess) {
            return {
              findOne: async () => existingBinding,
              create: (data: any) => ({ ...data, id: 'binding-uuid' }),
              save: async (b: GuestContractAccess) => {
                captured.bindingInsert = b;
                return b;
              },
            };
          }
          if (entity === ContractComment) {
            return {
              create: (data: any) => ({ ...data, id: 'comment-uuid' }),
              save: async (c: ContractComment) => {
                captured.commentInsert = c;
                return c;
              },
            };
          }
          return {};
        },
      } as any;
    };

    dataSource = {
      transaction: jest.fn(async (cb: (m: EntityManager) => Promise<any>) =>
        cb(buildManager()),
      ),
      getRepository: (entity: any) => buildManager().getRepository(entity),
    } as any;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GuestInvitationService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(30) } },
        { provide: getRepositoryToken(GuestInvitation), useValue: { findOne: jest.fn(), save: jest.fn(), create: jest.fn() } },
        { provide: InvitationTokenService, useValue: tokenService },
        { provide: ViewerCredentialService, useValue: viewerService },
        { provide: ContractAccessService, useValue: contractAccess },
        { provide: DataSource, useValue: dataSource },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();
    service = moduleRef.get(GuestInvitationService);
  });

  // ─── establishIdentity — first-time path ──────────────────────────

  it('first-time call creates exactly one user, one binding, flips invitation ACCEPTED, returns JWT', async () => {
    tokenService.verify.mockResolvedValue({
      ok: true,
      invitation: invitationInBackingStore,
    } as any);

    const res = await service.establishIdentity(
      { token: 'tok', password: 'CorrectHorse@Battery1', first_name: 'Probe', last_name: 'Guest' } as any,
      {},
    );

    expect(captured.userInsert).not.toBeNull();
    expect(captured.userInsert?.account_type).toBe(AccountType.GUEST);
    expect(captured.userInsert?.role).toBe(UserRole.GUEST);
    expect((captured.userInsert as any).organization_id).toBeNull();

    expect(captured.bindingInsert).not.toBeNull();
    expect(captured.bindingInsert?.user_id).toBe(GUEST_USER_ID);
    expect(captured.bindingInsert?.contract_id).toBe(CONTRACT_ID);

    expect(captured.invitationUpdate?.status).toBe(GuestInvitationStatus.ACCEPTED);
    expect(captured.invitationUpdate?.accepted_at).not.toBeNull();

    expect(authService.issueGuestSession).toHaveBeenCalledTimes(1);
    expect(res.access_token).toBe('access-jwt');
    expect(res.refresh_token).toBe('refresh-jwt');
    expect(res.contract_id).toBe(CONTRACT_ID);
  });

  // ─── repeat call — race guard ─────────────────────────────────────

  it('REPEAT call with correct password does NOT create a second user/binding and re-issues a JWT', async () => {
    existingGuestUser = {
      id: GUEST_USER_ID,
      email: 'guest@example.test',
      account_type: AccountType.GUEST,
      role: UserRole.GUEST,
      password_hash: 'hashed-placeholder',
      organization_id: null,
    } as any;
    existingBinding = {
      id: 'binding-uuid',
      user_id: GUEST_USER_ID,
      contract_id: CONTRACT_ID,
    } as any;
    invitationInBackingStore = mkInvitation({
      status: GuestInvitationStatus.ACCEPTED,
      accepted_at: new Date(Date.now() - 60_000),
    });
    tokenService.verify.mockResolvedValue({
      ok: true,
      invitation: invitationInBackingStore,
    } as any);
    // Real bcrypt would do the comparison; here we shortcut the verify
    // result so the test doesn't depend on a real hash being computed.
    const compareSpy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    try {
      const res = await service.establishIdentity(
        { token: 'tok', password: 'CorrectHorse@Battery1' } as any,
        {},
      );

      expect(captured.userInsert).toBeNull();
      expect(captured.bindingInsert).toBeNull();
      expect(authService.issueGuestSession).toHaveBeenCalledTimes(1);
      expect(res.access_token).toBe('access-jwt');
    } finally {
      compareSpy.mockRestore();
    }
  });

  it('REPEAT call with WRONG password returns 401 (no overwrite, no impersonation)', async () => {
    existingGuestUser = {
      id: GUEST_USER_ID,
      email: 'guest@example.test',
      account_type: AccountType.GUEST,
      role: UserRole.GUEST,
      password_hash: 'hashed-placeholder',
      organization_id: null,
    } as any;
    existingBinding = {
      id: 'binding-uuid',
      user_id: GUEST_USER_ID,
      contract_id: CONTRACT_ID,
    } as any;
    tokenService.verify.mockResolvedValue({
      ok: true,
      invitation: invitationInBackingStore,
    } as any);
    const compareSpy = jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    try {
      await expect(
        service.establishIdentity(
          { token: 'tok', password: 'TotallyWrong@Pass99' } as any,
          {},
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(captured.userInsert).toBeNull();
      expect(captured.bindingInsert).toBeNull();
      expect(authService.issueGuestSession).not.toHaveBeenCalled();
    } finally {
      compareSpy.mockRestore();
    }
  });

  // ─── token verification gating ────────────────────────────────────

  it('rejects when the invitation token is invalid (no DB writes)', async () => {
    tokenService.verify.mockResolvedValue({ ok: false, reason: 'invalid_signature' } as any);
    await expect(
      service.establishIdentity(
        { token: 'bad', password: 'CorrectHorse@Battery1' } as any,
        {},
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(captured.userInsert).toBeNull();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects when the invitation is revoked under the SELECT-FOR-UPDATE lock', async () => {
    invitationInBackingStore = mkInvitation({
      status: GuestInvitationStatus.REVOKED,
      revoked_at: new Date(),
    });
    tokenService.verify.mockResolvedValue({
      ok: true,
      invitation: invitationInBackingStore,
    } as any);

    await expect(
      service.establishIdentity(
        { token: 'tok', password: 'CorrectHorse@Battery1' } as any,
        {},
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(captured.userInsert).toBeNull();
  });

  // ─── resume-intent dispatch ───────────────────────────────────────

  it('intent COMMENT triggers an inline comment write and returns its id + route', async () => {
    tokenService.verify.mockResolvedValue({
      ok: true,
      invitation: invitationInBackingStore,
    } as any);

    const res = await service.establishIdentity(
      {
        token: 'tok',
        password: 'CorrectHorse@Battery1',
        intent: {
          kind: GuestIntentKind.COMMENT,
          comment: { content: 'Hello from the recipient.' },
        },
      } as any,
      {},
    );

    expect(captured.commentInsert).not.toBeNull();
    expect(captured.commentInsert?.user_id).toBe(GUEST_USER_ID);
    expect(captured.commentInsert?.contract_id).toBe(CONTRACT_ID);
    expect(res.resume.kind).toBe(GuestIntentKind.COMMENT);
    expect(res.resume.created_comment_id).toBe('comment-uuid');
    expect(res.resume.route).toMatch(/#comment-/);
  });

  it('intent SIGN returns a sign-bucket route hint (no work performed)', async () => {
    tokenService.verify.mockResolvedValue({
      ok: true,
      invitation: invitationInBackingStore,
    } as any);

    const res = await service.establishIdentity(
      {
        token: 'tok',
        password: 'CorrectHorse@Battery1',
        intent: { kind: GuestIntentKind.SIGN },
      } as any,
      {},
    );

    expect(captured.commentInsert).toBeNull();
    expect(res.resume.kind).toBe(GuestIntentKind.SIGN);
    expect(res.resume.route).toBe(`/contracts/${CONTRACT_ID}/sign`);
  });

  it('intent UPLOAD returns an upload-bucket route hint (no work performed)', async () => {
    tokenService.verify.mockResolvedValue({
      ok: true,
      invitation: invitationInBackingStore,
    } as any);

    const res = await service.establishIdentity(
      {
        token: 'tok',
        password: 'CorrectHorse@Battery1',
        intent: { kind: GuestIntentKind.UPLOAD },
      } as any,
      {},
    );

    expect(captured.commentInsert).toBeNull();
    expect(res.resume.kind).toBe(GuestIntentKind.UPLOAD);
    expect(res.resume.route).toBe(`/contracts/${CONTRACT_ID}/upload`);
  });

  // ─── writeGuestComment authority check ────────────────────────────

  it('writeGuestComment 404s when the authority denies access (non-bound contract)', async () => {
    // Override the global manager-backed userRepo for THIS test by
    // exposing a guest user but having ContractAccessService throw.
    existingGuestUser = {
      id: GUEST_USER_ID,
      role: UserRole.GUEST,
      account_type: AccountType.GUEST,
      organization_id: null,
    } as any;
    contractAccess.findAccessibleContract.mockRejectedValueOnce(
      new NotFoundException('Contract not found'),
    );

    await expect(
      service.writeGuestComment(
        'some-other-contract-id',
        GUEST_USER_ID,
        'hello',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(captured.commentInsert).toBeNull();
  });
});
