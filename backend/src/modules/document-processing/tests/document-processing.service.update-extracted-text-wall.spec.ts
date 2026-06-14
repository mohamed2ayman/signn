import { NotFoundException } from '@nestjs/common';

import { DocumentProcessingService } from '../document-processing.service';

/**
 * Option B — S2f Phase 1: the canonical access wall for
 * `DocumentProcessingService.updateExtractedText`.
 *
 * THE GAP (pre-fix, service.ts:659-672): updateExtractedText loaded with
 * `findOne({ id: docId, organization_id: orgId })` — gating ONLY on the
 * DENORMALIZED `organization_id` column, with NO `contractAccess.findInOrg`
 * canonical wall. Every other request-scoped DocumentUpload mutation walls the
 * canonical `doc.contract_id → findInOrg` (Tier 1/2, PR #45). This is the one
 * path whose tenancy authority is the drift column.
 *
 * RED form (the live gap): the denorm `organization_id` can DRIFT from the
 * canonical `contract → project → organization_id` truth (same drift class
 * S2c-1/S2e proved reachable). A document whose denorm `organization_id` reads
 * as the caller's org while its contract belongs to ANOTHER org is writable —
 * a cross-org write lands — because the denorm gate admits it and no canonical
 * wall re-checks. Against the pre-fix service these tests FAIL twice:
 * `findInOrg` is never called, and `save` IS called (the cross-org write
 * lands). Phase 1 adds the canonical wall → cross-org → 404, no write.
 *
 * This spec is a NEW file (the upload_extraction metering assertions in
 * `…access-wall.spec.ts` and the finalize_review assertions in
 * `finalize-review-metering.spec.ts` stay byte-identical — S2f keeps every
 * metering spec untouched).
 *
 * Phase 2 (the scoped layer underneath the wall) re-aims the load assertions
 * in this file from the bare repo to the scoped chokepoint while keeping the
 * live wall-denial assertion.
 */
describe('DocumentProcessingService.updateExtractedText — canonical access wall (S2f Phase 1)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_A = '11111111-1111-1111-1111-1111111111a1';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const DOC = '22222222-2222-2222-2222-222222222222';
  const noop = {} as any;

  function build({
    documentUploadRepository,
    contractAccess,
  }: {
    documentUploadRepository: any;
    contractAccess: any;
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
    );
  }

  it('cross-tenant (drifted denorm org): 404 from the canonical wall; NO cross-org write', async () => {
    // Drift: the denorm organization_id reads as the caller's org (ORG_A) but
    // the document's CONTRACT belongs to ORG_B. Pre-fix this is writable.
    const driftedDoc = {
      id: DOC,
      contract_id: CONTRACT_IN_B,
      organization_id: ORG_A, // drifted — denorm lies; contract is the truth
      extracted_text: 'original',
    };
    const documentUploadRepository = {
      findOne: jest.fn().mockResolvedValue(driftedDoc),
      save: jest.fn(),
    };
    const contractAccess = {
      // canonical truth: contract B is NOT in org A → 404
      findInOrg: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Contract not found')),
    };

    const svc = build({ documentUploadRepository, contractAccess });

    await expect(
      svc.updateExtractedText(DOC, ORG_A, 'attacker text'),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The wall walked the canonical doc.contract_id, NOT the denorm column.
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
    // CRITICAL: the cross-org write never lands.
    expect(documentUploadRepository.save).not.toHaveBeenCalled();
  });

  it('happy path: in-org caller — wall passes, extracted_text written', async () => {
    const doc = {
      id: DOC,
      contract_id: CONTRACT_IN_A,
      organization_id: ORG_A,
      extracted_text: 'original',
    };
    const documentUploadRepository = {
      findOne: jest.fn().mockResolvedValue(doc),
      save: jest.fn(async (entity: any) => entity),
    };
    const contractAccess = {
      findInOrg: jest.fn().mockResolvedValue({ id: CONTRACT_IN_A }),
    };

    const svc = build({ documentUploadRepository, contractAccess });

    const result = await svc.updateExtractedText(DOC, ORG_A, 'corrected text');

    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    const savedDoc = documentUploadRepository.save.mock.calls[0][0];
    expect(savedDoc.extracted_text).toBe('corrected text');
    expect(result.extracted_text).toBe('corrected text');
  });

  it('returns 404 if the document does not exist (pre-wall existence check)', async () => {
    const documentUploadRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    const contractAccess = { findInOrg: jest.fn() };

    const svc = build({ documentUploadRepository, contractAccess });

    await expect(
      svc.updateExtractedText('does-not-exist', ORG_A, 'text'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // No contract to resolve from a missing doc → wall not consulted.
    expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    expect(documentUploadRepository.save).not.toHaveBeenCalled();
  });
});
