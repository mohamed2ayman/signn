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
      // Slice 2: pin guard reads documentUploadRepository.manager.query.
      documentUploadRepository ?? ({ manager: { query: jest.fn().mockResolvedValue([]) } } as any),
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
      // Phase 7.18 Part 3 — MeteringService dep. These access-wall specs
      // assert the wall fires BEFORE any downstream work — including
      // reserve. A no-op stub suffices for the cross-tenant tests (the
      // wall rejects before reserve runs). For the happy-path tests, we
      // return a synthetic reservation handle so the code that reads
      // `reservation.reservation_id` to stamp the doc row doesn't crash.
      // The metering call is not under test in these specs (covered by
      // the engine spec); these specs are about the access wall.
      {
        reserve: jest.fn().mockResolvedValue({
          reservation_id: '00000000-0000-0000-0000-deadbeefcafe',
          ledger_id: '00000000-0000-0000-0000-feedfacecafe',
          subject_ref: 'test-subject',
          meter_key: 'upload_extraction',
          window_key: 'test-window',
          amount: 1,
          expires_at: new Date(Date.now() + 3600_000),
          reused: false,
        }),
        commit: jest.fn().mockResolvedValue({ applied: true, status: 'committed' }),
        release: jest.fn().mockResolvedValue({ applied: true, status: 'released' }),
      } as any,
      // Option B — S2f: DocumentUploadScopedRepository is now a REQUIRED dep.
      // None of these access-wall paths (uploadAndProcess / reprocess /
      // finalizeReview) loads via the scoped chokepoint, so this stub is never
      // invoked — it only satisfies the constructor (house plain-stub pattern).
      { scopedFind: jest.fn(), scopedFindByIdOrThrow: jest.fn() } as any,
      // Guest extraction completion (Slice 1) — userRepository (last ctor arg).
      // Not exercised by these access-wall paths; returns a MANAGING uploader if
      // ever reached so behaviour matches the pre-existing managing default.
      { findOne: jest.fn().mockResolvedValue({ account_type: 'MANAGING' }) } as any,
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
        // Slice 2: the pin guard reads repo.manager.query; [] = unpinned.
        manager: { query: jest.fn().mockResolvedValue([]) },
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
        // Phase 7.18 Part 3 — MeteringService dep (no-op stub).
        { reserve: jest.fn(), commit: jest.fn(), release: jest.fn() } as any,
        // Option B — S2f: DocumentUploadScopedRepository (required dep). reprocess
        // does NOT load via the scoped chokepoint, so this stub is never invoked.
        { scopedFind: jest.fn(), scopedFindByIdOrThrow: jest.fn() } as any,
        // Guest extraction (Slice 1) — userRepository (last ctor arg); unused here.
        { findOne: jest.fn().mockResolvedValue({ account_type: 'MANAGING' }) } as any,
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
        // Phase 7.18 Part 3 — MeteringService dep (no-op stub).
        { reserve: jest.fn(), commit: jest.fn(), release: jest.fn() } as any,
        // Option B — S2f: DocumentUploadScopedRepository (required dep). reprocess
        // does NOT load via the scoped chokepoint, so this stub is never invoked.
        { scopedFind: jest.fn(), scopedFindByIdOrThrow: jest.fn() } as any,
        // Guest extraction (Slice 1) — userRepository (last ctor arg); unused here.
        { findOne: jest.fn().mockResolvedValue({ account_type: 'MANAGING' }) } as any,
      );

      await expect(svc.reprocess('does-not-exist', ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });

    // ──────────────────────────────────────────────────────────────────
    // Phase 7.18 Part 3 — reprocess with a STILL-RESERVED prior:
    //
    // The bypassed-frontend / racing-double-click case where reprocess
    // lands on a doc whose prior reservation is still in `reserved`
    // state (work in flight). The defense-in-depth fix releases the
    // prior BEFORE issuing the new reserve so the per_contract window
    // doesn't temporally double-count.
    //
    // This test pins the CALL CONTRACT (which is what the consumer is
    // responsible for):
    //   1. release(prior_id) is called BEFORE reserve()
    //   2. release receives the OLD reservation_id, NOT the new one
    //   3. reserve takes a new reservation
    //   4. save persists the NEW reservation_id (overwriting the old)
    // The engine's actual "consumed refunded then incremented" balance
    // semantics are covered by the engine race-spec + the STEP 2 live
    // verification on this consumer (PR body, scenario (2)+(4)) — this
    // unit test isolates the consumer-side ordering invariant.
    // ──────────────────────────────────────────────────────────────────
    it('release-prior fix: still-reserved prior is released BEFORE the new reserve, with the old id', async () => {
      const OLD_RES = 'old-reservation-uuid';
      const NEW_RES = 'new-reservation-uuid';

      const documentUploadRepository = {
        findOne: jest.fn().mockResolvedValue({
          id: 'doc-in-flight',
          contract_id: 'contract-in-a',
          uploaded_by: USER_IN_A,
          processing_status: 'EXTRACTING_TEXT', // bypassed-frontend: in-progress
          reservation_id: OLD_RES,              // prior is still reserved
        }),
        save: jest.fn(async (entity: any) => entity),
        // Slice 2: the pin guard reads repo.manager.query; [] = unpinned.
        manager: { query: jest.fn().mockResolvedValue([]) },
      };
      const clauseRepository = { find: jest.fn().mockResolvedValue([]) };
      const contractClauseRepository = { delete: jest.fn() };
      const contractAccess = {
        findInOrg: jest.fn().mockResolvedValue({ id: 'contract-in-a' }),
      };

      // Track invocation order across the two metering methods.
      const calls: Array<{ method: 'release' | 'reserve'; arg?: string }> = [];
      const metering = {
        release: jest.fn(async (id: string) => {
          calls.push({ method: 'release', arg: id });
          // Engine returns applied:true for a real release of a still-
          // reserved prior. The consumer reads but does NOT branch on
          // applied — the contract is just "release was called".
          return { applied: true, status: 'released' };
        }),
        reserve: jest.fn(async () => {
          calls.push({ method: 'reserve' });
          return {
            reservation_id: NEW_RES,
            ledger_id: 'new-ledger-id',
            subject_ref: 'org-a',
            meter_key: 'upload_extraction',
            window_key: 'contract-in-a',
            amount: 1,
            expires_at: new Date(Date.now() + 3600_000),
            reused: false,
          };
        }),
        commit: jest.fn(),
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
        metering as any,
        // Option B — S2f: DocumentUploadScopedRepository (required dep). reprocess
        // does NOT load via the scoped chokepoint, so this stub is never invoked.
        { scopedFind: jest.fn(), scopedFindByIdOrThrow: jest.fn() } as any,
        // Guest extraction (Slice 1) — userRepository (last ctor arg); unused here.
        { findOne: jest.fn().mockResolvedValue({ account_type: 'MANAGING' }) } as any,
      );
      // Stub startTextExtraction so the test doesn't dispatch.
      (svc as any).startTextExtraction = jest.fn().mockResolvedValue(undefined);

      await svc.reprocess('doc-in-flight', ORG_A);

      // ── 1. release was called BEFORE reserve ──
      expect(calls.map((c) => c.method)).toEqual(['release', 'reserve']);

      // ── 2. release received the OLD reservation_id, NOT the new one ──
      expect(metering.release).toHaveBeenCalledWith(OLD_RES);
      expect(metering.release).toHaveBeenCalledTimes(1);

      // ── 3. reserve was called exactly once (the NEW intent) ──
      expect(metering.reserve).toHaveBeenCalledTimes(1);

      // ── 4. The persisted doc carries the NEW reservation_id ──
      const savedDoc = documentUploadRepository.save.mock.calls[0][0];
      expect(savedDoc.reservation_id).toBe(NEW_RES);
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
