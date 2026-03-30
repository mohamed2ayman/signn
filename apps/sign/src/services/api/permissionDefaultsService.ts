import api from './axios';
import type { PermissionDefaultEntry, PermissionLevel } from '@/types';

export const permissionDefaultsService = {
  async getAll(): Promise<PermissionDefaultEntry[]> {
    const response = await api.get<PermissionDefaultEntry[]>('/permission-defaults');
    return response.data;
  },

  async update(job_title: string, permission_level: PermissionLevel): Promise<PermissionDefaultEntry> {
    const response = await api.put<PermissionDefaultEntry>('/permission-defaults', {
      job_title,
      permission_level,
    });
    return response.data;
  },

  async reset(jobTitle: string): Promise<PermissionDefaultEntry> {
    const response = await api.delete<PermissionDefaultEntry>(
      `/permission-defaults/${encodeURIComponent(jobTitle)}`,
    );
    return response.data;
  },
};
