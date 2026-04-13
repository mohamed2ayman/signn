import api from './axios';
import { Contract, ContractClause, ContractVersion, ContractComment, ContractorResponse, SignatureSigner, VersionComparisonResult } from '@/types';

export const contractService = {
  // Contract CRUD
  getAll: (projectId: string, params?: { status?: string; contract_type?: string; search?: string }) =>
    api.get<Contract[]>('/contracts', { params: { project_id: projectId, ...params } }).then(r => r.data),

  getById: (id: string) =>
    api.get<Contract>(`/contracts/${id}`).then(r => r.data),

  create: (data: { project_id: string; name: string; contract_type: string; party_type?: string; license_acknowledged?: boolean; license_organization?: string }) =>
    api.post<Contract>('/contracts', data).then(r => r.data),

  update: (id: string, data: { name?: string; party_type?: string }) =>
    api.put<Contract>(`/contracts/${id}`, data).then(r => r.data),

  updateStatus: (id: string, status: string) =>
    api.put<Contract>(`/contracts/${id}/status`, { status }).then(r => r.data),

  delete: (id: string) =>
    api.delete(`/contracts/${id}`).then(r => r.data),

  // Party Names
  updateParties: (id: string, data: { party_first_name?: string | null; party_second_name?: string | null }) =>
    api.put<Contract>(`/contracts/${id}/parties`, data).then(r => r.data),

  // Clause Management
  getClauses: (contractId: string) =>
    api.get<ContractClause[]>(`/contracts/${contractId}/clauses`).then(r => r.data),

  addClause: (contractId: string, data: { clause_id: string; section_number?: string; order_index?: number; customizations?: Record<string, unknown> }) =>
    api.post<ContractClause>(`/contracts/${contractId}/clauses`, data).then(r => r.data),

  updateContractClause: (contractId: string, clauseId: string, data: { order_index?: number; section_number?: string; customizations?: Record<string, unknown> }) =>
    api.put<ContractClause>(`/contracts/${contractId}/clauses/${clauseId}`, data).then(r => r.data),

  removeClause: (contractId: string, clauseId: string) =>
    api.delete(`/contracts/${contractId}/clauses/${clauseId}`).then(r => r.data),

  reorderClauses: (contractId: string, clauses: { id: string; order_index: number }[]) =>
    api.put(`/contracts/${contractId}/clauses/reorder`, { clauses }).then(r => r.data),

  // Versions
  getVersions: (contractId: string) =>
    api.get<ContractVersion[]>(`/contracts/${contractId}/versions`).then(r => r.data),

  getVersion: (contractId: string, versionId: string) =>
    api.get<ContractVersion>(`/contracts/${contractId}/versions/${versionId}`).then(r => r.data),

  getMilestoneVersions: (contractId: string) =>
    api.get<ContractVersion[]>(`/contracts/${contractId}/versions/milestones`).then(r => r.data),

  compareVersions: (contractId: string, versionA: string, versionB: string) =>
    api.get<VersionComparisonResult>(`/contracts/${contractId}/versions/${versionA}/compare/${versionB}`).then(r => r.data),

  saveNewVersion: (contractId: string, changeSummary: string) =>
    api.post<ContractVersion>(`/contracts/${contractId}/versions`, { change_summary: changeSummary }).then(r => r.data),

  // Comments
  getComments: (contractId: string, clauseId?: string) =>
    api.get<ContractComment[]>(`/contracts/${contractId}/comments`, { params: clauseId ? { clause_id: clauseId } : undefined }).then(r => r.data),

  addComment: (contractId: string, data: { content: string; contract_clause_id?: string; parent_comment_id?: string }) =>
    api.post<ContractComment>(`/contracts/${contractId}/comments`, data).then(r => r.data),

  resolveComment: (contractId: string, commentId: string) =>
    api.put<ContractComment>(`/contracts/${contractId}/comments/${commentId}/resolve`).then(r => r.data),

  // Contractor Responses
  getResponses: (contractId: string) =>
    api.get<ContractorResponse[]>(`/contracts/${contractId}/responses`).then(r => r.data),

  // DocuSign Signature
  initiateSignature: (contractId: string, signers: { email: string; name: string }[]) =>
    api.post<{ envelopeId: string; signingUrl: string }>(`/contracts/${contractId}/initiate-signature`, { signers }).then(r => r.data),

  getSigningUrl: (contractId: string) =>
    api.get<{ signingUrl: string | null; message?: string }>(`/contracts/${contractId}/signing-url`).then(r => r.data),

  getSignatureStatus: (contractId: string) =>
    api.get<{ signature_status: string | null; signers: SignatureSigner[]; envelope_status?: string; executed_at?: string | null }>(`/contracts/${contractId}/signature-status`).then(r => r.data),
};
