import api from '@/services/api/axios';
import type { Organization } from '@/types';

export interface UpdateOrganizationRequest {
  name?: string;
  industry?: string;
  crn?: string;
  country?: string;
  logo_url?: string;
}

export const organizationService = {
  async getMyOrganization(): Promise<Organization> {
    const response = await api.get<Organization>('/organizations/me');
    return response.data;
  },

  async updateOrganization(data: UpdateOrganizationRequest): Promise<Organization> {
    const response = await api.put<Organization>('/organizations/me', data);
    return response.data;
  },

  async uploadPolicy(file: File, title: string, description?: string): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    if (description) {
      formData.append('description', description);
    }
    await api.post('/organizations/me/policies', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

export default organizationService;
