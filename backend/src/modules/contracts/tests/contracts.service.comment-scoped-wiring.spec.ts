import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { ContractsService } from '../contracts.service';

/**
 * Option B — S2b: service-level WIRING + ORDERING proof for the ContractComment
 * by-id MUTATION paths (resolveComment / updateComment / deleteComment).
 *
 * Each wired route now runs FOUR steps, in this exact order:
 *
 *   1. WALL      — `contractAccess.findInOrg(contractId, orgId)` (persona;
 *                  Tier 1 / S0, unchanged & independent). 404s cross-tenant.
 *   2. SCOPED    — `contractCommentScoped.scopedFindByIdViaContractOrThrow(
 *                  commentId, orgId, { contractIdOverride: contractId })`
 *                  (tenancy; Option B chokepoint). 404s cross-tenant
 *                  INDEPENDENTLY of the wall, BEFORE any author/permission check.
 *   3. AUTHOR/PERM — the EXISTING author (updateComment) or author-or-admin
 *                  (deleteComment) check. resolveComment has none.
 *   4. MUTATE    — save / remove via the plain comment repo.
 *
 * The lead proof (per the S2b prompt): a FOREIGNER gets 404 (steps 1/2) BEFORE
 * the author check ever runs — so save/remove is never reached cross-tenant and
 * there is no existence leak; an IN-ORG NON-AUTHOR gets 403 (step 3), AFTER the
 * 404 tenancy layer. An admin role cannot skip the org gate — proven both at the
 * wall and at the independent scoped layer.
 *
 * Mocked manual-construction harness, mirroring
 * contracts.service.scoped-wiring.spec.ts. The real-Postgres binding of the
 * comment scoped repo itself is proven in
 * scoped-repository/tests/contract-comment-scoped.s2b.repository.spec.ts.
 */
