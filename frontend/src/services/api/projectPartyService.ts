import api from '@/services/api/axios';
import type { ProjectParty, PartyType, PartyTypePermissions } from '@/types';

export interface CreatePartyRequest {
  project_id: string;
  party_type: PartyType;
  name: string;
  email: string;
  contact_person?: string;
  phone?: string;
  permissions?: Record<string, boolean>;
}

export interface UpdatePartyRequest {
  party_type?: PartyType;
  name?: string;
  email?: string;
  contact_person?: string;
  phone?: string;
  permissions?: Record<string, boolean>;
}

export interface PartyTypeInfo {
  type: PartyType;
  permissions: PartyTypePermissions;
}

export const projectPartyService = {
  async getAll(projectId?: string): Promise<ProjectParty[]> {
    const params = projectId ? { projectId } : {};
    const response = await api.get<ProjectParty[]>('/project-parties', { params });
    return response.data;
  },

  async getById(id: string): Promise<ProjectParty> {
    const response = await api.get<ProjectParty>(`/project-parties/${id}`);
    return response.data;
  },

  async create(data: CreatePartyRequest): Promise<ProjectParty> {
    const response = await api.post<ProjectParty>('/project-parties', data);
    return response.data;
  },

  async update(id: string, data: UpdatePartyRequest): Promise<ProjectParty> {
    const response = await api.put<ProjectParty>(`/project-parties/${id}`, data);
    return response.data;
  },

  async invite(id: string): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>(`/project-parties/${id}/invite`);
    return response.data;
  },

  async getPartyTypes(): Promise<PartyTypeInfo[]> {
    const response = await api.get<PartyTypeInfo[]>('/project-parties/types');
    return response.data;
  },
};

export default projectPartyService;
