import { useState, useEffect } from 'react';
import { obligationService } from '@/services/api/obligationService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { Obligation } from '@/types';

const statusConfig: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  PENDING: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', label: 'Pending' },
  IN_PROGRESS: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400', label: 'In Progress' },
  COMPLETED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-400', label: 'Completed' },
  OVERDUE: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500', label: 'Overdue' },
};

export default function ObligationsPage() {
  const [view, setView] = useState<'upcoming' | 'overdue' | 'all'>('upcoming');
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [dashboard, setDashboard] = useState<{
    total: number;
    by_status: Record<string, number>;
    overdue_count: number;
    upcoming_7_days: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [view]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [dashboardData, obligationData] = await Promise.all([
        obligationService.getDashboard(),
        view === 'overdue'
          ? obligationService.getOverdue()
          : view === 'upcoming'
          ? obligationService.getUpcoming(30)
          : obligationService.getUpcoming(365),
      ]);
      setDashboard(dashboardData);
      setObligations(obligationData);
    } catch (err) {
      console.error('Failed to load obligations:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await obligationService.complete(id);
      loadData();
    } catch (err) {
      console.error('Failed to complete obligation:', err);
    }
  };

  const isOverdue = (dueDate: string | null, status: string) => {
    if (status === 'COMPLETED') return false;
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  const daysUntilDue = (dueDate: string | null) => {
    if (!dueDate) return null;
    return Math.ceil(
      (new Date(dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24),
    );
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Obligations</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track deadlines and compliance requirements across your contracts
        </p>
      </div>

      {/* Stats */}
      {dashboard && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Total"
            value={dashboard.total}
            icon={
              <svg className="h-5 w-5 text-gray-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
              </svg>
            }
          />
          <StatCard
            label="Pending"
            value={dashboard.by_status?.PENDING || 0}
            color="text-amber-600"
            icon={
              <svg className="h-5 w-5 text-amber-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <StatCard
            label="Overdue"
            value={dashboard.overdue_count}
            color="text-red-600"
            urgent={dashboard.overdue_count > 0}
            icon={
              <svg className="h-5 w-5 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            }
          />
          <StatCard
            label="Due This Week"
            value={dashboard.upcoming_7_days}
            color="text-blue-600"
            icon={
              <svg className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
            }
          />
        </div>
      )}

      {/* View Tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 w-fit">
        {([
          { key: 'upcoming', label: 'Upcoming' },
          { key: 'overdue', label: 'Overdue' },
          { key: 'all', label: 'All' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setView(tab.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
              view === tab.key
                ? 'bg-navy-900 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Obligations List */}
      <div className="rounded-xl border border-gray-200/80 bg-white shadow-card overflow-hidden">
        {obligations.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="mx-auto h-10 w-10 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="mt-3 text-sm font-medium text-gray-500">No obligations found</p>
            <p className="text-xs text-gray-400">Obligations are extracted automatically from your contracts</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {obligations.map((obligation) => {
              const days = daysUntilDue(obligation.due_date);
              const overdue = isOverdue(obligation.due_date, obligation.status);
              const effectiveStatus = overdue ? 'OVERDUE' : obligation.status;
              const config = statusConfig[effectiveStatus] || statusConfig.PENDING;

              return (
                <div
                  key={obligation.id}
                  className={`flex items-center justify-between px-5 py-4 transition-colors hover:bg-gray-50/50 ${
                    overdue ? 'bg-red-50/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    {/* Status indicator */}
                    <div className={`h-2 w-2 flex-shrink-0 rounded-full ${config.dot}`} />

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {obligation.description}
                      </p>
                      <div className="mt-0.5 flex items-center gap-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${config.bg} ${config.text}`}>
                          {config.label}
                        </span>
                        {obligation.responsible_party && (
                          <span className="text-xs text-gray-400">{obligation.responsible_party}</span>
                        )}
                        {obligation.frequency && (
                          <span className="text-xs text-gray-400">{obligation.frequency}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0 ltr:ml-4 rtl:mr-4">
                    {/* Due date */}
                    {obligation.due_date && (
                      <div className="text-right">
                        <p className={`text-xs font-medium ${overdue ? 'text-red-600' : 'text-gray-700'}`}>
                          {new Date(obligation.due_date).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                        {days !== null && (
                          <p className={`text-[11px] ${overdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                            {overdue ? `${Math.abs(days)}d overdue` : `${days}d remaining`}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Complete action */}
                    {obligation.status !== 'COMPLETED' && (
                      <button
                        onClick={() => handleComplete(obligation.id)}
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:border-gray-300"
                      >
                        Complete
                      </button>
                    )}
                    {obligation.status === 'COMPLETED' && (
                      <svg className="h-5 w-5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-Component ──────────────────────────────────────────── */

function StatCard({
  label,
  value,
  color,
  urgent,
  icon,
}: {
  label: string;
  value: number;
  color?: string;
  urgent?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-card ${
        urgent ? 'border-red-200' : 'border-gray-200/80'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${urgent ? 'bg-red-50' : 'bg-gray-50'}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
