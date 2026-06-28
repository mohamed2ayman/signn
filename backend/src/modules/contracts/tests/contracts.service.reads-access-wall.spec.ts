import { NotFoundException } from '@nestjs/common';

import { ContractsService } from '../contracts.service';

/**
 * Tenant-isolation Tier 2 — access-wall spec for the ContractsService READ
 * side-paths. Sister spec to the Tier 1 file
 * (`contracts.service.access-wall.spec.ts`); together they cover every
 * contract-scoped ContractsService method.
 *
 * Routes covered:
 *
 *   GET /contracts/:id/clauses                      (getContractClauses)
 *   GET /contracts/:id/versions                     (getVersions)
 *   GET /contracts/:id/versions/milestones          (getMilestoneVersions)
 *   GET /contracts/:id/versions/:versionId          (getVersion)
 *   GET /contracts/:id/versions/:a/compare/:b       (compareVersions)
 *   GET /contracts/:id/comments                     (getComments)
 *   GET /contracts/:id/responses                    (getContractorResponses)
 *   GET /contracts/:id/approvers                    (getApprovers)
 *
 * All eight are contractId-direct (URL `:id` is the wall key). The
 * `:versionId` and clause-id child segments inside the version routes are
 * NOT the wall key — the service's existing `contract_id` join in the
 * version load already enforces version-belongs-to-contract; the new wall
 * on URL contractId closes the cross-tenant-contract half.
 */
