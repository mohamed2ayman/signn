import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { DocumentUpload } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2f: DocumentUpload scoped repository.
 *
 * DocumentUpload was the one drift-four entity STOPPED in S2e: its
 * `updateExtractedText` path gated on the DENORMALIZED `organization_id` column
 * only, with no findInOrg wall to layer under — so absorbing it then would have
 * been a denorm→canonical SWAP, not a two-layer add. S2f does it in two steps:
 * Phase 1 added the canonical `findInOrg` wall to the gap; THIS class is the
 * Phase 2 scoped chokepoint that goes UNDERNEATH that wall.
 *
 * Resolves org via the canonical `document_upload → contract → project →
 * organization_id` chain ONLY (Ayman B spec Q1). DocumentUpload DOES carry a
 * denormalized `organization_id` column (the column the pre-S2f gap trusted),
 * but it is NEVER part of the resolution path here — it is non-authoritative and
 * can drift; the `contract_id` FK is the tenancy truth. Proven by the
 * drifted-organization_id probe in document-upload-scoped.s2f.repository.spec.ts.
 *
 * GATE-ALIAS NOTE (same deliberate deviation as Obligation/Risk scoped repos):
 * the org-gate joins are aliased `org_gate_contract` / `org_gate_project` so the
 * base's scopedFind relation-hydration (`leftJoinAndSelect('document.<rel>',
 * '<rel>')`) can never collide with the gate join. None of the S2f-wired reads
 * request a `contract` / `project` relation through scopedFind, but the distinct
 * gate aliases keep the tenancy gate independent regardless.
 *
 * S2f wires:
 *   - DocumentProcessingService.getDocuments       (LIST: scopedFind, ordered)
 *   - DocumentProcessingService.updateExtractedText (BY-ID: scopedFindByIdOrThrow)
 * Both UNDER the independent findInOrg wall — two checks, two layers
 * (CLAUDE.md Option B).
 *
 * DELIBERATELY NOT wired (metering-entangled, already walled): pollAndAdvance +
 * reprocess carry the upload_extraction reserve/commit/release lifecycle; their
 * by-id loads are mechanically separable but scoping them would force the
 * upload_extraction metering spec off `documentUploadRepository.findOne`,
 * breaking the "metering specs byte-identical" mandate. buildScopedQuery exists
 * (base contract + the updateExtractedText by-id wire) but those two paths stay
 * on the bare repo behind their existing walls — a deliberate later decision,
 * not an S2f swap. See docs/option-b-s2f-document-upload-recon.md §C.
 */
@Injectable()
export class DocumentUploadScopedRepository extends ScopedContractRepository<DocumentUpload> {
  // Matches the existing thrown message in document-processing.service
  // (updateExtractedText / pollAndAdvance) so the scopedFindByIdOrThrow wiring
  // is a byte-faithful drop-in. 404, never 403 — no existence leak.
  protected readonly notFoundMessage = 'Document not found';
  protected readonly entityAlias = 'document';

  // S2f allowlist: the wired list read (getDocuments) filters on contract_id
  // only. Widening this set is a deliberate per-bucket decision, never a
  // drive-by.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set([
    'contract_id',
  ]);

  constructor(
    @InjectRepository(DocumentUpload)
    repo: Repository<DocumentUpload>,
  ) {
    super(repo);
  }

  /**
   * `document → contract → project`, both inner joins, org filter mandatory.
   * Canonical-only (Q1): the join walks the `document.contract` FK; the
   * denormalized `document.organization_id` column is never consulted.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<DocumentUpload> {
    return this.repo
      .createQueryBuilder('document')
      .innerJoin('document.contract', 'org_gate_contract')
      .innerJoin('org_gate_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<DocumentUpload> {
    const qb = this.joinedToOrg(orgId).andWhere('document.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // Pin the parent contract (`document.contract_id`). SAFETY: the org
      // filter is ALWAYS `:orgId`; this only NARROWS to a parent contract and
      // can never widen or change the caller's org.
      qb.andWhere('document.contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(
    orgId: string,
  ): SelectQueryBuilder<DocumentUpload> {
    return this.joinedToOrg(orgId);
  }
}
