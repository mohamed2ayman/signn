import api from './axios';
import type { SubContract } from '@/types';

export const subContractService = {
  getByMainContract: (mainContractId: string) =>
    api.get<SubContract[]>('/subcontracts', { params: { main_contract_id: mainContractId } }).then(r => r.data),

  getById: (id: string) =>
    api.get<SubContract>(`/subcontracts/${id}`).then(r => r.data),

  create: (data: {
    main_contract_id: string;
    title: string;
    scope_description: string;
    subcontractor_name: string;
    subcontractor_email: string;
    subcontractor_company?: string;
    subcontractor_contact_phone?: string;
    contract_value?: number;
    start_date?: string;
    end_date?: string;
  }) =>
    api.post<SubContract>('/subcontracts', data).then(r => r.data),

  update: (id: string, data: Partial<{
    title: string;
    scope_description: string;
    subcontractor_name: string;
    subcontractor_email: string;
    subcontractor_company: string;
    subcontractor_contact_phone: string;
    contract_value: number;
    start_date: string;
    end_date: string;
  }>) =>
    api.put<SubContract>(`/subcontracts/${id}`, data).then(r => r.data),

  updateStatus: (id: string, status: string, note?: string) =>
    api.put<SubContract>(`/subcontracts/${id}/status`, { status, note }).then(r => r.data),

  share: (id: string) =>
    api.post<{ shareUrl: string; token: string }>(`/subcontracts/${id}/share`).then(r => r.data),
};