describe('ContractsService — Tier 2 READ access wall', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const VERSION_ID = '33333333-3333-3333-3333-333333333333';
  const noop = {} as any;

  type Builder = {
    contractClauseRepository?: any;
    contractVersionRepository?: any;
    contractCommentRepository?: any;
    contractorResponseRepository?: any;
    contractApproverRepository?: any;
    // Option B S2a — the rewired LIST reads now load through these scoped repos.
    contractVersionScoped?: any;
    contractorResponseScoped?: any;
    contractApproverScoped?: any;
    contractAccess: any;
  };

  function build(opts: Builder): ContractsService {
    return new ContractsService(
      noop, // contractRepository
      opts.contractClauseRepository ?? noop,
      opts.contractVersionRepository ?? noop,
      opts.contractCommentRepository ?? noop,
      opts.contractorResponseRepository ?? noop,
      noop, // projectRepository (S0)
      noop, // userRepository
      opts.contractApproverRepository ?? noop,
      noop, // collaborationGateway
      noop, // contractTemplatesService
      noop, // emailService
      opts.contractAccess,
      noop, // contractScoped (Option B — unused by these Tier 2 READ paths)
      opts.contractVersionScoped ?? noop, // Option B S2a
      opts.contractorResponseScoped ?? noop, // Option B S2a
      opts.contractApproverScoped ?? noop, // Option B S2a
      noop, // contractCommentScoped (Option B S2b — unused by these Tier 2 READ paths)
      noop, // clauseRepository (2a — unused here)
    );
  }

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = (val: any = {}) => jest.fn().mockResolvedValue(val);

  // ────────────────────────────────────────────────────────────────────
  // getContractClauses
  // ────────────────────────────────────────────────────────────────────
  describe('getContractClauses', () => {
    it('cross-tenant: 404 BEFORE the find runs', async () => {
      const contractClauseRepository = { find: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractClauseRepository, contractAccess });

      await expect(
        svc.getContractClauses(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractClauseRepository.find).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, clauses returned', async () => {
      const rows = [{ id: 'cc-1' }];
      const contractClauseRepository = {
        find: jest.fn().mockResolvedValue(rows),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ contractClauseRepository, contractAccess });

      const result = await svc.getContractClauses('contract-in-a', ORG_A);
      expect(result).toEqual(rows);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // getVersions + getMilestoneVersions
  // ────────────────────────────────────────────────────────────────────
  describe.each([
    [
      'getVersions',
      (svc: ContractsService, contractId: string, orgId: string) =>
        svc.getVersions(contractId, orgId),
    ],
    [
      'getMilestoneVersions',
      (svc: ContractsService, contractId: string, orgId: string) =>
        svc.getMilestoneVersions(contractId, orgId),
    ],
  ])('%s', (_label, invoke) => {
    it('cross-tenant: 404 BEFORE the scoped load runs', async () => {
      const contractVersionScoped = { scopedFind: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractVersionScoped, contractAccess });

      await expect(
        invoke(svc, CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      // WALL fires first; the Option B scoped LIST load is never reached.
      expect(contractVersionScoped.scopedFind).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // getVersion — versioned child path, but URL :id is the wall key.
  // ────────────────────────────────────────────────────────────────────
  describe('getVersion', () => {
    it('cross-tenant URL contractId: 404 BEFORE any version load', async () => {
      const contractVersionRepository = { findOne: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractVersionRepository, contractAccess });

      await expect(
        svc.getVersion(CONTRACT_IN_B, VERSION_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractVersionRepository.findOne).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, version returned (existing contract_id join still enforced)', async () => {
      const version = {
        id: VERSION_ID,
        contract_id: 'contract-in-a',
        version_number: 2,
      };
      const contractVersionRepository = {
        findOne: jest.fn().mockResolvedValue(version),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ contractVersionRepository, contractAccess });

      const result = await svc.getVersion(
        'contract-in-a',
        VERSION_ID,
        ORG_A,
      );
      expect(contractVersionRepository.findOne).toHaveBeenCalledWith({
        where: { id: VERSION_ID, contract_id: 'contract-in-a' },
        relations: ['creator', 'triggered_by_user'],
      });
      expect(result).toEqual(version);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // compareVersions — calls getVersion twice; outer wall fires first.
  // ────────────────────────────────────────────────────────────────────
  describe('compareVersions', () => {
    it('cross-tenant URL contractId: 404 BEFORE either inner version load', async () => {
      const contractVersionRepository = { findOne: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractVersionRepository, contractAccess });

      await expect(
        svc.compareVersions(
          CONTRACT_IN_B,
          'version-a',
          'version-b',
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractVersionRepository.findOne).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // getComments
  // ────────────────────────────────────────────────────────────────────
  describe('getComments', () => {
    it('cross-tenant: 404 BEFORE the qb runs', async () => {
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
      };
      const contractCommentRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractCommentRepository, contractAccess });

      await expect(
        svc.getComments(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractCommentRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // getContractorResponses
  // ────────────────────────────────────────────────────────────────────
  describe('getContractorResponses', () => {
    it('cross-tenant: 404 BEFORE the scoped load runs', async () => {
      const contractorResponseScoped = { scopedFind: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractorResponseScoped, contractAccess });

      await expect(
        svc.getContractorResponses(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractorResponseScoped.scopedFind).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // getApprovers
  // ────────────────────────────────────────────────────────────────────
  describe('getApprovers', () => {
    it('cross-tenant: 404 BEFORE the scoped load runs', async () => {
      const contractApproverScoped = { scopedFind: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractApproverScoped, contractAccess });

      await expect(
        svc.getApprovers(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractApproverScoped.scopedFind).not.toHaveBeenCalled();
    });

    it('happy path: WALL fires AND the scoped LIST load returns the rows', async () => {
      const rows = [{ id: 'app-1' }];
      const contractApproverScoped = {
        scopedFind: jest.fn().mockResolvedValue(rows),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ contractApproverScoped, contractAccess });

      const result = await svc.getApprovers('contract-in-a', ORG_A);
      // Both layers fire: the wall, then the scoped child LIST load.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith('contract-in-a', ORG_A);
      expect(contractApproverScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: 'contract-in-a' },
        ORG_A,
        { relations: ['user'], order: { assigned_at: 'ASC' } },
      );
      expect(result).toEqual(rows);
    });
  });
});
