import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

import { GuestInvitationService } from '../services/guest-invitation.service';
import { InvitationTokenService } from '../services/invitation-token.service';
import { ViewerCredentialService } from '../services/viewer-credential.service';
import { AuthService } from '../../auth/auth.service';
import { AccountLockoutService } from '../../auth/services/account-lockout.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestInvitationScopedRepository } from '../../scoped-repository/guest-invitation-scoped.repository';

import {
  AccountType,
  ContractComment,
  GuestInvitation,
  User,
  UserRole,
} from '../../../database/entities';

/**
 * Fail-closed parent_comment_id validation in writeGuestComment.
 *
 * A guest may reply only within a thread it can actually see: the parent must
 * exist, be on THE SAME contract, and be guest-visible (is_internal_note=false).
 * Threading off an internal note (or another contract's comment, or a missing
 * id) is rejected 400 — closing the only channel by which a guest could probe
 * an internal comment's UUID.
 */

const CONTRACT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GUEST_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('GuestInvitationService — writeGuestComment parent validation', () => {
  let service: GuestInvitationService;
  let parentRow: Partial<ContractComment> | null;
  let savedComment: any;
  let commentFindOne: jest.Mock;

  const guestUser = {
    id: GUEST_USER_ID,
    role: UserRole.GUEST,
    account_type: AccountType.GUEST,
    organization_id: null,
  } as unknown as User;

  const build = async () => {
    savedComment = null;
    commentFindOne = jest.fn().mockImplementation(async () => parentRow);

    const dataSource = {
      getRepository: (entity: any) => {
        if (entity === User) return { findOne: jest.fn().mockResolvedValue(guestUser) };
        if (entity === ContractComment)
          return {
            findOne: commentFindOne,
            create: (d: any) => ({ ...d, id: 'new-comment' }),
            save: async (c: any) => {
              savedComment = c;
              return c;
            },
          };
        return {};
      },
    } as unknown as DataSource;

    const contractAccess = {
      findInOrg: jest.fn(),
      findAccessibleContract: jest.fn().mockResolvedValue({ id: CONTRACT_ID }),
    } as any;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GuestInvitationService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(30) } },
        { provide: getRepositoryToken(GuestInvitation), useValue: { findOne: jest.fn() } },
        { provide: InvitationTokenService, useValue: { verify: jest.fn() } },
        { provide: ViewerCredentialService, useValue: { issue: jest.fn() } },
        { provide: ContractAccessService, useValue: contractAccess },
        { provide: DataSource, useValue: dataSource },
        { provide: AuthService, useValue: { issueGuestSession: jest.fn() } },
        {
          provide: AccountLockoutService,
          useValue: {
            assertNotLocked: jest.fn(),
            recordFailedAttempt: jest.fn().mockResolvedValue(undefined),
            clearFailedAttempts: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: GuestInvitationScopedRepository,
          useValue: { scopedFindByIdOrThrow: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(GuestInvitationService);
  };

  beforeEach(build);

  it('rejects a parent that is an INTERNAL note (is_internal_note=true)', async () => {
    parentRow = { id: 'p-internal', contract_id: CONTRACT_ID, is_internal_note: true };
    await expect(
      service.writeGuestComment(CONTRACT_ID, GUEST_USER_ID, 'reply', undefined, 'p-internal'),
    ).rejects.toThrow(BadRequestException);
    expect(savedComment).toBeNull();
  });

  it('rejects a parent on a DIFFERENT contract', async () => {
    parentRow = { id: 'p-other', contract_id: 'other-contract', is_internal_note: false };
    await expect(
      service.writeGuestComment(CONTRACT_ID, GUEST_USER_ID, 'reply', undefined, 'p-other'),
    ).rejects.toThrow(BadRequestException);
    expect(savedComment).toBeNull();
  });

  it('rejects a parent that does not exist', async () => {
    parentRow = null;
    await expect(
      service.writeGuestComment(CONTRACT_ID, GUEST_USER_ID, 'reply', undefined, 'p-missing'),
    ).rejects.toThrow(BadRequestException);
    expect(savedComment).toBeNull();
  });

  it('accepts a visible, same-contract parent and writes a guest-visible reply', async () => {
    parentRow = { id: 'p-visible', contract_id: CONTRACT_ID, is_internal_note: false };
    const res = await service.writeGuestComment(
      CONTRACT_ID,
      GUEST_USER_ID,
      'reply',
      undefined,
      'p-visible',
    );
    expect(res.id).toBe('new-comment');
    expect(savedComment.is_internal_note).toBe(false);
    expect(savedComment.parent_comment_id).toBe('p-visible');
  });

  it('writes with no parent (control) — never queries for a parent', async () => {
    parentRow = null;
    const res = await service.writeGuestComment(CONTRACT_ID, GUEST_USER_ID, 'top-level');
    expect(res.id).toBe('new-comment');
    expect(savedComment.is_internal_note).toBe(false);
    expect(commentFindOne).not.toHaveBeenCalled();
  });
});
