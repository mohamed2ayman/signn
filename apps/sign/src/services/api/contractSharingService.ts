import api from './axios';

export interface OrgMemberSuggestion {
  id: string;
  name: string;
  email: string;
}

export interface ShareResult {
  id: string;
  contract_id: string;
  shared_with_email: string;
  permission: string;
  token: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  /** True when the recipient is a user in the same organisation */
  isInternal: boolean;
  /** Recipient display name when internal */
  recipientName?: string;
}

export const contractSharingService = {
  createShare: async (data: {
    contract_id: string;
    shared_with_email: string;
    permission?: string;
    expires_in_days?: number;
  }): Promise<ShareResult> => {
    const response = await api.post('/contract-sharing', data);
    return response.data;
  },

  getSharesByContract: async (contractId: string) => {
    const response = await api.get(
      `/contract-sharing/contract/${contractId}`,
    );
    return response.data;
  },

  accessShared: async (token: string) => {
    const response = await api.get(`/contract-sharing/shared/${token}`);
    return response.data;
  },

  revokeShare: async (shareId: string) => {
    const response = await api.delete(`/contract-sharing/${shareId}`);
    return response.data;
  },

  /** Search org members for autocomplete — returns internal users only */
  searchOrgMembers: async (q: string): Promise<OrgMemberSuggestion[]> => {
    if (!q || q.length < 2) return [];
    const response = await api.get('/contract-sharing/org-members', { params: { q } });
    return response.data;
  },
};
