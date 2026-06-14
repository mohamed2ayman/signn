import { NotFoundException } from '@nestjs/common';

import { ClaimsService } from '../claims.service';
import { ContractStatus } from '../../../database/entities';
import { ClaimStatus } from '../../../database/entities/claim.entity';

/**
 * Tenant-isolation Tier 3 — service-level access-wall spec for the
 * ClaimsService entry points that previously did a bare findOne on
 * `contract_id`:
 *
 *   - create               (POST /claims)
 *   - findAllByContract    (GET  /claims?contract_id=)
 *
 * Pattern matches Tier 1/2: assemble ClaimsService with stubbed deps,
 * exercise cross-org → 404 (NotFoundException, NOT 403 — no existence
 * leak) and in-org → success. The wall fires BEFORE any downstream
 * read or write — claim repo is never touched on the cross-tenant path.
 *
 * S2e RE-AIM: the LIST read (findAllByContract) now sources its rows from the
 * scoped chokepoint (ClaimScopedRepository.scopedFind — layer 2) AFTER the
 * Tier 3 findInOrg wall (layer 1, FIRST — also the status source). The wall
 * stays the first gate on the list path; a cross-tenant probe is still denied
 * by the WALL before scopedFind is reached. The in-org assertion moved from the
 * bare claimRepo.find to scopedFind. create() is UNCHANGED (wall-only stop-gap).
 */
describe('ClaimsService — cross-tenant access wall (Tier 3 → S2e scoped list)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const ORG_B = '00000000-0000-0000-0000-00000000000b';
  const CONTRACT_IN_A = '11111111-1111-1111-1111-1111111111a1';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const noop = {} as any;

  type Builder = {
    claimRepo?: any;
    claimDocumentRepo?: any;
    claimResponseRepo?: any;
    claimStatusLogRepo?: any;
    contractRepo?: any;
    contractAccess: any;
    claimScoped?: any;
  };

  function build(opts: Builder): ClaimsService {
    // `any`-cast Ctor — the scoped repo is appended as the last constructor arg.
    const Ctor: any = ClaimsService;
    return new Ctor(
      opts.claimRepo ?? noop,
      opts.claimDocumentRepo ?? noop,
      opts.claimResponseRepo ?? noop,
      opts.claimStatusLogRepo ?? noop,
      opts.contractRepo ?? noop,
      opts.contractAccess,
      opts.claimScoped ?? { scopedFind: jest.fn().mockResolvedValue([]) },
    );
  }

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = (val: any = { id: CONTRACT_IN_A, status: ContractStatus.ACTIVE }) =>
    jest.fn().mockResolvedValue(val);

  // ────────────────────────────────────────────────────────────────────
  // create — POST /claims
  // ────────────────────────────────────────────────────────────────────
  describe('create (POST /claims)', () => {
    it('cross-tenant: 404 BEFORE any claim row is touched', async () => {
      const claimRepo = {
        count: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      };
      const contractAccess = { findInOrg: reject() };

      const svc = build({ claimRepo, contractAccess });

      await expect(
        svc.create(
          {
            contract_id: CONTRACT_IN_B, // foreign contract
            claim_type: 'TIME_EXTENSION',
            title: 'x',
            description: 'x',
            event_date: '2026-06-07',
          } as any,
          USER_ID,
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // Wall fired first — no count, no create, no save.
      expect(claimRepo.count).not.toHaveBeenCalled();
      expect(claimRepo.create).not.toHaveBeenCalled();
      expect(claimRepo.save).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, claim row saved with reference', async () => {
      const claimRepo = {
        count: jest.fn().mockResolvedValue(2),
        create: jest.fn((entity: any) => entity),
        save: jest.fn(async (entity: any) => ({ ...entity, id: 'new-claim' })),
      };
      const contractAccess = { findInOrg: resolve() };

      const svc = build({ claimRepo, contractAccess });

      const result = await svc.create(
        {
          contract_id: CONTRACT_IN_A,
          claim_type: 'TIME_EXTENSION',
          title: 't',
          description: 'd',
          event_date: '2026-06-07',
        } as any,
        USER_ID,
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(claimRepo.save).toHaveBeenCalled();
      expect(result).toEqual(
        expect.objectContaining({
          claim_reference: 'CLM-003',
          contract_id: CONTRACT_IN_A,
          org_id: ORG_A,
          submitted_by: USER_ID,
          status: ClaimStatus.DRAFT,
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // findAllByContract — GET /claims?contract_id=
  // ────────────────────────────────────────────────────────────────────
  describe('findAllByContract (GET /claims?contract_id=)', () => {
    it('cross-tenant: wall 404s FIRST — scoped list never runs', async () => {
      const claimRepo = { find: jest.fn() };
      const contractAccess = { findInOrg: reject() };
      const claimScoped = { scopedFind: jest.fn() };

      const svc = build({ claimRepo, contractAccess, claimScoped });

      await expect(
        svc.findAllByContract(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // Cross-tenant probe: zero rows ever loaded from the victim org, and the
      // scoped chokepoint (layer 2) is never reached.
      expect(claimRepo.find).not.toHaveBeenCalled();
      expect(claimScoped.scopedFind).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, claims returned from the scoped list (layer 2)', async () => {
      const CLAIMS = [
        { id: 'c1', contract_id: CONTRACT_IN_A },
        { id: 'c2', contract_id: CONTRACT_IN_A },
      ];
      const claimRepo = { find: jest.fn() };
      const contractAccess = { findInOrg: resolve() };
      const claimScoped = { scopedFind: jest.fn().mockResolvedValue(CLAIMS) };

      const svc = build({ claimRepo, contractAccess, claimScoped });
      const result = await svc.findAllByContract(CONTRACT_IN_A, ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      // Layer 2 — the scoped chokepoint sourced the rows (single-level
      // relations/order preserved). The bare repo find is no longer used.
      expect(claimScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_IN_A },
        ORG_A,
        { relations: ['submitter', 'documents'], order: { created_at: 'DESC' } },
      );
      expect(claimRepo.find).not.toHaveBeenCalled();
      expect(result).toEqual(CLAIMS);
    });
  });
});
