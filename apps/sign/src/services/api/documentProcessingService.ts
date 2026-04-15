import api from '@/services/api/axios';
import type { DocumentUpload } from '@/types';

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
