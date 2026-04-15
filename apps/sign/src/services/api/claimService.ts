import api from './axios';
import type { Claim, ClaimResponse as ClaimResponseType } from '@/types';

export const claimService = {
  getByContract: (contractId: string) =>
    api.get<Claim[]>('/claims', { params: { contract_id: contractId } }).then(r => r.data),

  getById: (id: string) =>
    api.get<Claim>(`/claims/${id}`).then(r => r.data),

  create: (data: {
    contract_id: string;
    title: string;
    description: string;
    claim_type: string;
    event_date: string;
    claimed_amount?: number;
    claimed_time_extension_days?: number;
    contract_clause_references?: Record<string, unknown>[];
  }) =>
    api.post<Claim>('/claims', data).then(r => r.data),

  acknowledge: (id: string) =>
    api.put<Claim>(`/claims/${id}/acknowledge`).then(r => r.data),

  respond: (id: string, data: {
    response_type: string;
    response_content: string;
    counter_amount?: number;
    counter_time_days?: number;
    justification?: string;
  }) =>
    api.post<ClaimResponseType>(`/claims/${id}/respond`, data).then(r => r.data),

  updateStatus: (id: string, status: string, note?: string) =>
    api.put<Claim>(`/claims/${id}/status`, { status, note }).then(r => r.data),

  uploadDocument: (id: string, data: { file_url: string; file_name: string; document_type?: string }) =>
    api.post(`/claims/${id}/documents`, data).then(r => r.data),
};
