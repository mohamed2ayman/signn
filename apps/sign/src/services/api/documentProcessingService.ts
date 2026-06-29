import api from '@/services/api/axios';
import type {
  ApplyProposedVersionDto,
  ApplyProposedVersionResult,
  ContractClause,
  DocumentUpload,
  ProposedVersionDiffResult,
} from '@/types';

export const documentProcessingService = {
  uploadDocument: (
    contractId: string,
    file: File,
    metadata?: { document_label?: string; document_priority?: number },
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    if (metadata?.document_label) fd.append('document_label', metadata.document_label);
    if (metadata?.document_priority !== undefined)
      fd.append('document_priority', String(metadata.document_priority));
    return api
      .post<DocumentUpload>(`/contracts/${contractId}/documents`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },

  getDocuments: (contractId: string) =>
    api
      .get<DocumentUpload[]>(`/contracts/${contractId}/documents`)
      .then((r) => r.data),

  getDocumentStatus: (contractId: string, docId: string) =>
    api
      .get<DocumentUpload>(`/contracts/${contractId}/documents/${docId}/status`)
      .then((r) => r.data),

  /**
   * Host-v1 read (Slice 1) — the PROPOSED clauses a bound guest submitted via a
   * new-version upload (Option C), scoped to one guest document. Excluded from
   * every default contract read; this is the only surface that returns them.
   */
  getProposedClauses: (contractId: string, docId: string) =>
    api
      .get<ContractClause[]>(
        `/contracts/${contractId}/documents/${docId}/proposed-clauses`,
      )
      .then((r) => r.data),

  /**
   * Guest version review (2b) — diff a guest's PROPOSED set (one upload's
   * proposed clauses) against the contract's CURRENT live clauses. Returns the
   * {summary, changes} shape the DiffViewer consumes (matched by section_number).
   */
  compareProposedVersion: (contractId: string, docId: string) =>
    api
      .get<ProposedVersionDiffResult>(
        `/contracts/${contractId}/documents/${docId}/proposed-version/compare`,
      )
      .then((r) => r.data),

  /**
   * Guest version review (2c) — the host commits its per-clause accept / reject
   * / merge-edit decisions on a guest-proposed version. Atomic on the backend:
   * snapshot-before-promote + parent-chain lineage. Rejected = no-op.
   */
  applyProposedVersion: (
    contractId: string,
    docId: string,
    dto: ApplyProposedVersionDto,
  ) =>
    api
      .post<ApplyProposedVersionResult>(
        `/contracts/${contractId}/documents/${docId}/proposed-version/apply`,
        dto,
      )
      .then((r) => r.data),

  reprocess: (contractId: string, docId: string) =>
    api
      .post<DocumentUpload>(`/contracts/${contractId}/documents/${docId}/reprocess`)
      .then((r) => r.data),

  updateExtractedText: (contractId: string, docId: string, text: string) =>
    api
      .put<DocumentUpload>(`/contracts/${contractId}/documents/${docId}/extracted-text`, { text })
      .then((r) => r.data),
};

export default documentProcessingService;
