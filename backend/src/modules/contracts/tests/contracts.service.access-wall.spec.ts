import { NotFoundException } from '@nestjs/common';

import { ContractsService } from '../contracts.service';

/**
 * Tenant-isolation Tier 1 — service-level access-wall spec for the
 * ContractsService WRITE paths that bypass `findById(id, orgId)`:
 *
 *   - updateContractClause   (bare findOne on cc; cross-org WRITE)
 *   - removeClause           (bare findOne on cc; cross-org WRITE)
 *   - reorderClauses         (bare update; cross-org WRITE)
 *   - saveNewVersion         (createVersionSnapshot bare findOne; cross-org WRITE)
 *   - resolveComment         (no author check; cross-org WRITE)
 *   - deleteComment          (admin bypass leaks cross-org)
 *
 * resolve/deleteComment also gained the Option B S2b scoped-repo load AFTER the
 * wall; these tests prove the WALL fires FIRST (the scoped load is never reached
 * cross-tenant). The full wall→scoped→author→mutate ordering is proven in
 * contracts.service.comment-scoped-wiring.spec.ts.
 *
 * Pattern: assemble ContractsService manually with stubbed deps. Only the
 * repos/services each method touches need real shape; everything else is
 * a noop.
 */
describe('ContractsService — cross-tenant access wall (Tier 1 WRITEs)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const ORG_B = '00000000-0000-0000-0000-00000000000b';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const CC_ID = '22222222-2222-2222-2222-222222222222';
  const CLAUSE_ID = '33333333-3333-3333-3333-333333333333';
  const COMMENT_ID = '44444444-4444-4444-4444-444444444444';
  const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const noop = {} as any;

  type Builder = {
    contractRepository?: any;
    contractClauseRepository?: any;
    contractVersionRepository?: any;
    contractCommentRepository?: any;
    contractApproverRepository?: any;
    userRepository?: any;
    collaborationGateway?: any;
    contractTemplatesService?: any;
    emailService?: any;
    contractAccess: any;
    // Option B S2b — resolve/deleteComment now load the comment through this
    // scoped repo AFTER the wall. The cross-tenant tests assert it is never
    // reached (wall fires first); the happy paths supply the comment via it.
    contractCommentScoped?: any;
  };

  function build(opts: Builder): ContractsService {
    return new ContractsService(
      opts.contractRepository ?? noop,
      opts.contractClauseRepository ?? noop,
      opts.contractVersionRepository ?? noop,
      opts.contractCommentRepository ?? noop,
      noop, // contractorResponseRepository
      noop, // projectRepository (S0)
      opts.userRepository ?? noop,
      opts.contractApproverRepository ?? noop,
      opts.collaborationGateway ?? { emitClauseAdded: jest.fn(), emitClauseUpdated: jest.fn(), emitClauseRemoved: jest.fn(), emitCommentResolved: jest.fn() },
      opts.contractTemplatesService ?? noop,
      opts.emailService ?? noop,
      opts.contractAccess,
      noop, // contractScoped (Option B — unused by these Tier 1 WRITE paths)
      noop, // contractVersionScoped (Option B S2a — unused here)
      noop, // contractorResponseScoped (Option B S2a — unused here)
      noop, // contractApproverScoped (Option B S2a — unused here)
      opts.contractCommentScoped ?? noop, // contractCommentScoped (Option B S2b)
      noop, // clauseRepository (2a — unused here)
    );
  }

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = (val: any = {}) => jest.fn().mockResolvedValue(val);

  // ────────────────────────────────────────────────────────────────────
  // updateContractClause
  // ────────────────────────────────────────────────────────────────────
  describe('updateContractClause', () => {
    it('cross-tenant: 404 BEFORE the cc lookup and BEFORE any mutation', async () => {
      const contractClauseRepository = {
        findOne: jest.fn(),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractClauseRepository, contractAccess });

      await expect(
        svc.updateContractClause(
          CONTRACT_IN_B,
          CC_ID,
          { order_index: 5 } as any,
          USER_ID,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // Wall fired before the cc lookup: no DB reads or writes on the
      // cross-tenant path.
      expect(contractClauseRepository.findOne).not.toHaveBeenCalled();
      expect(contractClauseRepository.save).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, cc updated', async () => {
      const cc = { id: CC_ID, contract_id: 'contract-in-a', order_index: 0 };
      const contractClauseRepository = {
        findOne: jest.fn().mockResolvedValue(cc),
        save: jest.fn(async (entity: any) => entity),
      };
      const contractVersionRepository = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({
        contractClauseRepository,
        contractVersionRepository,
        contractAccess,
      });
      // createVersionSnapshot is called best-effort; keep it from
      // touching repos by spying it out.
      (svc as any).createVersionSnapshot = jest
        .fn()
        .mockResolvedValue(undefined);

      const result = await svc.updateContractClause(
        'contract-in-a',
        CC_ID,
        { order_index: 5 } as any,
        USER_ID,
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(contractClauseRepository.save).toHaveBeenCalled();
      expect(result.order_index).toBe(5);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // removeClause
  // ────────────────────────────────────────────────────────────────────
  describe('removeClause', () => {
    it('cross-tenant: 404 BEFORE any deletion', async () => {
      const contractClauseRepository = {
        findOne: jest.fn(),
        remove: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractClauseRepository, contractAccess });

      await expect(
        svc.removeClause(CONTRACT_IN_B, CC_ID, USER_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractClauseRepository.findOne).not.toHaveBeenCalled();
      expect(contractClauseRepository.remove).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // reorderClauses
  // ────────────────────────────────────────────────────────────────────
  describe('reorderClauses', () => {
    it('cross-tenant: 404 BEFORE any order_index update', async () => {
      const contractClauseRepository = {
        update: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractClauseRepository, contractAccess });

      await expect(
        svc.reorderClauses(
          CONTRACT_IN_B,
          [{ id: CLAUSE_ID, order_index: 1 }],
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractClauseRepository.update).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, all order_index rows updated', async () => {
      const contractClauseRepository = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ contractClauseRepository, contractAccess });
      await svc.reorderClauses(
        'contract-in-a',
        [
          { id: 'cc-1', order_index: 1 },
          { id: 'cc-2', order_index: 2 },
        ],
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(contractClauseRepository.update).toHaveBeenCalledTimes(2);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // saveNewVersion (gates createVersionSnapshot)
  // ────────────────────────────────────────────────────────────────────
  describe('saveNewVersion', () => {
    it('cross-tenant: 404 BEFORE createVersionSnapshot fires', async () => {
      const contractAccess = { findInOrg: reject() };
      const svc = build({ contractAccess });

      // Spy createVersionSnapshot to confirm it's never reached.
      const snapshotSpy = jest.fn();
      (svc as any).createVersionSnapshot = snapshotSpy;

      await expect(
        svc.saveNewVersion(CONTRACT_IN_B, USER_ID, 'change-x', ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(snapshotSpy).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, createVersionSnapshot called', async () => {
      const contractAccess = { findInOrg: resolve() };
      const svc = build({ contractAccess });

      const snapshotSpy = jest
        .fn()
        .mockResolvedValue({ id: 'version-1' });
      (svc as any).createVersionSnapshot = snapshotSpy;

      const result = await svc.saveNewVersion(
        'contract-in-a',
        USER_ID,
        'change-x',
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(snapshotSpy).toHaveBeenCalled();
      expect(result).toEqual({ id: 'version-1' });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // resolveComment
  // ────────────────────────────────────────────────────────────────────
  describe('resolveComment', () => {
    it('cross-tenant: 404 BEFORE the scoped load / flip', async () => {
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: jest.fn() };
      const contractCommentRepository = { save: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractCommentScoped, contractCommentRepository, contractAccess });

      await expect(
        svc.resolveComment(CONTRACT_IN_B, COMMENT_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      // Wall fired first — the scoped chokepoint and the write are never reached.
      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).not.toHaveBeenCalled();
      expect(contractCommentRepository.save).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, comment flipped resolved', async () => {
      const comment = {
        id: COMMENT_ID,
        contract_id: 'contract-in-a',
        is_resolved: false,
      };
      const contractCommentScoped = {
        scopedFindByIdViaContractOrThrow: jest.fn().mockResolvedValue(comment),
      };
      const contractCommentRepository = {
        save: jest.fn(async (entity: any) => entity),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ contractCommentScoped, contractCommentRepository, contractAccess });
      const result = await svc.resolveComment(
        'contract-in-a',
        COMMENT_ID,
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      // Scoped load resolves the parent contract via the override (URL contract).
      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).toHaveBeenCalledWith(
        COMMENT_ID,
        ORG_A,
        { contractIdOverride: 'contract-in-a' },
      );
      expect(result.is_resolved).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // deleteComment — CRITICAL: pre-fix, an admin from any org could delete
  // a comment on any other org's contract via the `isAdmin` bypass.
  // ────────────────────────────────────────────────────────────────────
  describe('deleteComment (cross-org admin bypass — pre-fix exploit)', () => {
    it('cross-tenant SYSTEM_ADMIN: 404 BEFORE the scoped load', async () => {
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: jest.fn() };
      const contractCommentRepository = { remove: jest.fn() };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ contractCommentScoped, contractCommentRepository, contractAccess });

      await expect(
        svc.deleteComment(
          CONTRACT_IN_B,
          COMMENT_ID,
          USER_ID,
          'SYSTEM_ADMIN', // admin in caller's org, NOT in contract's org
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      // CRITICAL: pre-fix, the isAdmin bypass let this go through. With the wall
      // (and now the scoped load), the admin's authority is correctly org-scoped —
      // neither the scoped load nor the remove is reached.
      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).not.toHaveBeenCalled();
      expect(contractCommentRepository.remove).not.toHaveBeenCalled();
    });

    it('happy path: in-org SYSTEM_ADMIN, comment removed', async () => {
      const comment = {
        id: COMMENT_ID,
        contract_id: 'contract-in-a',
        user_id: 'other-user',
      };
      const contractCommentScoped = {
        scopedFindByIdViaContractOrThrow: jest.fn().mockResolvedValue(comment),
      };
      const contractCommentRepository = {
        remove: jest.fn().mockResolvedValue(undefined),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ contractCommentScoped, contractCommentRepository, contractAccess });
      await svc.deleteComment(
        'contract-in-a',
        COMMENT_ID,
        USER_ID,
        'SYSTEM_ADMIN',
        ORG_A,
      );

      expect(contractCommentRepository.remove).toHaveBeenCalledWith(comment);
    });
  });
});
