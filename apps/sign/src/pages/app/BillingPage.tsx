import { useState, useEffect } from 'react';
import { subscriptionService } from '@/services/api/subscriptionService';
import type { SubscriptionPlan, OrganizationSubscription } from '@/types';
import api from '@/services/api/axios';

export default function BillingPage() {
  const [subscription, setSubscription] = useState<OrganizationSubscription | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [subRes, plansRes] = await Promise.all([
        api.get('/subscriptions/current').catch(() => ({ data: null })),
        subscriptionService.getPlans(),
      ]);
      setSubscription(subRes.data);
      setPlans(plansRes);
    } catch { /* */ }
    setLoading(false);
  };

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    try {
      const res = await api.post('/subscriptions/create-payment-intention', { plan_id: planId });
      const { payment_key, iframe_id } = res.data;

      if (payment_key === 'mock_payment_key_for_dev') {
        // Dev mode: auto-activate
        alert('Dev mode: Payment simulated. Subscription will activate after webhook.');
      } else if (iframe_id && payment_key) {
        // Open Paymob iframe
        window.open(
          `https://accept.paymob.com/api/acceptance/iframes/${iframe_id}?payment_token=${payment_key}`,
          '_blank',
        );
      }
    } catch { /* */ }
    setUpgrading(null);
  };

  const currentPlan = subscription?.plan;
  const daysLeft = subscription
    ? Math.max(0, Math.ceil((new Date(subscription.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Billing & Subscription</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your plan and billing details</p>
      </div>

      {/* Current Plan */}
      <div className="bg-white rounded-2xl border border-gray-200/60 shadow-card p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Current Plan</h2>
        {currentPlan ? (
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-navy-900">{currentPlan.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{currentPlan.description}</p>
              <div className="flex gap-4 mt-3">
                <span className="text-xs text-gray-400">
                  <span className="font-semibold text-navy-900">{currentPlan.max_projects}</span> projects
                </span>
                <span className="text-xs text-gray-400">
                  <span className="font-semibold text-navy-900">{currentPlan.max_users}</span> users
                </span>
                <span className="text-xs text-gray-400">
                  <span className="font-semibold text-navy-900">{currentPlan.max_contracts_per_project}</span> contracts/project
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-navy-900">
                {currentPlan.currency} {Number(currentPlan.price).toLocaleString()}
              </div>
              <p className="text-xs text-gray-400 mt-1">per {currentPlan.duration_days} days</p>
              <div className={`mt-2 inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                subscription?.status === 'ACTIVE'
                  ? 'bg-green-50 text-green-600'
                  : 'bg-red-50 text-red-600'
              }`}>
                {subscription?.status === 'ACTIVE' ? `Active · ${daysLeft} days left` : subscription?.status || 'Inactive'}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No active subscription. Choose a plan below to get started.</p>
        )}
      </div>

      {/* Available Plans */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = currentPlan?.id === plan.id;
            return (
              <div
                key={plan.id}
                className={`bg-white rounded-2xl border p-6 transition-all ${
                  isCurrent
                    ? 'border-primary shadow-card-hover ring-1 ring-primary/20'
                    : 'border-gray-200/60 shadow-card hover:shadow-card-hover'
                }`}
              >
                {isCurrent && (
                  <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full mb-3 inline-block">CURRENT PLAN</span>
                )}
                <h3 className="text-lg font-bold text-navy-900">{plan.name}</h3>
                <p className="text-sm text-gray-500 mt-1 min-h-[40px]">{plan.description}</p>
                <div className="my-4">
                  <span className="text-3xl font-bold text-navy-900">{plan.currency} {Number(plan.price).toLocaleString()}</span>
                  <span className="text-sm text-gray-400 ml-1">/ {plan.duration_days} days</span>
                </div>
                <div className="space-y-2 mb-6">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    {plan.max_projects} projects
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    {plan.max_users} team members
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    {plan.max_contracts_per_project} contracts/project
                  </div>
                </div>
                <button
                  onClick={() => !isCurrent && handleUpgrade(plan.id)}
                  disabled={isCurrent || upgrading === plan.id}
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                    isCurrent
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-primary text-white hover:bg-primary-600'
                  }`}
                >
                  {upgrading === plan.id ? 'Processing...' : isCurrent ? 'Current Plan' : 'Upgrade'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
