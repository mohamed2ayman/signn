import { NotFoundException } from '@nestjs/common';

import { DocumentProcessingService } from '../document-processing.service';

/**
 * Tenant-isolation Tier 2 — service-level access-wall spec for the READ
 * paths in DocumentProcessingService. Sister spec to the Tier 1 file
 * (`document-processing.service.access-wall.spec.ts`); the two together
 * cover every contract-scoped DocumentProcessingService method.
 *
 * Routes covered (true-key per row):
 *
 *   - getDocuments(contractId, orgId)          contractId direct
 *   - pollAndAdvance(docId, orgId)             CHILD-keyed via docId
 *   - getDocumentStatus(docId, orgId)          CHILD-keyed via docId (defence
 *                                              in depth — controller routes
 *                                              go through pollAndAdvance)
 *   - getClausesForReview(contractId, orgId)   contractId direct
 *
 * For CHILD-keyed routes the wall walks `doc.contract_id → findInOrg(_, orgId)`
 * — the URL `:contractId` is NEVER trusted, per the PR #45 lesson.
 */
describe('DocumentProcessingService — Tier 2 READ access wall', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const ORG_B = '00000000-0000-0000-0000-00000000000b';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const DOC_IN_B = '22222222-2222-2222-2222-222222222222';
  const noop = {} as any;

  function build({
    documentUploadRepository,
    contractClauseRepository,
    contractAccess,
  }: {
    documentUploadRepository?: any;
    contractClauseRepository?: any;
    contractAccess: any;
  }): DocumentProcessingService {
    return new DocumentProcessingService(
      documentUploadRepository ?? noop,
      noop,
      contractClauseRepository ?? noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      noop,
      contractAccess,
      // Phase 7.18 Part 3 — MeteringService dep. These read-side specs
      // don't exercise reserve/commit/release; no-op stub is sufficient.
      { reserve: jest.fn(), commit: jest.fn(), release: jest.fn() } as any,
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // getDocuments — contractId direct
  // ────────────────────────────────────────────────────────────────────
  describe('getDocuments (contractId direct)', () => {
    it('cross-tenant: 404 BEFORE the repository.find runs', async () => {
      const documentUploadRepository = { find: jest.fn() };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ documentUploadRepository, contractAccess });

      await expect(
        svc.getDocuments(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(documentUploadRepository.find).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, docs returned', async () => {
      const docs = [{ id: 'doc-1' }];
      const documentUploadRepository = {
        find: jest.fn().mockResolvedValue(docs),
      };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({ documentUploadRepository, contractAccess });

      const result = await svc.getDocuments('contract-in-a', ORG_A);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(result).toEqual(docs);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // pollAndAdvance — CHILD-keyed via docId. Proves the URL `:contractId`
  // is irrelevant and the doc's real contract_id is the wall key.
  // ────────────────────────────────────────────────────────────────────
  describe('pollAndAdvance (CHILD-keyed)', () => {
    it('cross-tenant: caller in org A with a foreign docId from org B → 404; doc.contract_id is the wall key', async () => {
      const foreignDoc = {
        id: DOC_IN_B,
        contract_id: CONTRACT_IN_B,
        organization_id: ORG_B,
        processing_status: 'COMPLETED',
        file_name: 'org-b-secret.pdf',
      };
      const documentUploadRepository = {
        findOne: jest.fn().mockResolvedValue(foreignDoc),
      };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ documentUploadRepository, contractAccess });

      await expect(svc.pollAndAdvance(DOC_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      // Wall walked `doc.contract_id`, NOT a URL contractId.
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
    });

    it('returns 404 if doc itself does not exist (pre-wall existence check)', async () => {
      const documentUploadRepository = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      const contractAccess = { findInOrg: jest.fn() };

      const svc = build({ documentUploadRepository, contractAccess });

      await expect(
        svc.pollAndAdvance('does-not-exist', ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // getDocumentStatus — CHILD-keyed. Same shape as pollAndAdvance, but
  // covers the dead-code path (defence in depth).
  // ────────────────────────────────────────────────────────────────────
  describe('getDocumentStatus (CHILD-keyed; defence-in-depth)', () => {
    it('cross-tenant: 404 — foreign doc.contract_id walls', async () => {
      const foreignDoc = {
        id: DOC_IN_B,
        contract_id: CONTRACT_IN_B,
        organization_id: ORG_B,
      };
      const documentUploadRepository = {
        findOne: jest.fn().mockResolvedValue(foreignDoc),
      };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ documentUploadRepository, contractAccess });

      await expect(
        svc.getDocumentStatus(DOC_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // getClausesForReview — contractId direct
  // ────────────────────────────────────────────────────────────────────
  describe('getClausesForReview (contractId direct)', () => {
    it('cross-tenant: 404 BEFORE the qb runs', async () => {
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
      };
      const contractClauseRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ contractClauseRepository, contractAccess });

      await expect(
        svc.getClausesForReview(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractClauseRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
