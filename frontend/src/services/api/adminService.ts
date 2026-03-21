import api from './axios';
import { User, KnowledgeAsset, SubscriptionPlan } from '@/types';

export const adminService = {
  // Users
  getUsers: () =>
    api.get<User[]>('/users/members').then(r => r.data),

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
