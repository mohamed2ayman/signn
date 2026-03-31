import api from './axios';

export const contractSharingService = {
  createShare: async (data: {
    contract_id: string;
    shared_with_email: string;
    permission?: string;
    expires_in_days?: number;
  }) => {
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
};
