import { useState, useEffect } from 'react';
import {
  Check,
  ExternalLink,
  CreditCard,
  Users,
  BarChart2,
  FileText,
  ShieldCheck,
  AlertCircle,
  X,
} from 'lucide-react';
import api from '@/services/api/axios';
import { subscriptionService } from '@/services/api/subscriptionService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { PLATFORM_FEATURES } from '@/pages/admin/AdminPlansPage';
import type { SubscriptionPlan, OrganizationSubscription } from '@/types';
import { SubscriptionStatus } from '@/types';

function UsageBar({ used, max, label }: { used: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const barColor =
    pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-primary';
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className={`font-semibold ${pct >= 90 ? 'text-red-600' : 'text-gray-900'}`}>
          {used} <span className="font-normal text-gray-400">/ {max}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-2 rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {pct >= 90 && (
        <p className="mt-1 text-xs text-red-500">
          Approaching limit — consider upgrading your plan.
        </p>
      )}
    </div>
  );
}

export default function SubscriptionSettingsPage() {
  const [subscription, setSubscription] = useState<OrganizationSubscription | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [projectCount, setProjectCount] = useState(0);
  const [userCount, setUserCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [paySuccess, setPaySuccess] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/subscriptions/current').catch(() => ({ data: null })),
      subscriptionService.getPlans(),
      api.get('/projects').catch(() => ({ data: [] })),
      api.get('/users').catch(() => ({ data: [] })),
    ])
      .then(([subRes, plansRes, projRes, usersRes]) => {
        setSubscription(subRes.data);
        setPlans(plansRes);
        setProjectCount(Array.isArray(projRes.data) ? projRes.data.length : 0);
        setUserCount(Array.isArray(usersRes.data) ? usersRes.data.length : 0);
      })
      .finally(() => setLoading(false));
  }, []);

  const currentPlan = subscription?.plan;

  const daysLeft = subscription
    ? Math.max(
        0,
        Math.ceil(
          (new Date(subscription.end_date).getTime() - Date.now()) / 86400000,
        ),
      )
    : 0;

  const isExpiringSoon = daysLeft > 0 && daysLeft <= 14;

  const handleProceedToPayment = async () => {
    if (!selectedPlan) return;
    setPaying(true);
    setPayError('');
    setPaySuccess('');
    try {
      const res = await api.post('/subscriptions/create-payment-intention', {
        plan_id: selectedPlan.id,
      });
      const { payment_key, iframe_id } = res.data;
      if (payment_key === 'mock_payment_key_for_dev') {
        setPaySuccess(
          'Dev mode: Payment simulated. Your subscription will activate after the webhook is processed.',
        );
      } else if (iframe_id && payment_key) {
        window.open(
          `https://accept.paymob.com/api/acceptance/iframes/${iframe_id}?payment_token=${payment_key}`,
          '_blank',
        );
        setPaySuccess(
          'A secure payment window has been opened. Complete the payment to activate your new plan.',
        );
      }
    } catch {
      setPayError('Failed to initiate payment. Please try again.');
    } finally {
      setPaying(false);
    }
  };

  const closeModal = () => {
    setSelectedPlan(null);
    setPayError('');
    setPaySuccess('');
  };

  const getActionLabel = (plan: SubscriptionPlan) => {
    if (!currentPlan) return 'Subscribe';
    if (currentPlan.id === plan.id) return 'Current Plan';
    return Number(plan.price) > Number(currentPlan.price) ? 'Upgrade' : 'Downgrade';
  };

  const isUpgrade = (plan: SubscriptionPlan) =>
    currentPlan && Number(plan.price) > Number(currentPlan.price);

  const enabledFeatures = (plan: SubscriptionPlan) =>
    PLATFORM_FEATURES.filter((f) => plan.features?.[f.key]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Subscription</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your plan, view usage, and upgrade or downgrade at any time.
        </p>
      </div>

      {/* Expiry warning */}
      {isExpiringSoon && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-amber-500" />
          Your subscription expires in{' '}
          <strong>
            {daysLeft} day{daysLeft !== 1 ? 's' : ''}
          </strong>
          . Renew now to avoid any interruption.
        </div>
      )}

      {/* Current Plan Card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Current Plan
        </h2>
        {currentPlan ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              <h3 className="text-xl font-bold text-gray-900">{currentPlan.name}</h3>
              {currentPlan.description && (
                <p className="mt-1 text-sm text-gray-500">{currentPlan.description}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    subscription?.status === SubscriptionStatus.ACTIVE
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-red-50 text-red-600'
                  }`}
                >
                  {subscription?.status === SubscriptionStatus.ACTIVE
                    ? `Active · ${daysLeft} days remaining`
                    : subscription?.status ?? 'Inactive'}
                </span>
                {currentPlan.require_mfa && (
                  <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    MFA Required
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-gray-900">
                {currentPlan.currency} {Number(currentPlan.price).toLocaleString()}
              </div>
              <p className="mt-1 text-xs text-gray-400">per {currentPlan.duration_days} days</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No active subscription. Choose a plan below to get started.
          </p>
        )}
      </div>

      {/* Usage Stats */}
      {currentPlan && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Usage
          </h2>
          <div className="space-y-5">
            <UsageBar used={projectCount} max={currentPlan.max_projects} label="Projects" />
            <UsageBar used={userCount} max={currentPlan.max_users} label="Team Members" />
            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-gray-600">Contracts per Project</span>
                <span className="text-gray-500">
                  Up to{' '}
                  <span className="font-semibold text-gray-900">
                    {currentPlan.max_contracts_per_project}
                  </span>{' '}
                  per project
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100" />
            </div>
          </div>
        </div>
      )}

      {/* Available Plans */}
      <div>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-500">
          {currentPlan ? 'Upgrade or Change Plan' : 'Available Plans'}
        </h2>
        {plans.length === 0 ? (
          <p className="text-sm text-gray-400">No plans available at the moment.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = currentPlan?.id === plan.id;
              const action = getActionLabel(plan);
              const upgrade = isUpgrade(plan);
              const featureList = enabledFeatures(plan);

              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col rounded-2xl border p-6 transition-all ${
                    isCurrent
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    {isCurrent && (
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold text-primary">
                        CURRENT
                      </span>
                    )}
                    {upgrade && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-700">
                        UPGRADE
                      </span>
                    )}
                  </div>

                  <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                  {plan.description && (
                    <p className="mt-1 min-h-[36px] text-sm text-gray-500">{plan.description}</p>
                  )}

                  <div className="my-4">
                    <span className="text-3xl font-bold text-gray-900">
                      {plan.currency} {Number(plan.price).toLocaleString()}
                    </span>
                    <span className="ml-1.5 text-sm text-gray-400">/ {plan.duration_days}d</span>
                  </div>

                  {/* Limits */}
                  <div className="mb-4 space-y-1.5">
                    {[
                      { Icon: BarChart2, text: `${plan.max_projects} projects` },
                      { Icon: Users, text: `${plan.max_users} team members` },
                      { Icon: FileText, text: `${plan.max_contracts_per_project} contracts/project` },
                    ].map(({ Icon, text }) => (
                      <div key={text} className="flex items-center gap-2 text-sm text-gray-600">
                        <Icon className="h-4 w-4 text-primary" />
                        {text}
                      </div>
                    ))}
                  </div>

                  {/* Features list */}
                  {featureList.length > 0 && (
                    <div className="mb-5 space-y-1.5">
                      {featureList.slice(0, 5).map((f) => (
                        <div key={f.key} className="flex items-center gap-2 text-sm text-gray-600">
                          <Check className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                          {f.label}
                        </div>
                      ))}
                      {featureList.length > 5 && (
                        <p className="pl-6 text-xs text-gray-400">
                          + {featureList.length - 5} more features
                        </p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => !isCurrent && setSelectedPlan(plan)}
                    disabled={isCurrent}
                    className={`mt-auto w-full rounded-xl py-2.5 text-sm font-semibold transition-colors ${
                      isCurrent
                        ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                        : 'bg-primary text-white hover:bg-primary/90'
                    }`}
                  >
                    {action}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Payment Confirmation Modal */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-bold text-gray-900">Confirm Plan Change</h2>
              <button
                onClick={closeModal}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-6">
              {/* Plan summary */}
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{selectedPlan.name}</p>
                    {selectedPlan.description && (
                      <p className="mt-0.5 text-sm text-gray-500">{selectedPlan.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-gray-900">
                      {selectedPlan.currency} {Number(selectedPlan.price).toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-400">/ {selectedPlan.duration_days} days</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-200 pt-3 text-center text-xs text-gray-500">
                  <div>
                    <p className="font-bold text-gray-900">{selectedPlan.max_projects}</p>
                    <p>Projects</p>
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">{selectedPlan.max_users}</p>
                    <p>Users</p>
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">
                      {selectedPlan.max_contracts_per_project}
                    </p>
                    <p>Contracts/proj</p>
                  </div>
                </div>
              </div>

              {currentPlan && (
                <p className="text-sm text-gray-600">
                  You are{' '}
                  {Number(selectedPlan.price) > Number(currentPlan.price)
                    ? 'upgrading'
                    : 'downgrading'}{' '}
                  from <span className="font-semibold">{currentPlan.name}</span> to{' '}
                  <span className="font-semibold">{selectedPlan.name}</span>.
                </p>
              )}

              <div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                You'll be redirected to a secure payment page to complete the transaction.
              </div>

              {payError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{payError}</div>
              )}
              {paySuccess && (
                <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                  {paySuccess}
                </div>
              )}
            </div>

            <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
              <button
                onClick={handleProceedToPayment}
                disabled={paying || !!paySuccess}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
              >
                {paying ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Processing…
                  </>
                ) : (
                  <>
                    <CreditCard className="h-4 w-4" />
                    Proceed to Payment
                  </>
                )}
              </button>
              <button
                onClick={closeModal}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
