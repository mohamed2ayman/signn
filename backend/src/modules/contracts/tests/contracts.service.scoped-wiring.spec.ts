import { NotFoundException } from '@nestjs/common';

import { ContractsService } from '../contracts.service';
import { ContractStatus } from '../../../database/entities';

/**
 * Option B — S1: service-level WIRING proof for the Contract mutation paths.
 *
 * Proves the two layers coexist and BOTH fire on the four wired mutation
 * methods (update / updateStatus / updateParties / delete):
 *
 *   1. The WALL (findInOrg) fires FIRST. On a cross-tenant probe it 404s and
 *      the scoped load is never reached.
 *   2. The SCOPED REPO (scopedFindByIdOrThrow) is an INDEPENDENT gate. Even
 *      when the wall is satisfied, if the scoped load 404s the mutation does
 *      NOT proceed (no save / no remove). This is the defense-in-depth value:
 *      a future weakening of the wall cannot leak a cross-org write.
 *
 * Mocked manual-construction harness, mirroring contracts.service.access-wall.spec.ts.
 * The real-Postgres binding of the scoped repo itself is proven separately in
 * scoped-repository/tests/contract-scoped.repository.spec.ts.
 */
describe('ContractsService — Option B scoped-repo wiring (mutation paths)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';
  const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const noop = {} as any;

  function build(opts: {
    contractRepository?: any;
    collaborationGateway?: any;
    contractAccess: any;
    contractScoped: any;
  }): ContractsService {
    return new ContractsService(
      opts.contractRepository ?? noop, // contractRepository
      noop, // contractClauseRepository
      noop, // contractVersionRepository
      noop, // contractCommentRepository
      noop, // contractorResponseRepository
      noop, // projectRepository
      noop, // userRepository
      noop, // contractApproverRepository
      opts.collaborationGateway ?? { emitStatusChanged: jest.fn() }, // collaborationGateway
      noop, // contractTemplatesService
      noop, // emailService
      opts.contractAccess, // contractAccess (the wall)
      opts.contractScoped, // contractScoped (Option B chokepoint)
      noop, // contractVersionScoped (Option B S2a — unused by these ROOT mutations)
      noop, // contractorResponseScoped (Option B S2a — unused here)
      noop, // contractApproverScoped (Option B S2a — unused here)
      noop, // contractCommentScoped (Option B S2b — unused by these ROOT mutations)
      noop, // clauseRepository (2a — unused here)
      {} as any, // 19 relationshipTypes (T0a) — not exercised: no fixture passes relationship_type
    );
  }

  const reject404 = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = (val: any = {}) => jest.fn().mockResolvedValue(val);

  // ── update ────────────────────────────────────────────────────────────
  describe('update', () => {
    it('cross-tenant: WALL 404s FIRST; scoped load never reached, no save', async () => {
      const contractAccess = { findInOrg: reject404() };
      const contractScoped = { scopedFindByIdOrThrow: jest.fn() };
      const contractRepository = { save: jest.fn() };

      const svc = build({ contractAccess, contractScoped, contractRepository });

      await expect(
        svc.update(CONTRACT_IN_B, { name: 'x' } as any, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
      // Wall fired first — the scoped chokepoint and the write are never reached.
      expect(contractScoped.scopedFindByIdOrThrow).not.toHaveBeenCalled();
      expect(contractRepository.save).not.toHaveBeenCalled();
    });

    it('INDEPENDENT GATE: wall passes but scoped repo 404s → no save', async () => {
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractScoped = { scopedFindByIdOrThrow: reject404() };
      const contractRepository = { save: jest.fn() };

      const svc = build({ contractAccess, contractScoped, contractRepository });

      await expect(
        svc.update(CONTRACT_IN_A, { name: 'x' } as any, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      expect(contractScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(contractRepository.save).not.toHaveBeenCalled();
    });

    it('happy path: BOTH layers fire; the scoped row is the mutation target', async () => {
      const target = { id: CONTRACT_IN_A, name: 'old', pinned_version_id: null };
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractScoped = { scopedFindByIdOrThrow: resolve(target) };
      const contractRepository = {
        save: jest.fn(async (e: any) => e),
        // Slice 2 pin guard reads repo.manager.query on partial entities.
        manager: { query: jest.fn().mockResolvedValue([]) },
      };

      const svc = build({ contractAccess, contractScoped, contractRepository });

      await svc.update(CONTRACT_IN_A, { name: 'new' } as any, ORG_A);

      // Both layers fired.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      expect(contractScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      // The scoped repo's row was mutated and saved.
      expect(contractRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: CONTRACT_IN_A, name: 'new' }),
      );
    });
  });

  // ── delete ────────────────────────────────────────────────────────────
  describe('delete', () => {
    it('cross-tenant: WALL 404s FIRST; scoped load never reached, no remove', async () => {
      const contractAccess = { findInOrg: reject404() };
      const contractScoped = { scopedFindByIdOrThrow: jest.fn() };
      const contractRepository = { remove: jest.fn() };

      const svc = build({ contractAccess, contractScoped, contractRepository });

      await expect(svc.delete(CONTRACT_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(contractScoped.scopedFindByIdOrThrow).not.toHaveBeenCalled();
      expect(contractRepository.remove).not.toHaveBeenCalled();
    });

    it('INDEPENDENT GATE: wall passes but scoped repo 404s → no remove', async () => {
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractScoped = { scopedFindByIdOrThrow: reject404() };
      const contractRepository = { remove: jest.fn() };

      const svc = build({ contractAccess, contractScoped, contractRepository });

      await expect(svc.delete(CONTRACT_IN_A, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(contractRepository.remove).not.toHaveBeenCalled();
    });

    it('happy path: scoped DRAFT row is removed', async () => {
      const target = { id: CONTRACT_IN_A, status: ContractStatus.DRAFT };
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractScoped = { scopedFindByIdOrThrow: resolve(target) };
      const contractRepository = { remove: jest.fn().mockResolvedValue(undefined) };

      const svc = build({ contractAccess, contractScoped, contractRepository });
      await svc.delete(CONTRACT_IN_A, ORG_A);

      expect(contractRepository.remove).toHaveBeenCalledWith(target);
    });
  });

  // ── updateParties ───────────────────────────────────────────────────────
  describe('updateParties', () => {
    it('INDEPENDENT GATE: wall passes but scoped repo 404s → no save', async () => {
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractScoped = { scopedFindByIdOrThrow: reject404() };
      const contractRepository = { save: jest.fn() };

      const svc = build({ contractAccess, contractScoped, contractRepository });

      await expect(
        svc.updateParties(CONTRACT_IN_A, { party_first_name: 'X' }, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractRepository.save).not.toHaveBeenCalled();
    });
  });

  // ── updateStatus ─────────────────────────────────────────────────────────
  describe('updateStatus', () => {
    it('INDEPENDENT GATE: wall passes but scoped repo 404s → no save', async () => {
      const contractAccess = { findInOrg: resolve({ id: CONTRACT_IN_A }) };
      const contractScoped = { scopedFindByIdOrThrow: reject404() };
      const contractRepository = { save: jest.fn() };

      const svc = build({ contractAccess, contractScoped, contractRepository });

      await expect(
        svc.updateStatus(
          CONTRACT_IN_A,
          { status: ContractStatus.PENDING_APPROVAL } as any,
          USER_ID,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractRepository.save).not.toHaveBeenCalled();
    });
  });
});
