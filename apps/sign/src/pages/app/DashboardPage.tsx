import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardAnalyticsService, DashboardAnalytics } from '@/services/api/dashboardAnalyticsService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

export default function DashboardPage() {
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardAnalyticsService
      .getAnalytics()
      .then(setAnalytics)
      .catch((err) => console.error('Failed to load analytics:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-500">
        Failed to load dashboard data. Please try again.
      </div>
    );
  }

  const la = analytics.loss_aversion;
  const hasActivity = analytics.documents.total > 0 || analytics.risks.total > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Your contract intelligence at a glance
          </p>
        </div>
        <button
          onClick={() => navigate('/app/projects/new')}
          className="inline-flex items-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
        >
          <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Project
        </button>
      </div>

      {/* ─── Value Delivered Banner (Loss Aversion) ───────────── */}
      {hasActivity && (
        <div className="rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 p-6 text-white shadow-lg">
          <div className="mb-1 flex items-center space-x-2">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h2 className="text-lg font-semibold">Platform Value Delivered</h2>
          </div>
          <p className="mb-5 text-sm text-emerald-100">
            Here's what SIGN has done for your team so far
          </p>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl bg-white/15 p-4 backdrop-blur-sm">
              <p className="text-3xl font-bold">{la.total_hours_saved}</p>
              <p className="mt-1 text-sm text-emerald-100">Hours Saved</p>
            </div>
            <div className="rounded-xl bg-white/15 p-4 backdrop-blur-sm">
              <p className="text-3xl font-bold">{la.documents_processed}</p>
              <p className="mt-1 text-sm text-emerald-100">Documents Analyzed</p>
            </div>
            <div className="rounded-xl bg-white/15 p-4 backdrop-blur-sm">
              <p className="text-3xl font-bold">{la.clauses_extracted}</p>
              <p className="mt-1 text-sm text-emerald-100">Clauses Extracted</p>
            </div>
            <div className="rounded-xl bg-white/15 p-4 backdrop-blur-sm">
              <p className="text-3xl font-bold">{analytics.documents.total_pages}</p>
              <p className="mt-1 text-sm text-emerald-100">Pages Processed</p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Attention Required (Urgency Alerts) ──────────────── */}
      {(la.unaddressed_high_risks > 0 ||
        la.overdue_obligations > 0 ||
        la.clauses_pending_review > 0 ||
        la.obligations_due_this_week > 0) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {la.overdue_obligations > 0 && (
            <button
              onClick={() => navigate('/app/obligations')}
              className="group flex items-start space-x-3 rounded-xl border-2 border-red-200 bg-red-50 p-4 text-left transition hover:border-red-300 hover:shadow-md"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-red-100">
                <svg className="h-5 w-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-700">{la.overdue_obligations}</p>
                <p className="text-sm font-medium text-red-600">Overdue Obligations</p>
                <p className="mt-0.5 text-xs text-red-500">Immediate action needed</p>
              </div>
            </button>
          )}

          {la.unaddressed_high_risks > 0 && (
            <div className="flex items-start space-x-3 rounded-xl border-2 border-orange-200 bg-orange-50 p-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-orange-100">
                <svg className="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-700">{la.unaddressed_high_risks}</p>
                <p className="text-sm font-medium text-orange-600">High Risks Unresolved</p>
                <p className="mt-0.5 text-xs text-orange-500">Review recommended</p>
              </div>
            </div>
          )}

          {la.obligations_due_this_week > 0 && (
            <button
              onClick={() => navigate('/app/obligations')}
              className="group flex items-start space-x-3 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-left transition hover:border-amber-300 hover:shadow-md"
            >
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100">
                <svg className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-700">{la.obligations_due_this_week}</p>
                <p className="text-sm font-medium text-amber-600">Due This Week</p>
                <p className="mt-0.5 text-xs text-amber-500">Stay on track</p>
              </div>
            </button>
          )}

          {la.clauses_pending_review > 0 && (
            <div className="flex items-start space-x-3 rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100">
                <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-700">{la.clauses_pending_review}</p>
                <p className="text-sm font-medium text-blue-600">Clauses to Review</p>
                <p className="mt-0.5 text-xs text-blue-500">AI-extracted, awaiting approval</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Key Stats Row ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Projects"
          value={analytics.projects.total}
          icon={
            <svg className="h-5 w-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          }
          bgColor="bg-indigo-50"
          onClick={() => navigate('/app/projects')}
        />
        <StatCard
          label="Contracts"
          value={analytics.contracts.total}
          icon={
            <svg className="h-5 w-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          }
          bgColor="bg-blue-50"
        />
        <StatCard
          label="Risks Flagged"
          value={analytics.risks.total}
          icon={
            <svg className="h-5 w-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
          }
          bgColor="bg-rose-50"
          subValue={
            analytics.risks.by_level.HIGH > 0
              ? `${analytics.risks.by_level.HIGH} high`
              : undefined
          }
          subColor="text-rose-500"
        />
        <StatCard
          label="Obligation Rate"
          value={`${la.obligation_completion_rate}%`}
          icon={
            <svg className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          bgColor="bg-emerald-50"
          subValue={`${analytics.obligations.completed}/${analytics.obligations.total} completed`}
          subColor="text-emerald-500"
          onClick={() => navigate('/app/obligations')}
        />
      </div>

      {/* ─── Two-Column Layout: Obligations + Risk Breakdown ─── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upcoming Obligations */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Upcoming Obligations</h2>
            <button
              onClick={() => navigate('/app/obligations')}
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </button>
          </div>
          <div className="divide-y divide-gray-50">
            {analytics.upcoming_obligations.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="mt-2 text-sm text-gray-400">No upcoming obligations</p>
              </div>
            ) : (
              analytics.upcoming_obligations.slice(0, 6).map((ob) => (
                <div
                  key={ob.id}
                  className={`flex items-start justify-between px-6 py-3 ${
                    ob.is_overdue ? 'bg-red-50/50' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {ob.description}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {ob.contract_name}
                      {ob.responsible_party && ` · ${ob.responsible_party}`}
                    </p>
                  </div>
                  <div className="ml-4 flex-shrink-0 text-right">
                    {ob.is_overdue ? (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        {Math.abs(ob.days_until_due || 0)}d overdue
                      </span>
                    ) : ob.days_until_due !== null && ob.days_until_due <= 3 ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        {ob.days_until_due}d left
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {ob.days_until_due}d left
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Risk Distribution */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Risk Overview</h2>
          </div>
          <div className="p-6">
            {analytics.risks.total === 0 ? (
              <div className="py-4 text-center">
                <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <p className="mt-2 text-sm text-gray-400">No risks analyzed yet</p>
                <p className="text-xs text-gray-300">Upload a contract to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Risk Level Bars */}
                <RiskBar
                  label="High"
                  count={analytics.risks.by_level.HIGH || 0}
                  total={analytics.risks.total}
                  color="bg-red-500"
                  textColor="text-red-700"
                />
                <RiskBar
                  label="Medium"
                  count={analytics.risks.by_level.MEDIUM || 0}
                  total={analytics.risks.total}
                  color="bg-amber-500"
                  textColor="text-amber-700"
                />
                <RiskBar
                  label="Low"
                  count={analytics.risks.by_level.LOW || 0}
                  total={analytics.risks.total}
                  color="bg-emerald-500"
                  textColor="text-emerald-700"
                />

                {/* Risk Status Summary */}
                <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
                  <div className="flex items-center space-x-4">
                    <span className="text-xs text-gray-500">
                      <span className="font-semibold text-gray-900">{analytics.risks.by_status.OPEN || 0}</span> open
                    </span>
                    <span className="text-xs text-gray-500">
                      <span className="font-semibold text-gray-900">{analytics.risks.by_status.APPROVED || 0}</span> accepted
                    </span>
                    <span className="text-xs text-gray-500">
                      <span className="font-semibold text-gray-900">{analytics.risks.by_status.MITIGATED || 0}</span> mitigated
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Recent Activity ──────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Documents */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Recent Documents</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {analytics.recent_activity.recent_documents.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="mt-2 text-sm text-gray-400">No documents uploaded yet</p>
                <button
                  onClick={() => navigate('/app/projects/new')}
                  className="mt-2 text-xs font-medium text-primary hover:underline"
                >
                  Upload your first contract
                </button>
              </div>
            ) : (
              analytics.recent_activity.recent_documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{doc.file_name}</p>
                    <p className="text-xs text-gray-400">{doc.contract_name}</p>
                  </div>
                  <DocStatusBadge status={doc.status} />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Risks */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Latest Risk Findings</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {analytics.recent_activity.recent_risks.length === 0 ? (
              <div className="px-6 py-8 text-center">
                <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <p className="mt-2 text-sm text-gray-400">No risks detected yet</p>
              </div>
            ) : (
              analytics.recent_activity.recent_risks.map((risk) => (
                <div key={risk.id} className="flex items-start space-x-3 px-6 py-3">
                  <RiskLevelDot level={risk.risk_level} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{risk.description}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {risk.category} · {new Date(risk.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      risk.status === 'OPEN'
                        ? 'bg-yellow-100 text-yellow-700'
                        : risk.status === 'MITIGATED'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {risk.status.toLowerCase()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── Empty State / Getting Started ────────────────────── */}
      {!hasActivity && (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-gray-900">
            Get insights in minutes
          </h3>
          <p className="mt-2 max-w-md mx-auto text-sm text-gray-500">
            Upload your construction contracts and SIGN will automatically extract clauses,
            identify risks, and track obligations — saving you hours of manual review.
          </p>
          <button
            onClick={() => navigate('/app/projects/new')}
            className="mt-6 inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Your First Project
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-Components ─────────────────────────────────────────── */

function StatCard({
  label,
  value,
  icon,
  bgColor,
  subValue,
  subColor,
  onClick,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  bgColor: string;
  subValue?: string;
  subColor?: string;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition ${
        onClick ? 'cursor-pointer text-left hover:shadow-md hover:border-gray-300' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
          {subValue && (
            <p className={`mt-0.5 text-xs ${subColor || 'text-gray-400'}`}>{subValue}</p>
          )}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bgColor}`}>
          {icon}
        </div>
      </div>
    </Wrapper>
  );
}

function RiskBar({
  label,
  count,
  total,
  color,
  textColor,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  textColor: string;
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center space-x-3">
      <span className={`w-16 text-sm font-medium ${textColor}`}>{label}</span>
      <div className="flex-1">
        <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
          <div
            className={`h-full rounded-full ${color} transition-all duration-500`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <span className="w-8 text-right text-sm font-semibold text-gray-700">{count}</span>
    </div>
  );
}

function RiskLevelDot({ level }: { level: string }) {
  const color =
    level === 'HIGH'
      ? 'bg-red-500'
      : level === 'MEDIUM'
      ? 'bg-amber-500'
      : 'bg-emerald-500';
  return (
    <div className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${color}`} />
  );
}

function DocStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    UPLOADED: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Uploaded' },
    EXTRACTING_TEXT: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Extracting...' },
    TEXT_EXTRACTED: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Text Ready' },
    EXTRACTING_CLAUSES: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Analyzing...' },
    CLAUSES_EXTRACTED: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Complete' },
    FAILED: { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed' },
  };
  const c = config[status] || config.UPLOADED;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}
