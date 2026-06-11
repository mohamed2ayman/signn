import { NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';

import { ObligationsService } from '../obligations.service';

/**
 * Option B — S2c-2: the by-id MUTATION loads of ObligationsService go through
 * the scoped-repository tenancy chokepoint (layer 2), UNDER the #60 in-service
 * findInOrg wall (layer 1). Two checks, two layers — never a swap.
 *
 * RED FORM (wall-neutralized independent denial): these routes are already
 * #60-walled — `findById` loads, then walls the loaded row's contract via
 * findInOrg — so a cross-tenant probe through the normal path is denied by
 * the WALL and cannot reproduce a data-layer red. The red here therefore
 * NEUTRALIZES the wall (findInOrg always resolves — simulating a wall bug or
 * bypass) and demands the SCOPED LOAD deny independently. Pre-wire, the red
 * run proved the breach was real: with the wall neutralized, findById
 * returned the foreign row, update/complete saved it, and delete() genuinely
 * called repo.remove() on the foreign row. Post-wire, the scoped load 404s
 * first and no foreign row is ever hydrated or mutated.
 *
 * The service is constructed through an `any`-cast so the spec RUNS against
 * the pre-wire 2-arg constructor (true runtime red) instead of failing to
 * compile — same device obligations.service.id-walls.spec.ts documented for
 * the #60 red.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';
const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
const OBLIGATION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const OBLIGATION_IN_A = {
  id: OBLIGATION_ID,
  contract_id: CONTRACT_IN_A,
  description: 'Submit performance bond',
  status: 'PENDING',
};

const OBLIGATION_IN_B = {
  ...OBLIGATION_IN_A,
  contract_id: CONTRACT_IN_B,
};

/** #60 wall NEUTRALIZED — always passes. The scoped load must deny alone. */
function neutralizedWall() {
  return { findInOrg: jest.fn().mockResolvedValue({}) };
}

function buildRepo(row: any) {
  return {
    findOne: jest.fn().mockResolvedValue(row ? { ...row } : null),
    find: jest.fn().mockResolvedValue(row ? [{ ...row }] : []),
    save: jest.fn().mockImplementation(async (o: any) => o),
    remove: jest.fn().mockResolvedValue(undefined),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

/**
 * Scoped-repo mock with the REAL deny semantics: resolves only the
 * (OBLIGATION_ID, ORG_A) pair when the obligation is in-org; anything else
 * throws the no-existence-leak 404 — exactly what
 * ObligationScopedRepository.scopedFindByIdOrThrow does against Postgres
 * (proven in obligation-scoped.s2c1.repository.spec.ts).
 */
function buildScoped(inOrgRow: any | null) {
  return {
    scopedFindByIdOrThrow: jest
      .fn()
      .mockImplementation(async (id: string, orgId: string) => {
        if (inOrgRow && id === inOrgRow.id && orgId === ORG_A) {
          return { ...inOrgRow };
        }
        throw new NotFoundException('Obligation not found');
      }),
    scopedFind: jest.fn().mockResolvedValue(inOrgRow ? [{ ...inOrgRow }] : []),
  };
}

/** `any`-cast so the spec RUNS (red) against the pre-wire 2-arg constructor. */
function buildService(repo: any, wall: any, scoped: any): any {
  const Ctor: any = ObligationsService;
  return new Ctor(repo, wall, scoped);
}

describe('ObligationsService — S2c-2 scoped by-id loads (layer 2 under the #60 wall)', () => {
  beforeEach(jest.clearAllMocks);

  // ── findById — the shared by-id load ──────────────────────────────────────

  describe('findById()', () => {
    it('WALL-BYPASSED CROSS-TENANT READ: scoped load denies alone → 404, foreign row NEVER hydrated', async () => {
      // The bare repo would happily return the foreign row; the wall is
      // neutralized. Only the scoped load can stop this read.
      const repo = buildRepo(OBLIGATION_IN_B);
      const wall = neutralizedWall();
      const scoped = buildScoped(null); // obligation is NOT in org A
      const svc = buildService(repo, wall, scoped);

      await expect(svc.findById(OBLIGATION_ID, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ORG_A,
      );
      // The foreign row must never be hydrated into memory.
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('happy path: BOTH layers consulted — scoped load resolves, wall fires, hydrated row returned', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const wall = neutralizedWall();
      const scoped = buildScoped(OBLIGATION_IN_A);
      const svc = buildService(repo, wall, scoped);

      const result = await svc.findById(OBLIGATION_ID, ORG_A);

      // Layer 2 — the scoped tenancy load.
      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ORG_A,
      );
      // Layer 1 — the #60 wall STAYS, keyed on the scoped row's contract.
      expect(wall.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
      // Hydration runs on the tenancy-validated id (nested
      // contract_clause.clause exceeds scopedFind's single-level relations).
      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: OBLIGATION_ID } }),
      );
      expect(result).toMatchObject({ id: OBLIGATION_ID });
    });

    it('wall is NOT dead code: scoped load passes but wall denies → 404 (two layers, not a swap)', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const wall = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };
      const scoped = buildScoped(OBLIGATION_IN_A);
      const svc = buildService(repo, wall, scoped);

      await expect(svc.findById(OBLIGATION_ID, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(wall.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    });

    it('no-org caller → 404, neither layer consulted', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const wall = neutralizedWall();
      const scoped = buildScoped(OBLIGATION_IN_A);
      const svc = buildService(repo, wall, scoped);

      await expect(
        svc.findById(OBLIGATION_ID, undefined),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(scoped.scopedFindByIdOrThrow).not.toHaveBeenCalled();
      expect(wall.findInOrg).not.toHaveBeenCalled();
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── update / complete — write inheritors of the scoped findById ──────────

  describe('update()', () => {
    it('WALL-BYPASSED CROSS-TENANT WRITE: scoped load denies → 404, nothing saved', async () => {
      const repo = buildRepo(OBLIGATION_IN_B);
      const wall = neutralizedWall();
      const scoped = buildScoped(null);
      const svc = buildService(repo, wall, scoped);

      await expect(
        svc.update(OBLIGATION_ID, { description: 'hijacked' }, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('happy path: flows through the scoped findById, then saves', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const wall = neutralizedWall();
      const scoped = buildScoped(OBLIGATION_IN_A);
      const svc = buildService(repo, wall, scoped);

      await svc.update(OBLIGATION_ID, { description: 'amended' }, ORG_A);

      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ORG_A,
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'amended' }),
      );
    });
  });

  describe('complete()', () => {
    it('WALL-BYPASSED CROSS-TENANT WRITE: scoped load denies → 404, nothing saved', async () => {
      const repo = buildRepo(OBLIGATION_IN_B);
      const wall = neutralizedWall();
      const scoped = buildScoped(null);
      const svc = buildService(repo, wall, scoped);

      await expect(
        svc.complete(OBLIGATION_ID, USER_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  // ── delete — DESTRUCTIVE ──────────────────────────────────────────────────

  describe('delete()', () => {
    it('WALL-BYPASSED CROSS-TENANT DELETE: scoped load denies → 404, remove NEVER called (foreign row NOT removed)', async () => {
      // Pre-wire RED: with the wall neutralized, repo.remove() WAS called on
      // the foreign row — the destructive op genuinely executed. The scoped
      // load is what now stops it at the data layer.
      const repo = buildRepo(OBLIGATION_IN_B);
      const wall = neutralizedWall();
      const scoped = buildScoped(null);
      const svc = buildService(repo, wall, scoped);

      await expect(svc.delete(OBLIGATION_ID, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('happy path: in-org delete flows through the scoped findById, then removes', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const wall = neutralizedWall();
      const scoped = buildScoped(OBLIGATION_IN_A);
      const svc = buildService(repo, wall, scoped);

      await svc.delete(OBLIGATION_ID, ORG_A);

      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ORG_A,
      );
      expect(repo.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: OBLIGATION_ID }),
      );
    });
  });

  // ── findByContract — the S2c-2 TWO-STEP (tenancy via scopedFind, then
  //    nested hydration on the validated ids; base NOT grown) ───────────────

  describe('findByContract() — two-step nested hydrate', () => {
    it('step 1 tenancy via scopedFind, step 2 hydration keyed by the validated ids only', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const wall = neutralizedWall();
      const scoped = buildScoped(OBLIGATION_IN_A);
      const svc = buildService(repo, wall, scoped);

      const result = await svc.findByContract(CONTRACT_IN_A, ORG_A);

      // STEP 1 — the org-safe row set comes from the scoped chokepoint.
      expect(scoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_IN_A },
        ORG_A,
      );
      // STEP 2 — hydration (nested contract_clause.clause) runs ONLY against
      // the tenancy-validated ids, never re-keyed on raw request input.
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: In([OBLIGATION_ID]) },
          relations: ['contract_clause', 'contract_clause.clause', 'completer'],
          order: { due_date: 'ASC' },
        }),
      );
      expect(result).toEqual([expect.objectContaining({ id: OBLIGATION_ID })]);
    });

    it('WALL-BYPASSED CROSS-TENANT LIST: scopedFind returns [] → empty result, hydration NEVER runs', async () => {
      // Wall neutralized; the foreign contract's rows must be excluded by the
      // scoped list alone, and the bare hydration query must not run at all.
      const repo = buildRepo(OBLIGATION_IN_B);
      const wall = neutralizedWall();
      const scoped = buildScoped(null); // scopedFind → []
      const svc = buildService(repo, wall, scoped);

      const result = await svc.findByContract(CONTRACT_IN_B, ORG_A);

      expect(result).toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('S0 wall STAYS: cross-tenant contract → findInOrg 404 short-circuits before any load', async () => {
      const repo = buildRepo(OBLIGATION_IN_B);
      const wall = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };
      const scoped = buildScoped(OBLIGATION_IN_B);
      const svc = buildService(repo, wall, scoped);

      await expect(
        svc.findByContract(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(scoped.scopedFind).not.toHaveBeenCalled();
      expect(repo.find).not.toHaveBeenCalled();
    });
  });
});
