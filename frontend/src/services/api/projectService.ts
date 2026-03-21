import api from '@/services/api/axios';
import type { Project, ProjectMember } from '@/types';

export interface CreateProjectRequest {
  name: string;
  objective?: string;
  country?: string;
  start_date?: string;
  end_date?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  objective?: string;
  country?: string;
  start_date?: string;
  end_date?: string;
}

export interface AddMemberRequest {
  user_id: string;
  role?: string;
}

export interface ProjectDashboard {
  project_id: string;
  contracts: {
    total: number;
    by_status: Array<{ status: string; count: string }>;
  };
  parties: {
    total: number;
    by_type: Array<{ party_type: string; count: string }>;
  };
  risk_summary: Array<{ risk_level: string; count: string }>;
}

export const projectService = {
  async getAll(): Promise<Project[]> {
    const response = await api.get<Project[]>('/projects');
    return response.data;
  },

  async getById(id: string): Promise<Project> {
    const response = await api.get<Project>(`/projects/${id}`);
    return response.data;
  },

  async create(data: CreateProjectRequest): Promise<Project> {
    const response = await api.post<Project>('/projects', data);
    return response.data;
  },

  async update(id: string, data: UpdateProjectRequest): Promise<Project> {
    const response = await api.put<Project>(`/projects/${id}`, data);
    return response.data;
  },

  async getDashboard(id: string): Promise<ProjectDashboard> {
    const response = await api.get<ProjectDashboard>(`/projects/${id}/dashboard`);
    return response.data;
  },

  async addMember(projectId: string, data: AddMemberRequest): Promise<ProjectMember> {
    const response = await api.post<ProjectMember>(`/projects/${projectId}/members`, data);
    return response.data;
  },

  async removeMember(projectId: string, userId: string): Promise<void> {
    await api.delete(`/projects/${projectId}/members/${userId}`);
  },

  async getMembers(projectId: string): Promise<ProjectMember[]> {
    const response = await api.get<ProjectMember[]>(`/projects/${projectId}/members`);
    return response.data;
  },
};

export default projectService;
