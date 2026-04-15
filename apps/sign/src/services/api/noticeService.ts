import api from './axios';
import type { Notice, NoticeResponse as NoticeResponseType } from '@/types';

export const noticeService = {
  getByContract: (contractId: string) =>
    api.get<Notice[]>('/notices', { params: { contract_id: contractId } }).then(r => r.data),

  getById: (id: string) =>
    api.get<Notice>(`/notices/${id}`).then(r => r.data),

  create: (data: {
    contract_id: string;
    title: string;
    description: string;
    notice_type: string;
    event_date: string;
    response_required?: boolean;
    response_deadline?: string;
    contract_clause_references?: Record<string, unknown>[];
  }) =>
    api.post<Notice>('/notices', data).then(r => r.data),

  acknowledge: (id: string) =>
    api.put<Notice>(`/notices/${id}/acknowledge`).then(r => r.data),

  respond: (id: string, data: { response_type: string; response_content: string }) =>
    api.post<NoticeResponseType>(`/notices/${id}/respond`, data).then(r => r.data),

  updateStatus: (id: string, status: string, note?: string) =>
    api.put<Notice>(`/notices/${id}/status`, { status, note }).then(r => r.data),
};
