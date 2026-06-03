import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';

import { ContractAccessService } from '../services/contract-access.service';
import {
  Contract,
  ContractStatus,
  GuestContractAccess,
  UserRole,
  AccountType,
} from '../../../database/entities';

/**
 * Phase 7.18 bucket 1a — unit tests for the contract-access authority.
 *
 * Hard rules under test (per CLAUDE.md Portal Architecture, Rule 5):
 *
 *   1. Guest bound to contract X → ALLOWED to read X.
 *   2. Guest bound to contract X → DENIED contract Y in a DIFFERENT project.
 *   3. Guest bound to contract X → DENIED a SIBLING contract in the SAME
 *      project as X.  (THIS is the confidentiality proof — guest scope is
 *      CONTRACT-level, never project-level.)
 *   4. A normal managing user's org-scoping is unchanged: in-org returns
 *      the contract; out-of-org returns 404 (never 403).
 *
 * Denial path is always NotFoundException (404) — existence is never
 * leaked, matching the assertContractInOrg convention.
 */

const CONTRACT_X_ID = '11111111-1111-1111-1111-111111111111';
const CONTRACT_Y_DIFFERENT_PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const CONTRACT_SIBLING_ID = '33333333-3333-3333-3333-333333333333';

const GUEST_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MANAGING_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const ORG_A_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ORG_B_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const baseContract = (id: string, projectId: string): Partial<Contract> => ({
  id,
  project_id: projectId,
  name: 'Test',
  status: ContractStatus.DRAFT,
  contract_clauses: [],
});

