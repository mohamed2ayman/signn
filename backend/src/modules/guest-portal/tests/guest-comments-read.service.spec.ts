import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

import { GuestInvitationService } from '../services/guest-invitation.service';
import { InvitationTokenService } from '../services/invitation-token.service';
import { ViewerCredentialService } from '../services/viewer-credential.service';
import { AuthService } from '../../auth/auth.service';
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
 * Guest Portal comments-list (feature #1) — service-level unit tests for
 * GuestInvitationService.readGuestVisibleComments.
 *
 * These cover the in-process invariants a mock CAN honestly assert:
 *   • the authority gate fires BEFORE any query (cross-contract denial),
 *   • the visibility WHITELIST clause (is_internal_note = false) is applied,
 *   • the projection is SCRUBBED (no account_type / email / raw name leak),
 *   • a guest-vs-team flag is derived from the author's account_type.
 *
 * The ACTUAL row-level exclusion of an internal comment and the real
 * cross-contract 404 are proven end-to-end against real Postgres in the
 * in-container red→green probe (see docs / the feature digest) — exactly the
 * division the sibling identity spec documents for the atomic transaction.
 */

const CONTRACT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_CONTRACT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const GUEST_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

type RawRow = {
  id: string;
  contract_id: string;
  contract_clause_id: string | null;
  content: string;
  created_at: Date;
  first_name: string | null;
  last_name: string | null;
  account_type: AccountType;
};

describe('GuestInvitationService — readGuestVisibleComments', () => {
  let service: GuestInvitationService;
  let contractAccess: jest.Mocked<ContractAccessService>;

  // Captured query-builder calls so we can assert the whitelist clause.
  let andWhereCalls: any[][];
  let createQueryBuilder: jest.Mock;
  let getRawMany: jest.Mock;
  let userFindOne: jest.Mock;

  const guestUser = {
    id: GUEST_USER_ID,
    role: UserRole.GUEST,
    account_type: AccountType.GUEST,
    organization_id: null,
  } as unknown as User;

  const buildService = async (rawRows: RawRow[]) => {
    andWhereCalls = [];
    getRawMany = jest.fn().mockResolvedValue(rawRows);

    const qb: any = {};
    qb.innerJoin = jest.fn(() => qb);
    qb.select = jest.fn(() => qb);
    qb.addSelect = jest.fn(() => qb);
    qb.where = jest.fn(() => qb);
    qb.andWhere = jest.fn((...args: any[]) => {
      andWhereCalls.push(args);
      return qb;
    });
    qb.orderBy = jest.fn(() => qb);
    qb.getRawMany = getRawMany;

    createQueryBuilder = jest.fn(() => qb);
    userFindOne = jest.fn().mockResolvedValue(guestUser);

    const dataSource = {
      getRepository: (entity: any) => {
        if (entity === User) return { findOne: userFindOne };
        if (entity === ContractComment) return { createQueryBuilder };
        return {};
      },
    } as unknown as DataSource;

    contractAccess = {
      findInOrg: jest.fn(),
      findAccessibleContract: jest.fn().mockResolvedValue({ id: CONTRACT_ID }),
    } as any;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GuestInvitationService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(30) } },
        {
          provide: getRepositoryToken(GuestInvitation),
          useValue: { findOne: jest.fn(), save: jest.fn(), create: jest.fn() },
        },
        { provide: InvitationTokenService, useValue: { verify: jest.fn(), issue: jest.fn() } },
        { provide: ViewerCredentialService, useValue: { issue: jest.fn(), verify: jest.fn() } },
        { provide: ContractAccessService, useValue: contractAccess },
        { provide: DataSource, useValue: dataSource },
        { provide: AuthService, useValue: { issueGuestSession: jest.fn() } },
        {
          provide: GuestInvitationScopedRepository,
          useValue: { scopedFindByIdOrThrow: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(GuestInvitationService);
  };

  const mkRow = (over: Partial<RawRow> = {}): RawRow => ({
    id: 'comment-1',
    contract_id: CONTRACT_ID,
    contract_clause_id: null,
    content: 'hello',
    created_at: new Date('2026-06-22T10:00:00Z'),
    first_name: 'Gina',
    last_name: 'Guest',
    account_type: AccountType.GUEST,
    ...over,
  });

  it('returns guest-visible comments with a guest-vs-team flag, chronologically', async () => {
    await buildService([
      mkRow({ id: 'g1', content: 'guest message', account_type: AccountType.GUEST, first_name: 'Gina', last_name: 'Guest' }),
      mkRow({ id: 't1', content: 'team reply', account_type: AccountType.MANAGING, first_name: 'Tom', last_name: 'Team' }),
    ]);

    const res = await service.readGuestVisibleComments(CONTRACT_ID, GUEST_USER_ID);

    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ id: 'g1', content: 'guest message', author_role: 'GUEST', author_name: 'Gina Guest' });
    expect(res[1]).toMatchObject({ id: 't1', content: 'team reply', author_role: 'TEAM', author_name: 'Tom Team' });
  });

  it('SCRUBS author PII — no account_type / email / raw name fields in the projection', async () => {
    await buildService([mkRow({ account_type: AccountType.MANAGING })]);
    const res = await service.readGuestVisibleComments(CONTRACT_ID, GUEST_USER_ID);
    const keys = Object.keys(res[0]);
    expect(keys).toEqual(
      expect.arrayContaining([
        'id',
        'contract_id',
        'contract_clause_id',
        'content',
        'created_at',
        'author_name',
        'author_role',
      ]),
    );
    expect(keys).not.toContain('account_type');
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('first_name');
    expect(keys).not.toContain('last_name');
    expect(keys).not.toContain('user_id');
    expect(keys).not.toContain('is_internal_note');
    // parent_comment_id is deliberately NOT projected to guests (metadata leak).
    expect(keys).not.toContain('parent_comment_id');
  });

  it('applies the visibility WHITELIST (is_internal_note = false) — never returns internal notes', async () => {
    await buildService([mkRow()]);
    await service.readGuestVisibleComments(CONTRACT_ID, GUEST_USER_ID);

    const hasWhitelist = andWhereCalls.some(
      ([clause, params]) =>
        typeof clause === 'string' &&
        clause.includes('is_internal_note') &&
        params &&
        params.visible === false,
    );
    expect(hasWhitelist).toBe(true);
  });

  it('404s on a contract the guest is NOT bound to — and never runs the query', async () => {
    await buildService([mkRow()]);
    contractAccess.findAccessibleContract.mockRejectedValueOnce(
      new NotFoundException('Contract not found'),
    );

    await expect(
      service.readGuestVisibleComments(OTHER_CONTRACT_ID, GUEST_USER_ID),
    ).rejects.toThrow(NotFoundException);
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('404s when the guest user row does not exist (no authority call, no query)', async () => {
    await buildService([mkRow()]);
    userFindOne.mockResolvedValueOnce(null);

    await expect(
      service.readGuestVisibleComments(CONTRACT_ID, GUEST_USER_ID),
    ).rejects.toThrow(NotFoundException);
    expect(contractAccess.findAccessibleContract).not.toHaveBeenCalled();
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });
});
