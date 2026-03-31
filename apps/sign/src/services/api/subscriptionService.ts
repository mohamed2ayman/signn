import api from '@/services/api/axios';
import type { SubscriptionPlan } from '@/types';

export const subscriptionService = {
  /**
   * Get available subscription plans.
   * This endpoint is public and used during registration.
   */
  async getPlans(): Promise<SubscriptionPlan[]> {
    const response = await api.get<SubscriptionPlan[]>('/admin/subscription-plans');
    return response.data;
  },
};

export default subscriptionService;
