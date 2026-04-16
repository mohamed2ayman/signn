import api from '@/services/api/axios';
import type { SubscriptionPlan, OrganizationSubscription } from '@/types';

export const subscriptionService = {
  /**
   * Get active subscription plans (public — used during registration and on the subscription page).
   */
  async getPlans(): Promise<SubscriptionPlan[]> {
    const response = await api.get<SubscriptionPlan[]>('/admin/subscription-plans');
    return response.data;
  },

  /**
   * Get the current organisation's active subscription (with plan relation).
   * Returns null if no active subscription exists.
   */
  async getCurrentSubscription(): Promise<OrganizationSubscription | null> {
    const response = await api
      .get<OrganizationSubscription>('/subscriptions/current')
      .catch(() => ({ data: null }));
    return response.data;
  },

  /**
   * Create a Paymob payment intention for the given plan.
   * Returns the payment_key and iframe_id needed to open the Paymob iframe.
   */
  async createPaymentIntention(
    planId: string,
  ): Promise<{ payment_key: string; iframe_id: string; order_id: string }> {
    const response = await api.post('/subscriptions/create-payment-intention', {
      plan_id: planId,
    });
    return response.data;
  },
};

export default subscriptionService;
