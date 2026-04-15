import api from './axios';
import { User, KnowledgeAsset, SubscriptionPlan, UserRole, PermissionLevel } from '@/types';

export interface InviteUserRequest {
  email: string;
  role: UserRole;
  job_title?: string;
  default_permission_level?: PermissionLevel;
  project_ids?: string[];
}

export interface AdminUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  organization_id: string;
  is_active: boolean;
  mfa_enabled: boolean;
  mfa_method: 'email' | 'totp' | null;
  last_login_at: string | null;
  created_at: string;
}

export const adminService = {
  // Users (org-scoped)
  getUsers: () =>
    api.get<User[]>('/users').then(r => r.data),

  inviteUser: (data: InviteUserRequest) =>
    api.post('/users/invite', data).then(r => r.data),

  updateUserRole: (userId: string, role: UserRole) =>
    api.put(`/users/${userId}/role`, { role }).then(r => r.data),

  deactivateUser: (userId: string) =>
    api.delete(`/users/${userId}`).then(r => r.data),

  // System admin: all users
  getAllUsers: () =>
    api.get<AdminUser[]>('/users/admin/all').then(r => r.data),

  resetUserMfa: (userId: string) =>
    api.post<{ message: string }>(`/users/${userId}/mfa/reset`).then(r => r.data),

  // Knowledge Assets pending review
  getPendingAssets: () =>
    api.get<KnowledgeAsset[]>('/knowledge-assets/pending-review').then(r => r.data),

  // Subscription plans
  getPlans: () =>
    api.get<SubscriptionPlan[]>('/admin/subscription-plans/all').then(r => r.data),

  createPlan: (data: Partial<SubscriptionPlan>) =>
    api.post<SubscriptionPlan>('/admin/subscription-plans', data).then(r => r.data),

  updatePlan: (id: string, data: Partial<SubscriptionPlan>) =>
    api.put<SubscriptionPlan>(`/admin/subscription-plans/${id}`, data).then(r => r.data),
};
