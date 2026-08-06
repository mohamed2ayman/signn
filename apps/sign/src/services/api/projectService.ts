import api from '@/services/api/axios';
import type { Project, ProjectMember, PermissionLevel } from '@/types';

/**
 * Party Foundation Slice 1b — `default_party_role_code` is the project-level
 * default a new contract inherits for `contracts.host_party_role_code`.
 *
 * NOTE: it holds a CONTRACT-scoped registry code, not a project-scoped one
 * (migration 1776000000001 lines 50-54). Any picker feeding it MUST query the
 * contract-scoped role list — filtering by applies_to=project returns a
 * different, unusable set.
 */
export interface CreateProjectRequest {
  name: string;
  objective?: string;
  country?: string;
  start_date?: string;
  end_date?: string;
  default_party_role_code?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  objective?: string;
  country?: string;
  start_date?: string;
  end_date?: string;
  default_party_role_code?: string;
}

export interface AddMemberRequest {
  user_id: string;
  role?: string;
  permission_level?: PermissionLevel;
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

  async delete(id: string): Promise<void> {
    await api.delete(`/projects/${id}`);
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

  async updateMemberPermission(
    projectId: string,
    userId: string,
    permission_level: PermissionLevel,
  ): Promise<ProjectMember> {
    const response = await api.put<ProjectMember>(
      `/projects/${projectId}/members/${userId}/permission`,
      { permission_level },
    );
    return response.data;
  },
};

export default projectService;
