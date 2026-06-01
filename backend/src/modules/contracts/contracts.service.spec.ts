import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ContractsService } from './contracts.service';
import {
  Contract,
  ContractStatus,
  ContractClause,
  ContractVersion,
  ContractComment,
  ContractorResponse,
  User,
  ContractApprover,
} from '../../database/entities';
import { CollaborationGateway } from '../collaboration/collaboration.gateway';
import { ContractTemplatesService } from '../contract-templates/contract-templates.service';
import { EmailService } from '../notifications/email.service';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SAVED_CONTRACT: Partial<Contract> = {
  id: 'contract-uuid',
  name: 'Test Construction Contract',
  status: ContractStatus.DRAFT,
  current_version: 1,
  project_id: 'project-uuid',
  contract_clauses: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// QueryBuilder mock (used by contractRepository.createQueryBuilder)
// ─────────────────────────────────────────────────────────────────────────────

const mockQb: any = {
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
  // findById was reshaped to use createQueryBuilder().getOne() so the org-scoping
  // andWhere can join on contract→project. Default to SAVED_CONTRACT.
  getOne: jest.fn().mockResolvedValue(SAVED_CONTRACT),
};

// ─────────────────────────────────────────────────────────────────────────────
// Repository mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockContractRepository = {
  create: jest.fn().mockReturnValue({ ...SAVED_CONTRACT, id: undefined }),
  save: jest.fn().mockResolvedValue(SAVED_CONTRACT),
  findOne: jest.fn().mockResolvedValue(SAVED_CONTRACT),
  createQueryBuilder: jest.fn().mockReturnValue(mockQb),
};

const mockContractClauseRepository = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue({}),
  remove: jest.fn().mockResolvedValue({}),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ max: 0 }),
  }),
};

const mockContractVersionRepository = {
  create: jest.fn().mockReturnValue({ id: 'version-uuid', version_number: 1 }),
  save: jest.fn().mockResolvedValue({ id: 'version-uuid', version_number: 1 }),
  // Return null so createVersionSnapshot treats this as the first version
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
};

const mockContractCommentRepository = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  remove: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  }),
};

const mockContractorResponseRepository = {
  find: jest.fn().mockResolvedValue([]),
};

// resolveUserRole() calls userRepository.findOne — returning null gives null job_title
const mockUserRepository = {
  findOne: jest.fn().mockResolvedValue(null),
};

