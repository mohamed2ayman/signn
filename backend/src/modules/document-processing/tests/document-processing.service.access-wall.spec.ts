import { NotFoundException } from '@nestjs/common';

import { DocumentProcessingService } from '../document-processing.service';

/**
 * Tenant-isolation Tier 1 — service-level access-wall spec for the
 * three DocumentProcessingService entry points whose old `findOne({id})`
 * loads admitted cross-tenant probes:
 *
 *   - uploadAndProcess          (was: service.ts:74 — bare contract findOne)
 *   - reprocess                 (was: service.ts:530 — bare doc findOne; no orgId)
 *   - finalizeReview            (was: service.ts:640 — bare qb + AI dispatch
 *                                 under attacker's orgId; HIGHEST blast)
 *
 * Pattern: assemble the service manually with the minimum mocks each
 * method touches, so the spec runs without the @InjectRepository DI
 * machinery.
 */
describe('DocumentProcessingService — cross-tenant access wall (Tier 1)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const ORG_B = '00000000-0000-0000-0000-00000000000b';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const DOC_IN_B = '22222222-2222-2222-2222-222222222222';
  const USER_IN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const noop = {} as any;

  function build({
    contractAccess,
    documentUploadRepository,
    contractClauseRepository,
    storageService,
    aiService,
  }: {
    contractAccess: any;
    documentUploadRepository?: any;
    contractClauseRepository?: any;
    storageService?: any;
    aiService?: any;
  }): DocumentProcessingService {
    return new DocumentProcessingService(
      documentUploadRepository ?? noop,
      noop,
      contractClauseRepository ?? noop,
      noop,
      noop,
      noop,
      noop,
      storageService ?? noop,
      aiService ?? noop,
      noop,
      contractAccess,
    );
  }

  // ────────────────────────────────────────────────────────────────────
  // uploadAndProcess
  // ────────────────────────────────────────────────────────────────────
  describe('uploadAndProcess', () => {
    const file = {
      originalname: 'doc.pdf',
      mimetype: 'application/pdf',
      size: 1234,
    } as any;

    it('cross-tenant: 404 BEFORE storage upload or DocumentUpload save', async () => {
      const storageService = { uploadFile: jest.fn() };
      const documentUploadRepository = {
        create: jest.fn(),
        save: jest.fn(),
      };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({
        contractAccess,
        storageService,
        documentUploadRepository,
      });

      await expect(
        svc.uploadAndProcess(CONTRACT_IN_B, file, USER_IN_A, ORG_A, {}),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(storageService.uploadFile).not.toHaveBeenCalled();
      expect(documentUploadRepository.save).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, upload proceeds, DocumentUpload persisted', async () => {
      const storageService = {
        uploadFile: jest.fn(async () => ({
          file_url: 'http://storage/doc.pdf',
          file_name: 'doc.pdf',
        })),
      };
      const documentUploadRepository = {
        create: jest.fn((entity: any) => entity),
        save: jest.fn(async (entity: any) => ({ ...entity, id: 'doc-1' })),
      };
      const contractAccess = {
        findInOrg: jest.fn().mockResolvedValue({ id: 'contract-in-a' }),
      };

      const svc = build({
        contractAccess,
        storageService,
        documentUploadRepository,
      });
      (svc as any).startTextExtraction = jest
        .fn()
        .mockResolvedValue(undefined);

      const result = await svc.uploadAndProcess(
        'contract-in-a',
        file,
        USER_IN_A,
        ORG_A,
        {},
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(storageService.uploadFile).toHaveBeenCalled();
      const savedDoc = documentUploadRepository.save.mock.calls[0][0];
      expect(savedDoc.contract_id).toBe('contract-in-a');
      expect(savedDoc.organization_id).toBe(ORG_A);
      expect(result).toMatchObject({ id: 'doc-1' });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // reprocess
  //
  // Wall walks doc → contract_id → findInOrg. A cross-tenant caller who
  // knows a docId still gets 404 from the contract-wall (no cleanup
  // delete, no startTextExtraction dispatch).
  // ────────────────────────────────────────────────────────────────────
  describe('reprocess', () => {
    it('cross-tenant: 404 BEFORE any clause cleanup or restart', async () => {
      const documentUploadRepository = {
        findOne: jest.fn().mockResolvedValue({
          id: DOC_IN_B,
          contract_id: CONTRACT_IN_B,
          processing_status: 'FAILED',
        }),
        save: jest.fn(),
      };
      const clauseRepository = {
        find: jest.fn(),
        delete: jest.fn(),
      };
      const contractClauseRepository = {
        delete: jest.fn(),
      };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = new DocumentProcessingService(
        documentUploadRepository as any,
        clauseRepository as any,
        contractClauseRepository as any,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        contractAccess as any,
      );

      await expect(svc.reprocess(DOC_IN_B, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // No cleanup writes for a cross-tenant probe.
      expect(clauseRepository.delete).not.toHaveBeenCalled();
      expect(contractClauseRepository.delete).not.toHaveBeenCalled();
      expect(documentUploadRepository.save).not.toHaveBeenCalled();
    });

    it('returns 404 if doc itself does not exist (pre-wall existence check)', async () => {
      const documentUploadRepository = {
        findOne: jest.fn().mockResolvedValue(null),
      };
      const contractAccess = { findInOrg: jest.fn() };

      const svc = new DocumentProcessingService(
        documentUploadRepository as any,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        contractAccess as any,
      );

      await expect(svc.reprocess('does-not-exist', ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // finalizeReview — HIGHEST blast: AI dispatch under attacker's orgId
  // for foreign contracts. Wall must fire BEFORE any qb runs.
  // ────────────────────────────────────────────────────────────────────
  describe('finalizeReview', () => {
    it('cross-tenant: 404 BEFORE any qb run or AI dispatch', async () => {
      const contractClauseRepository = {
        createQueryBuilder: jest.fn(),
      };
      const aiService = {
        triggerRiskAnalysis: jest.fn(),
        triggerExtractObligations: jest.fn(),
        triggerConflictDetection: jest.fn(),
      };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({
        contractAccess,
        contractClauseRepository,
        aiService,
      });

      await expect(
        svc.finalizeReview(CONTRACT_IN_B, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // CRITICAL: no qb runs, NO AI dispatch under attacker's orgId.
      expect(contractClauseRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(aiService.triggerRiskAnalysis).not.toHaveBeenCalled();
      expect(aiService.triggerExtractObligations).not.toHaveBeenCalled();
      expect(aiService.triggerConflictDetection).not.toHaveBeenCalled();
    });

    it('happy path: in-org finalize runs (mocking AI returns)', async () => {
      // The qb returns no clauses → finalize completes without firing
      // conflict detection (single-doc case). We only need to assert
      // the wall passes and the AI risk/obligations dispatches fire.
      const qb: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      const contractClauseRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const aiService = {
        triggerRiskAnalysis: jest
          .fn()
          .mockResolvedValue({ job_id: 'risk-1', status: 'queued' }),
        triggerExtractObligations: jest
          .fn()
          .mockResolvedValue({ job_id: 'obl-1', status: 'queued' }),
        triggerConflictDetection: jest.fn(),
      };
      const contractAccess = {
        findInOrg: jest.fn().mockResolvedValue({ id: 'contract-in-a' }),
      };

      const svc = build({
        contractAccess,
        contractClauseRepository,
        aiService,
      });
      // pollAndSaveRisks fires-and-forgets; stub it so the test isn't
      // waiting on a real background poll.
      (svc as any).pollAndSaveRisks = jest.fn().mockResolvedValue(undefined);

      const result = await svc.finalizeReview('contract-in-a', ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(aiService.triggerRiskAnalysis).toHaveBeenCalled();
      expect(aiService.triggerExtractObligations).toHaveBeenCalled();
      expect(result).toMatchObject({
        risk_job_id: 'risk-1',
        obligations_job_id: 'obl-1',
      });
    });
  });
});