describe('ContractAccessService', () => {
  let service: ContractAccessService;
  let contractQb: any;
  let mockContractRepository: any;
  let mockGuestAccessRepository: any;

  beforeEach(async () => {
    contractQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };

    mockContractRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(contractQb),
    };

    mockGuestAccessRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractAccessService,
        { provide: getRepositoryToken(Contract), useValue: mockContractRepository },
        { provide: getRepositoryToken(GuestContractAccess), useValue: mockGuestAccessRepository },
      ],
    }).compile();

    service = module.get<ContractAccessService>(ContractAccessService);
  });

  // ─── Guest path ──────────────────────────────────────────────────────────

  describe('guest caller', () => {
    const guestCaller = {
      id: GUEST_USER_ID,
      organization_id: null,
      role: UserRole.GUEST,
      account_type: AccountType.GUEST,
    };

    it('allows a guest bound to contract X to read contract X', async () => {
      // Binding exists for (guest, X)
      mockGuestAccessRepository.findOne.mockResolvedValue({
        id: 'binding-uuid',
        user_id: GUEST_USER_ID,
        contract_id: CONTRACT_X_ID,
      });
      contractQb.getOne.mockResolvedValue(baseContract(CONTRACT_X_ID, 'project-1'));

      const result = await service.findAccessibleContract(CONTRACT_X_ID, guestCaller);

      expect(result.id).toBe(CONTRACT_X_ID);
      // Verify the binding lookup keyed BOTH on the user_id AND the
      // contract_id — never just one.
      expect(mockGuestAccessRepository.findOne).toHaveBeenCalledWith({
        where: { user_id: GUEST_USER_ID, contract_id: CONTRACT_X_ID },
      });
    });

    it('denies a guest a contract in a DIFFERENT project (no binding row)', async () => {
      mockGuestAccessRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findAccessibleContract(CONTRACT_Y_DIFFERENT_PROJECT_ID, guestCaller),
      ).rejects.toThrow(NotFoundException);

      // The contract query is NEVER issued — denial happens at the
      // binding layer first. This is the confidentiality property.
      expect(contractQb.getOne).not.toHaveBeenCalled();
    });

    it('denies a guest a SIBLING contract in the SAME project as the bound contract — guest scope is CONTRACT-level, not project-level', async () => {
      // Guest is bound ONLY to contract X. The sibling contract shares the
      // same project_id, but the binding row keyed on (user, sibling_id)
      // does not exist.
      mockGuestAccessRepository.findOne.mockImplementation(({ where }: any) => {
        if (where.contract_id === CONTRACT_X_ID) {
          return Promise.resolve({ id: 'binding-uuid' });
        }
        return Promise.resolve(null);
      });

      await expect(
        service.findAccessibleContract(CONTRACT_SIBLING_ID, guestCaller),
      ).rejects.toThrow(NotFoundException);

      expect(mockGuestAccessRepository.findOne).toHaveBeenCalledWith({
        where: { user_id: GUEST_USER_ID, contract_id: CONTRACT_SIBLING_ID },
      });
      expect(contractQb.getOne).not.toHaveBeenCalled();
    });

    it('returns 404 (never 403) on denial — existence not leaked', async () => {
      mockGuestAccessRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findAccessibleContract(CONTRACT_Y_DIFFERENT_PROJECT_ID, guestCaller),
      ).rejects.toThrow('Contract not found');
    });

    it('denies a guest whose binding row points at a hard-deleted contract', async () => {
      // Race / stale state: binding exists but the contract was hard-
      // deleted between the two queries. Authority must still 404.
      mockGuestAccessRepository.findOne.mockResolvedValue({
        id: 'binding-uuid',
        user_id: GUEST_USER_ID,
        contract_id: CONTRACT_X_ID,
      });
      contractQb.getOne.mockResolvedValue(undefined);

      await expect(
        service.findAccessibleContract(CONTRACT_X_ID, guestCaller),
      ).rejects.toThrow(NotFoundException);
    });

    it('routes a caller whose ROLE is GUEST through the guest path even if account_type was not set', async () => {
      // Defensive — a future bug could set role=GUEST without
      // account_type=GUEST. isGuest() must catch either signal.
      mockGuestAccessRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findAccessibleContract(CONTRACT_X_ID, {
          ...guestCaller,
          account_type: AccountType.MANAGING, // stale / not yet migrated
        }),
      ).rejects.toThrow(NotFoundException);

      // Binding query was attempted — proves the guest path was selected,
      // not the managing path (which would have hit the qb instead).
      expect(mockGuestAccessRepository.findOne).toHaveBeenCalled();
    });
  });

  // ─── Managing path — must remain byte-identical to PR #42's tenancy fix ──

  describe('managing caller (PR #42 regression coverage)', () => {
    const managingCaller = {
      id: MANAGING_USER_ID,
      organization_id: ORG_A_ID,
      role: UserRole.OWNER_ADMIN,
      account_type: AccountType.MANAGING,
    };

    it('returns the contract when the caller org matches', async () => {
      contractQb.getOne.mockResolvedValue(baseContract(CONTRACT_X_ID, 'project-1'));

      const result = await service.findAccessibleContract(CONTRACT_X_ID, managingCaller);

      expect(result.id).toBe(CONTRACT_X_ID);
      // The guest-binding path is NEVER consulted for a managing caller.
      expect(mockGuestAccessRepository.findOne).not.toHaveBeenCalled();
    });

    it('applies the project.organization_id = :orgId filter on the contract→project join', async () => {
      contractQb.getOne.mockResolvedValue(baseContract(CONTRACT_X_ID, 'project-1'));

      await service.findAccessibleContract(CONTRACT_X_ID, managingCaller);

      expect(contractQb.andWhere).toHaveBeenCalledWith(
        'project.organization_id = :orgId',
        { orgId: ORG_A_ID },
      );
    });

    it('returns 404 (never 403) when the contract is in a different org', async () => {
      // Caller is in ORG_A; the andWhere clause filters out anything not
      // joined on ORG_A → query returns undefined.
      contractQb.getOne.mockResolvedValue(undefined);

      await expect(
        service.findAccessibleContract(CONTRACT_X_ID, {
          ...managingCaller,
          organization_id: ORG_B_ID,
        }),
      ).rejects.toThrow('Contract not found');
    });

    it('returns 404 when a managing caller has NO organization_id', async () => {
      // Defensive: a malformed JWT or a stale SYSTEM_ADMIN row could
      // present without an org. Never fall through to "show all contracts".
      await expect(
        service.findAccessibleContract(CONTRACT_X_ID, {
          ...managingCaller,
          organization_id: null,
        }),
      ).rejects.toThrow('Contract not found');

      expect(contractQb.getOne).not.toHaveBeenCalled();
    });

    it('strips password_hash and MFA secrets from the loaded creator relation', async () => {
      contractQb.getOne.mockResolvedValue({
        ...baseContract(CONTRACT_X_ID, 'project-1'),
        creator: {
          id: 'user-uuid',
          email: 'creator@org-a.test',
          password_hash: '$2b$10$REDACTED',
          mfa_secret: 'mfa',
          mfa_totp_secret: 'totp',
          mfa_recovery_codes: ['code'],
          invitation_token: 'invite',
        },
      });

      const result = await service.findAccessibleContract(CONTRACT_X_ID, managingCaller);

      expect((result.creator as any).password_hash).toBeUndefined();
      expect((result.creator as any).mfa_secret).toBeUndefined();
      expect((result.creator as any).mfa_totp_secret).toBeUndefined();
      expect((result.creator as any).mfa_recovery_codes).toBeUndefined();
      expect((result.creator as any).invitation_token).toBeUndefined();
      expect(result.creator.email).toBe('creator@org-a.test');
    });

    it('sorts clauses by order_index', async () => {
      contractQb.getOne.mockResolvedValue({
        ...baseContract(CONTRACT_X_ID, 'project-1'),
        contract_clauses: [
          { order_index: 3 },
          { order_index: 1 },
          { order_index: 2 },
        ],
      });

      const result = await service.findAccessibleContract(CONTRACT_X_ID, managingCaller);

      expect(result.contract_clauses.map((c) => c.order_index)).toEqual([1, 2, 3]);
    });
  });

  // ─── Viewer credential (1b-i) ───────────────────────────────────────────

  describe('viewer credential caller', () => {
    const viewerForX = {
      type: 'viewer' as const,
      viewer: { contract_id: CONTRACT_X_ID, invitation_id: 'inv-1' },
    };

    it('allows a viewer bound to X to read X', async () => {
      contractQb.getOne.mockResolvedValue(baseContract(CONTRACT_X_ID, 'project-1'));

      const result = await service.findAccessibleContract(CONTRACT_X_ID, viewerForX);

      expect(result.id).toBe(CONTRACT_X_ID);
      // The viewer path is stateless — guest_contract_access is NEVER queried.
      expect(mockGuestAccessRepository.findOne).not.toHaveBeenCalled();
    });

    it('denies a viewer bound to X reading a different-project contract Y', async () => {
      await expect(
        service.findAccessibleContract(CONTRACT_Y_DIFFERENT_PROJECT_ID, viewerForX),
      ).rejects.toThrow(NotFoundException);
      // The mismatch check runs BEFORE the contract is even loaded.
      expect(contractQb.getOne).not.toHaveBeenCalled();
    });

    it('denies a viewer bound to X reading a SIBLING contract in the SAME project — viewer scope is CONTRACT-level', async () => {
      await expect(
        service.findAccessibleContract(CONTRACT_SIBLING_ID, viewerForX),
      ).rejects.toThrow(NotFoundException);
      expect(contractQb.getOne).not.toHaveBeenCalled();
    });

    it('denies (404) when the bound contract was hard-deleted between issuance and request', async () => {
      contractQb.getOne.mockResolvedValue(undefined);
      await expect(
        service.findAccessibleContract(CONTRACT_X_ID, viewerForX),
      ).rejects.toThrow(NotFoundException);
    });

    it('scrubs sensitive fields from creator/approver on the viewer read', async () => {
      contractQb.getOne.mockResolvedValue({
        ...baseContract(CONTRACT_X_ID, 'project-1'),
        creator: {
          id: 'u',
          email: 'c@org-a.test',
          password_hash: 'h',
          mfa_secret: 'm',
          mfa_totp_secret: 't',
          mfa_recovery_codes: ['r'],
          invitation_token: 'i',
        },
      });

      const result = await service.findAccessibleContract(CONTRACT_X_ID, viewerForX);

      expect((result.creator as any).password_hash).toBeUndefined();
      expect((result.creator as any).mfa_secret).toBeUndefined();
      expect((result.creator as any).mfa_totp_secret).toBeUndefined();
      expect((result.creator as any).mfa_recovery_codes).toBeUndefined();
      expect((result.creator as any).invitation_token).toBeUndefined();
      expect(result.creator.email).toBe('c@org-a.test');
    });

    it('returns 404 (never 403) on viewer denial — existence not leaked', async () => {
      await expect(
        service.findAccessibleContract(CONTRACT_SIBLING_ID, viewerForX),
      ).rejects.toThrow('Contract not found');
    });
  });

  // ─── findInOrg(): direct helper used by mutation paths ───────────────────

  describe('findInOrg() — direct helper for internal mutation paths', () => {
    it('matches the managing-path behaviour exactly', async () => {
      contractQb.getOne.mockResolvedValue(baseContract(CONTRACT_X_ID, 'project-1'));

      const result = await service.findInOrg(CONTRACT_X_ID, ORG_A_ID);

      expect(result.id).toBe(CONTRACT_X_ID);
      expect(contractQb.andWhere).toHaveBeenCalledWith(
        'project.organization_id = :orgId',
        { orgId: ORG_A_ID },
      );
    });

    it('throws NotFoundException on a cross-tenant read', async () => {
      contractQb.getOne.mockResolvedValue(undefined);

      await expect(service.findInOrg(CONTRACT_X_ID, ORG_B_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