const mockContractApproverRepository = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  delete: jest.fn().mockResolvedValue({}),
  createQueryBuilder: jest.fn().mockReturnValue({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Service mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockCollaborationGateway = {
  emitClauseAdded: jest.fn(),
  emitClauseUpdated: jest.fn(),
  emitClauseRemoved: jest.fn(),
  emitStatusChanged: jest.fn(),
  emitCommentAdded: jest.fn(),
  emitCommentResolved: jest.fn(),
};

const mockContractTemplatesService = {
  instantiateTemplate: jest.fn().mockResolvedValue(undefined),
};

const mockEmailService = {
  sendContractApprovalRequest: jest.fn().mockResolvedValue(undefined),
};

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('ContractsService', () => {
  let service: ContractsService;

  beforeEach(async () => {
    // Clear call history; implementations defined above are preserved
    jest.clearAllMocks();

    // Re-assert return values to make every test hermetic
    mockContractRepository.create.mockReturnValue({ ...SAVED_CONTRACT, id: undefined });
    mockContractRepository.save.mockResolvedValue(SAVED_CONTRACT);
    mockContractRepository.findOne.mockResolvedValue(SAVED_CONTRACT);
    mockContractVersionRepository.findOne.mockResolvedValue(null);
    mockContractVersionRepository.create.mockReturnValue({ id: 'version-uuid', version_number: 1 });
    mockContractVersionRepository.save.mockResolvedValue({ id: 'version-uuid', version_number: 1 });
    mockQb.getMany.mockResolvedValue([]);
    mockQb.getOne.mockResolvedValue(SAVED_CONTRACT);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractsService,
        { provide: getRepositoryToken(Contract),           useValue: mockContractRepository },
        { provide: getRepositoryToken(ContractClause),     useValue: mockContractClauseRepository },
        { provide: getRepositoryToken(ContractVersion),    useValue: mockContractVersionRepository },
        { provide: getRepositoryToken(ContractComment),    useValue: mockContractCommentRepository },
        { provide: getRepositoryToken(ContractorResponse), useValue: mockContractorResponseRepository },
        { provide: getRepositoryToken(User),               useValue: mockUserRepository },
        { provide: getRepositoryToken(ContractApprover),   useValue: mockContractApproverRepository },
        { provide: CollaborationGateway,                   useValue: mockCollaborationGateway },
        { provide: ContractTemplatesService,               useValue: mockContractTemplatesService },
        { provide: EmailService,                           useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<ContractsService>(ContractsService);
  });

  // ─── create() ──────────────────────────────────────────────────────────────

  describe('create()', () => {
    /**
     * ADHOC is a non-standard contract type — isStandardForm() returns false.
     * This skips the license-acknowledgment check and the template branch,
     * making the mock setup simpler and the test faster.
     */
    const dto = {
      project_id: 'project-uuid',
      name: 'Test Construction Contract',
      contract_type: 'ADHOC' as any,
      party_type: 'CLIENT',
      license_acknowledged: false,
    };

    it('returns a contract object with an id', async () => {
      const result = await service.create(dto, 'user-uuid', 'org-uuid');
      expect(result).toBeDefined();
      expect(result.id).toBe('contract-uuid');
    });

    it('returns a contract with status DRAFT', async () => {
      const result = await service.create(dto, 'user-uuid', 'org-uuid');
      expect(result.status).toBe(ContractStatus.DRAFT);
    });

    it('does NOT call instantiateTemplate for a non-standard (ADHOC) contract type', async () => {
      await service.create(dto, 'user-uuid', 'org-uuid');
      expect(mockContractTemplatesService.instantiateTemplate).not.toHaveBeenCalled();
    });
  });

  // ─── findAll() ─────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('returns an array (not null, not undefined)', async () => {
      const result = await service.findAll('project-uuid');
      expect(Array.isArray(result)).toBe(true);
    });

    it('always scopes the query by project_id (org enforcement via project chain — CLAUDE.md rule #3)', async () => {
      await service.findAll('project-uuid');
      // Contracts belong to a project; projects belong to an org.
      // The WHERE clause ensures no cross-tenant data leaks.
      expect(mockQb.where).toHaveBeenCalledWith(
        'contract.project_id = :projectId',
        { projectId: 'project-uuid' },
      );
    });

    it('passes optional filters through to the query builder', async () => {
      mockQb.getMany.mockResolvedValue([SAVED_CONTRACT as Contract]);
      const result = await service.findAll('project-uuid', { status: 'DRAFT' });
      expect(Array.isArray(result)).toBe(true);
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'contract.status = :status',
        { status: 'DRAFT' },
      );
    });
  });

  // ─── update() — Phase 7.17 Prompt 2a value↔currency pairing ─────────────────

  describe('update() value/currency pairing (merged entity)', () => {
    it('allows a value-only update on an already-priced contract (currency from the existing row)', async () => {
      // findById was reshaped to use createQueryBuilder().getOne(), so mock getOne (not findOne).
      mockQb.getOne.mockResolvedValue({
        ...SAVED_CONTRACT,
        contract_value: 1000,
        currency: 'USD',
      });
      await expect(
        service.update('contract-uuid', { contract_value: 5000 } as any, 'org-uuid'),
      ).resolves.toBeDefined();
      expect(mockContractRepository.save).toHaveBeenCalled();
    });

    it('rejects setting a value on an unpriced contract with no currency', async () => {
      mockQb.getOne.mockResolvedValue({
        ...SAVED_CONTRACT,
        contract_value: null,
        currency: null,
      });
      await expect(
        service.update('contract-uuid', { contract_value: 5000 } as any, 'org-uuid'),
      ).rejects.toThrow();
      expect(mockContractRepository.save).not.toHaveBeenCalled();
    });

    it('accepts value + currency together on an unpriced contract', async () => {
      mockQb.getOne.mockResolvedValue({
        ...SAVED_CONTRACT,
        contract_value: null,
        currency: null,
      });
      await expect(
        service.update('contract-uuid', {
          contract_value: 5000,
          currency: 'EUR',
        } as any, 'org-uuid'),
      ).resolves.toBeDefined();
      expect(mockContractRepository.save).toHaveBeenCalled();
    });
  });

  // ─── findById() — tenancy scoping + sensitive-field stripping (audit J.2 + K) ─
  // These tests exercise the in-process service logic against MOCKED repositories.
  // They prove (a) the org-scoping andWhere clause is wired, (b) a null queryBuilder
  // result throws NotFoundException, and (c) sensitive User fields are stripped
  // from creator/approver. They do NOT prove the SQL actually filters at the DB
  // layer — that needs the live runtime probe from audit section K to be re-run
  // against the patched endpoint. See 7.17 lesson #135 ("tests passing ≠ it works").

  describe('findById()', () => {
    it('returns the contract when the org matches', async () => {
      mockQb.getOne.mockResolvedValue(SAVED_CONTRACT);
      const result = await service.findById('contract-uuid', 'org-uuid');
      expect(result.id).toBe('contract-uuid');
    });

    it('applies the project.organization_id = :orgId filter on the contract→project join', async () => {
      mockQb.getOne.mockResolvedValue(SAVED_CONTRACT);
      await service.findById('contract-uuid', 'org-uuid');
      // Mirror of the same-file pattern at line 1126 in getPendingApprovalsForUser.
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'project.organization_id = :orgId',
        { orgId: 'org-uuid' },
      );
    });

    it('throws NotFoundException (NOT 403) when the contract is not in the caller org', async () => {
      // Cross-tenant read: the query returns no row because the andWhere filters it out.
      mockQb.getOne.mockResolvedValue(undefined);
      await expect(
        service.findById('contract-uuid', 'other-org-uuid'),
      ).rejects.toThrow('Contract not found');
    });

    it('strips password_hash and MFA secrets from the loaded creator relation', async () => {
      mockQb.getOne.mockResolvedValue({
        ...SAVED_CONTRACT,
        creator: {
          id: 'user-uuid',
          email: 'creator@org-a.test',
          first_name: 'Creator',
          last_name: 'User',
          password_hash: '$2b$10$REDACTED_BCRYPT_HASH',
          mfa_secret: 'mfa-secret-value',
          mfa_totp_secret: 'totp-secret-value',
          mfa_recovery_codes: ['code-1', 'code-2'],
          invitation_token: 'invite-token-value',
        },
      });

      const result = await service.findById('contract-uuid', 'org-uuid');

      expect(result.creator).toBeDefined();
      expect((result.creator as any).password_hash).toBeUndefined();
      expect((result.creator as any).mfa_secret).toBeUndefined();
      expect((result.creator as any).mfa_totp_secret).toBeUndefined();
      expect((result.creator as any).mfa_recovery_codes).toBeUndefined();
      expect((result.creator as any).invitation_token).toBeUndefined();
      // Non-sensitive fields must be preserved
      expect(result.creator.email).toBe('creator@org-a.test');
      expect(result.creator.first_name).toBe('Creator');
    });

    it('strips password_hash and MFA secrets from the loaded approver relation', async () => {
      mockQb.getOne.mockResolvedValue({
        ...SAVED_CONTRACT,
        approver: {
          id: 'approver-uuid',
          email: 'approver@org-a.test',
          password_hash: '$2b$10$REDACTED_BCRYPT_HASH',
          mfa_secret: 'mfa-secret-value',
          mfa_totp_secret: 'totp-secret-value',
          mfa_recovery_codes: ['code-1'],
          invitation_token: 'invite-token-value',
        },
      });

      const result = await service.findById('contract-uuid', 'org-uuid');

      expect(result.approver).toBeDefined();
      expect((result.approver as any).password_hash).toBeUndefined();
      expect((result.approver as any).mfa_secret).toBeUndefined();
      expect((result.approver as any).mfa_totp_secret).toBeUndefined();
      expect((result.approver as any).mfa_recovery_codes).toBeUndefined();
      expect((result.approver as any).invitation_token).toBeUndefined();
      expect((result.approver as any).email).toBe('approver@org-a.test');
    });

    it('does nothing when creator/approver relations are absent (no destructure crash)', async () => {
      mockQb.getOne.mockResolvedValue({ ...SAVED_CONTRACT }); // no creator/approver keys
      await expect(
        service.findById('contract-uuid', 'org-uuid'),
      ).resolves.toBeDefined();
    });
  });
});
