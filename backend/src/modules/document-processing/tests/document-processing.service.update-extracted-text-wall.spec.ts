import { NotFoundException } from '@nestjs/common';

import { DocumentProcessingService } from '../document-processing.service';

/**
 * Option B — S2f: tenancy spec for
 * `DocumentProcessingService.updateExtractedText` — two checks, two layers.
 *
 * THE GAP (pre-S2f, service.ts:659-672): updateExtractedText loaded with
 * `findOne({ id: docId, organization_id: orgId })` — gating ONLY on the
 * DENORMALIZED `organization_id` column, with NO canonical wall. The denorm
 * column can DRIFT from the canonical `contract → project → organization_id`
 * truth (the drift class S2c-1/S2e proved reachable): a document whose denorm
 * org reads as the caller's while its contract belongs to ANOTHER org was
 * writable — a cross-org write landed (this file's history captures the Phase 1
 * red→green: pre-fix the cross-org write landed and findInOrg was never called;
 * Phase 1 added the canonical wall → 404 + no write).
 *
 * S2f END STATE (Phase 2) — the two independent layers:
 *   layer 2 (tenancy — scoped chokepoint): `scopedFindByIdOrThrow` resolves the
 *     doc via the canonical document→contract→project→org join; cross-org → 404
 *     at the data layer (the denorm column is never consulted).
 *   layer 1 (persona — wall): `findInOrg` on the scoped row's canonical
 *     contract STAYS as live defense-in-depth.
 * Each layer denies cross-tenant INDEPENDENTLY (proven below). The bare
 * `documentUploadRepository` is only the SAVE handle now — the by-id LOAD moved
 * to the scoped chokepoint.
 *
 * This is a NEW file: the upload_extraction metering assertions
 * (`…access-wall.spec.ts`) and the finalize_review assertions
 * (`finalize-review-metering.spec.ts`) stay byte-identical — S2f keeps every
 * metering spec untouched.
 */
describe('DocumentProcessingService.updateExtractedText — tenancy (S2f, two layers)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_A = '11111111-1111-1111-1111-1111111111a1';
  const DOC = '22222222-2222-2222-2222-222222222222';
  const noop = {} as any;

  function build({
    documentUploadRepository,
    contractAccess,
    documentScoped,
  }: {
    documentUploadRepository: any;
    contractAccess: any;
    documentScoped: any;
  }): DocumentProcessingService {
    return new DocumentProcessingService(
      documentUploadRepository,
      noop, // clauseRepository
      noop, // contractClauseRepository
      noop, // contractRepository
      noop, // riskAnalysisRepository
      noop, // auditLogRepository
      noop, // riskCategoryRepository
      noop, // storageService
      noop, // aiService
      noop, // riskResolver
      contractAccess,
      // MeteringService — updateExtractedText does not touch metering.
      { reserve: jest.fn(), commit: jest.fn(), release: jest.fn() } as any,
      // Option B — S2f scoped chokepoint (the by-id LOAD layer).
      documentScoped,
      // Guest extraction completion (Slice 1) — userRepository (last ctor arg);
      // updateExtractedText never reaches the advance core, so it is never invoked.
      { findOne: jest.fn().mockResolvedValue({ account_type: 'MANAGING' }) } as any,
    );
  }

  it('cross-tenant (scoped layer denies): 404 from the data layer; NO write; wall not reached', async () => {
    const documentUploadRepository = { save: jest.fn() };
    // layer 2 denies: the canonical join finds no row for this org → 404.
    const documentScoped = {
      scopedFindByIdOrThrow: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Document not found')),
    };
    const contractAccess = { findInOrg: jest.fn() };

    const svc = build({ documentUploadRepository, contractAccess, documentScoped });

    await expect(
      svc.updateExtractedText(DOC, ORG_A, 'attacker text'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(documentScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(DOC, ORG_A);
    // Scoped denial short-circuits before the wall and before any write.
    expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    expect(documentUploadRepository.save).not.toHaveBeenCalled();
  });

  it('LIVE WALL-DENIAL: scoped resolves but the wall denies the canonical contract → 404; NO write', async () => {
    // Defense-in-depth: even if the scoped layer returned a row, the wall is an
    // independent gate on the row's canonical contract. This is the dead-code
    // check — the wall must stay live.
    const scopedRow = {
      id: DOC,
      contract_id: CONTRACT_IN_A,
      extracted_text: 'original',
    };
    const documentUploadRepository = { save: jest.fn() };
    const documentScoped = {
      scopedFindByIdOrThrow: jest.fn().mockResolvedValue(scopedRow),
    };
    const contractAccess = {
      findInOrg: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Contract not found')),
    };

    const svc = build({ documentUploadRepository, contractAccess, documentScoped });

    await expect(
      svc.updateExtractedText(DOC, ORG_A, 'attacker text'),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The wall walked the scoped row's canonical contract_id.
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    expect(documentUploadRepository.save).not.toHaveBeenCalled();
  });

  it('happy path: scoped resolves + wall passes → extracted_text written', async () => {
    const scopedRow = {
      id: DOC,
      contract_id: CONTRACT_IN_A,
      extracted_text: 'original',
    };
    const documentUploadRepository = {
      save: jest.fn(async (entity: any) => entity),
    };
    const documentScoped = {
      scopedFindByIdOrThrow: jest.fn().mockResolvedValue(scopedRow),
    };
    const contractAccess = {
      findInOrg: jest.fn().mockResolvedValue({ id: CONTRACT_IN_A }),
    };

    const svc = build({ documentUploadRepository, contractAccess, documentScoped });

    const result = await svc.updateExtractedText(DOC, ORG_A, 'corrected text');

    expect(documentScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(DOC, ORG_A);
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    const savedDoc = documentUploadRepository.save.mock.calls[0][0];
    expect(savedDoc.extracted_text).toBe('corrected text');
    expect(result.extracted_text).toBe('corrected text');
  });
});