describe('ContractsService — Option B S2b comment scoped-repo wiring (by-id mutations)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const COMMENT_ID = '44444444-4444-4444-4444-444444444444';
  const AUTHOR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const OTHER_USER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const noop = {} as any;

  function build(opts: {
    contractAccess: any;
    contractCommentScoped: any;
    contractCommentRepository?: any;
    collaborationGateway?: any;
  }): ContractsService {
    return new ContractsService(
      noop, // contractRepository
      noop, // contractClauseRepository
      noop, // contractVersionRepository
      opts.contractCommentRepository ?? noop, // contractCommentRepository (save/remove only)
      noop, // contractorResponseRepository
      noop, // projectRepository
      noop, // userRepository
      noop, // contractApproverRepository
      opts.collaborationGateway ?? { emitCommentResolved: jest.fn() }, // collaborationGateway
      noop, // contractTemplatesService
      noop, // emailService
      opts.contractAccess, // contractAccess (the wall)
      noop, // contractScoped
      noop, // contractVersionScoped
      noop, // contractorResponseScoped
      noop, // contractApproverScoped
      opts.contractCommentScoped, // contractCommentScoped (Option B S2b chokepoint)
    );
  }

  const reject404 = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const reject404Comment = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Comment not found'));
  const resolve = (val: any = {}) => jest.fn().mockResolvedValue(val);

  // ───────────────────────────────────────────────────────────────────────
  // resolveComment (wall → scoped → mutate; NO author check)
  // ───────────────────────────────────────────────────────────────────────
  describe('resolveComment', () => {
    it('cross-tenant: WALL 404s FIRST; scoped load never reached, no save', async () => {
      const contractAccess = { findInOrg: reject404() };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: jest.fn() };
      const contractCommentRepository = { save: jest.fn() };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await expect(
        svc.resolveComment(CONTRACT_IN_B, COMMENT_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).not.toHaveBeenCalled();
      expect(contractCommentRepository.save).not.toHaveBeenCalled();
    });

    it('INDEPENDENT GATE: wall passes but scoped repo 404s → no save', async () => {
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: reject404Comment() };
      const contractCommentRepository = { save: jest.fn() };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await expect(
        svc.resolveComment(CONTRACT_IN_A, COMMENT_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).toHaveBeenCalledWith(
        COMMENT_ID,
        ORG_A,
        { contractIdOverride: CONTRACT_IN_A },
      );
      expect(contractCommentRepository.save).not.toHaveBeenCalled();
    });

    it('happy path: BOTH layers fire; the scoped row is flipped resolved', async () => {
      const comment = { id: COMMENT_ID, contract_id: CONTRACT_IN_A, is_resolved: false };
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: resolve(comment) };
      const contractCommentRepository = { save: jest.fn(async (e: any) => e) };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      const result = await svc.resolveComment(CONTRACT_IN_A, COMMENT_ID, ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).toHaveBeenCalledWith(
        COMMENT_ID,
        ORG_A,
        { contractIdOverride: CONTRACT_IN_A },
      );
      expect(result.is_resolved).toBe(true);
      expect(contractCommentRepository.save).toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // updateComment (wall → scoped → AUTHOR check → mutate) — S2b adds the wall
  // + orgId to a route that previously had NEITHER.
  // ───────────────────────────────────────────────────────────────────────
  describe('updateComment', () => {
    it('FOREIGNER: cross-tenant caller gets 404 (wall) — scoped + author never reached, no save', async () => {
      const contractAccess = { findInOrg: reject404() };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: jest.fn() };
      const contractCommentRepository = { save: jest.fn() };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await expect(
        svc.updateComment(CONTRACT_IN_B, COMMENT_ID, AUTHOR_ID, 'edited', ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).not.toHaveBeenCalled();
      expect(contractCommentRepository.save).not.toHaveBeenCalled();
    });

    it('FOREIGNER via the INDEPENDENT scoped gate: wall passes but scoped 404s → 404 BEFORE author check, no save', async () => {
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: reject404Comment() };
      const contractCommentRepository = { save: jest.fn() };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await expect(
        svc.updateComment(CONTRACT_IN_A, COMMENT_ID, AUTHOR_ID, 'edited', ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).toHaveBeenCalledWith(
        COMMENT_ID,
        ORG_A,
        { contractIdOverride: CONTRACT_IN_A },
      );
      expect(contractCommentRepository.save).not.toHaveBeenCalled();
    });

    it('IN-ORG NON-AUTHOR: 403 AFTER the 404 tenancy layer — no existence leak, no save', async () => {
      // The comment exists in the caller's org (scoped load succeeds), so the
      // tenancy layer returns it; the author check then denies a non-author.
      const comment = { id: COMMENT_ID, contract_id: CONTRACT_IN_A, user_id: OTHER_USER };
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: resolve(comment) };
      const contractCommentRepository = { save: jest.fn() };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await expect(
        svc.updateComment(CONTRACT_IN_A, COMMENT_ID, AUTHOR_ID, 'edited', ORG_A),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).toHaveBeenCalled();
      expect(contractCommentRepository.save).not.toHaveBeenCalled();
    });

    it('happy path: author edits their own in-org comment', async () => {
      const comment = { id: COMMENT_ID, contract_id: CONTRACT_IN_A, user_id: AUTHOR_ID, content: 'old' };
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: resolve(comment) };
      const contractCommentRepository = { save: jest.fn(async (e: any) => e) };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      const result = await svc.updateComment(CONTRACT_IN_A, COMMENT_ID, AUTHOR_ID, 'new', ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      expect(result.content).toBe('new');
      expect(contractCommentRepository.save).toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // deleteComment (wall → scoped → AUTHOR-OR-ADMIN check → remove)
  // ───────────────────────────────────────────────────────────────────────
  describe('deleteComment', () => {
    it('FOREIGNER: cross-tenant caller gets 404 (wall) — scoped never reached, no remove', async () => {
      const contractAccess = { findInOrg: reject404() };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: jest.fn() };
      const contractCommentRepository = { remove: jest.fn() };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await expect(
        svc.deleteComment(CONTRACT_IN_B, COMMENT_ID, AUTHOR_ID, 'CONTRACTOR_USER', ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).not.toHaveBeenCalled();
      expect(contractCommentRepository.remove).not.toHaveBeenCalled();
    });

    it('ADMIN BYPASS PROBE: a SYSTEM_ADMIN of org A is STILL 404 on an org-B comment — role cannot skip the org gate', async () => {
      // The wall is the first gate; an admin's authority is org-scoped. Even if
      // the wall were ever weakened, the INDEPENDENT scoped layer (next test)
      // denies the same way. Here the wall denies and the admin never reaches
      // the isAdmin bypass.
      const contractAccess = { findInOrg: reject404() };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: jest.fn() };
      const contractCommentRepository = { remove: jest.fn() };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await expect(
        svc.deleteComment(CONTRACT_IN_B, COMMENT_ID, AUTHOR_ID, 'SYSTEM_ADMIN', ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).not.toHaveBeenCalled();
      expect(contractCommentRepository.remove).not.toHaveBeenCalled();
    });

    it('ADMIN cannot skip the INDEPENDENT scoped gate: wall passes but scoped 404s → 404 BEFORE the isAdmin check, no remove', async () => {
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: reject404Comment() };
      const contractCommentRepository = { remove: jest.fn() };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await expect(
        svc.deleteComment(CONTRACT_IN_A, COMMENT_ID, AUTHOR_ID, 'SYSTEM_ADMIN', ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractCommentScoped.scopedFindByIdViaContractOrThrow).toHaveBeenCalledWith(
        COMMENT_ID,
        ORG_A,
        { contractIdOverride: CONTRACT_IN_A },
      );
      expect(contractCommentRepository.remove).not.toHaveBeenCalled();
    });

    it('IN-ORG NON-AUTHOR NON-ADMIN: 403 AFTER the 404 tenancy layer — no remove', async () => {
      const comment = { id: COMMENT_ID, contract_id: CONTRACT_IN_A, user_id: OTHER_USER };
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: resolve(comment) };
      const contractCommentRepository = { remove: jest.fn() };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await expect(
        svc.deleteComment(CONTRACT_IN_A, COMMENT_ID, AUTHOR_ID, 'CONTRACTOR_USER', ORG_A),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(contractCommentRepository.remove).not.toHaveBeenCalled();
    });

    it('happy path: in-org admin removes another user’s comment', async () => {
      const comment = { id: COMMENT_ID, contract_id: CONTRACT_IN_A, user_id: OTHER_USER };
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractCommentScoped = { scopedFindByIdViaContractOrThrow: resolve(comment) };
      const contractCommentRepository = { remove: jest.fn().mockResolvedValue(undefined) };

      const svc = build({ contractAccess, contractCommentScoped, contractCommentRepository });

      await svc.deleteComment(CONTRACT_IN_A, COMMENT_ID, AUTHOR_ID, 'OWNER_ADMIN', ORG_A);

      expect(contractCommentRepository.remove).toHaveBeenCalledWith(comment);
    });
  });
});
