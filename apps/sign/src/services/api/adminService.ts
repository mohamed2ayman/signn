import api from './axios';
import { User, KnowledgeAsset, SubscriptionPlan, UserRole } from '@/types';

export interface InviteUserRequest {
  email: string;
  role: UserRole;
  job_title?: string;
  project_ids?: string[];
}

export const adminService = {
  // Users
  getUsers: () =>
    api.get<User[]>('/users').then(r => r.data),

  inviteUser: (data: InviteUserRequest) =>
    api.post('/users/invite', data).then(r => r.data),

  updateUserRole: (userId: string, role: UserRole) =>
    api.put(`/users/${userId}/role`, { role }).then(r => r.data),

  deactivateUser: (userId: string) =>
    api.delete(`/users/${userId}`).then(r => r.data),

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
