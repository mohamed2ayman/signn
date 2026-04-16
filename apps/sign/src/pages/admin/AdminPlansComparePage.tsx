import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, X, ShieldCheck } from 'lucide-react';
import { adminService } from '@/services/api/adminService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { PLATFORM_FEATURES } from './AdminPlansPage';
import type { SubscriptionPlan } from '@/types';

export default function AdminPlansComparePage() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    adminService
      .getPlans()
      .then((data) => setPlans(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const visiblePlans = showAll ? plans : plans.filter((p) => p.is_active);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/admin/plans"
          className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Plans
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Plan Comparison</h1>
            <p className="mt-1 text-sm text-gray-500">
              Side-by-side feature comparison of all plans.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-primary"
            />
            Show inactive plans
          </label>
        </div>
      </div>

      {visiblePlans.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-sm text-gray-400">
          No {showAll ? '' : 'active '}plans to compare.{' '}
          <Link to="/admin/plans" className="text-primary hover:underline">
            Create a plan
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="w-52 bg-gray-50 px-6 py-5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Feature
                </th>
                {visiblePlans.map((plan) => (
                  <th key={plan.id} className="min-w-[160px] px-6 py-5 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {!plan.is_active && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                          INACTIVE
                        </span>
                      )}
                      <span className="text-base font-bold text-gray-900">{plan.name}</span>
                      <span className="text-lg font-semibold text-primary">
                        {plan.currency} {Number(plan.price).toLocaleString()}
                      </span>
                      <span className="text-xs text-gray-400">per {plan.duration_days} days</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-50">
              {/* Usage Limits section */}
              <tr className="bg-gray-50">
                <td
                  colSpan={visiblePlans.length + 1}
                  className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400"
                >
                  Usage Limits
                </td>
              </tr>
              {[
                { label: 'Projects', key: 'max_projects' as keyof SubscriptionPlan },
                { label: 'Users', key: 'max_users' as keyof SubscriptionPlan },
                {
                  label: 'Contracts per Project',
                  key: 'max_contracts_per_project' as keyof SubscriptionPlan,
                },
              ].map(({ label, key }) => (
                <tr key={key} className="hover:bg-gray-50/60">
                  <td className="px-6 py-3 text-sm text-gray-700">{label}</td>
                  {visiblePlans.map((plan) => (
                    <td key={plan.id} className="px-6 py-3 text-center text-sm font-semibold text-gray-900">
                      {String(plan[key])}
                    </td>
                  ))}
                </tr>
              ))}

              {/* MFA row */}
              <tr className="hover:bg-gray-50/60">
                <td className="px-6 py-3 text-sm text-gray-700">MFA Required</td>
                {visiblePlans.map((plan) => (
                  <td key={plan.id} className="px-6 py-3 text-center">
                    {plan.require_mfa ? (
                      <ShieldCheck className="mx-auto h-5 w-5 text-emerald-500" />
                    ) : (
                      <span className="text-xs text-gray-400">Optional</span>
                    )}
                  </td>
                ))}
              </tr>

              {/* Platform Features section */}
              <tr className="bg-gray-50">
                <td
                  colSpan={visiblePlans.length + 1}
                  className="px-6 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400"
                >
                  Platform Features
                </td>
              </tr>

              {PLATFORM_FEATURES.map((feature) => {
                const anyEnabled = visiblePlans.some((p) => p.features?.[feature.key]);
                return (
                  <tr
                    key={feature.key}
                    className={`hover:bg-gray-50/60 ${!anyEnabled ? 'opacity-50' : ''}`}
                  >
                    <td className="px-6 py-3 text-sm text-gray-700">{feature.label}</td>
                    {visiblePlans.map((plan) => {
                      const enabled = plan.features?.[feature.key];
                      return (
                        <td key={plan.id} className="px-6 py-3 text-center">
                          {enabled ? (
                            <Check className="mx-auto h-5 w-5 text-emerald-500" />
                          ) : (
                            <X className="mx-auto h-4 w-4 text-gray-200" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Features count summary row */}
              <tr className="border-t-2 border-gray-100 bg-gray-50">
                <td className="px-6 py-3 text-sm font-semibold text-gray-700">Total Features</td>
                {visiblePlans.map((plan) => {
                  const count = Object.values(plan.features || {}).filter(Boolean).length;
                  return (
                    <td key={plan.id} className="px-6 py-3 text-center">
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-700">
                        {count} / {PLATFORM_FEATURES.length}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
