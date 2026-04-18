import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminService, type AdminUser, type SystemHealthResponse, type ServiceStatus } from '@/services/api/adminService';
import { knowledgeAssetService } from '@/services/api/knowledgeAssetService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { KnowledgeAsset } from '@/types';

// ─── Health helpers ───────────────────────────────────────────────────────────

function statusDot(status: ServiceStatus) {
  if (status === 'up')      return 'bg-green-500';
  if (status === 'down')    return 'bg-red-500';
  if (status === 'skipped') return 'bg-gray-300';
  return 'bg-amber-400';
}

function statusLabel(status: ServiceStatus) {
  if (status === 'up')      return 'Up';
  if (status === 'down')    return 'Down';
  if (status === 'skipped') return 'Skipped';
  return status;
}

function overallBadgeClass(overall: SystemHealthResponse['overall']) {
  if (overall === 'HEALTHY')  return 'text-green-600';
  if (overall === 'DEGRADED') return 'text-amber-500';
  return 'text-red-600';
}

function overallIcon(overall: SystemHealthResponse['overall']) {
  if (overall === 'HEALTHY')  return '✓';
  if (overall === 'DEGRADED') return '⚠';
  return '✗';
}

function formatMs(ms?: number) {
  return ms !== undefined ? `${ms} ms` : '—';
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── SystemStatusCard ─────────────────────────────────────────────────────────

function SystemStatusCard({ health, isLoading, isError }: {
  health: SystemHealthResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-gray-500">System Status</p>
        <div className="mt-2 flex items-center gap-2">
          <LoadingSpinner size="sm" />
          <span className="text-sm text-gray-400">Checking…</span>
        </div>
      </div>
    );
  }

  if (isError || !health) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-gray-500">System Status</p>
        <p className="mt-1 text-lg font-bold text-red-500">⚠ Unavailable</p>
      </div>
    );
  }

  const { overall, timestamp, services } = health;

  const rows: Array<{
    label: string;
    status: ServiceStatus;
    detail?: string;
  }> = [
    {
      label: 'PostgreSQL',
      status: services.postgres.status,
      detail: formatMs(services.postgres.responseTime),
    },
    {
      label: 'Redis',
      status: services.redis.status,
      detail: formatMs(services.redis.responseTime),
    },
    {
      label: 'Email Queue',
      status: services.emailQueue.status,
      detail: services.emailQueue.status === 'up'
        ? `${services.emailQueue.waiting}w · ${services.emailQueue.active}a · ${services.emailQueue.failed}f`
        : '—',
    },
    {
      label: 'Job Queue',
      status: services.aiQueue.status,
      detail: services.aiQueue.status === 'up'
        ? `${services.aiQueue.waiting}w · ${services.aiQueue.active}a · ${services.aiQueue.failed}f`
        : '—',
    },
    {
      label: 'AI Backend',
      status: services.aiBackend.status,
      detail: formatMs(services.aiBackend.responseTime),
    },
    {
      label: 'S3 Storage',
      status: services.s3.status,
      detail: services.s3.status === 'skipped' ? 'Not configured' : undefined,
    },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header row — always visible */}
      <button
        className="flex w-full items-center justify-between p-6 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div>
          <p className="text-sm font-medium text-gray-500">System Status</p>
          <p className={`mt-1 text-lg font-bold ${overallBadgeClass(overall)}`}>
            {overallIcon(overall)} {overall}
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            Last checked {formatTime(timestamp)}
          </p>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable service rows */}
      {expanded && (
        <div className="border-t border-gray-100 px-6 pb-4">
          <div className="divide-y divide-gray-50">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${statusDot(row.status)}`}
                  />
                  <span className="text-sm text-gray-700">{row.label}</span>
                </div>
                <div className="flex items-center gap-3 text-right">
                  {row.detail && (
                    <span className="text-xs text-gray-400">{row.detail}</span>
                  )}
                  <span
                    className={`text-xs font-medium ${
                      row.status === 'up'
                        ? 'text-green-600'
                        : row.status === 'down'
                          ? 'text-red-600'
                          : 'text-gray-400'
                    }`}
                  >
                    {statusLabel(row.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Auto-refreshes every 60 s · w=waiting, a=active, f=failed
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pendingAssets, setPendingAssets] = useState<KnowledgeAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminService.getAllUsers().catch(() => [] as AdminUser[]),
      adminService.getPendingAssets().catch(() => []),
    ]).then(([usersData, assetsData]) => {
      setUsers(usersData);
      setPendingAssets(assetsData);
      setLoading(false);
    });
  }, []);

  const {
    data: health,
    isLoading: healthLoading,
    isError: healthError,
  } = useQuery({
    queryKey: ['admin', 'system-health'],
    queryFn: () => adminService.getSystemHealth(),
    refetchInterval: 60_000,
    retry: 2,
  });

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t('admin.dashboard')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('admin.subtitle')}</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('admin.totalUsers')}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{users.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('admin.activeUsers')}</p>
          <p className="mt-1 text-3xl font-bold text-green-600">
            {users.filter(u => u.is_active).length}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium text-gray-500">{t('admin.pendingReviews')}</p>
          <p className="mt-1 text-3xl font-bold text-yellow-600">{pendingAssets.length}</p>
        </div>

        {/* ── Real System Status card (replaces hardcoded "✓ Healthy") ── */}
        <SystemStatusCard
          health={health}
          isLoading={healthLoading}
          isError={healthError}
        />
      </div>

      {/* Pending Reviews */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('admin.pendingKnowledgeAssetReviews')}</h2>
          <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-700">
            {t('admin.pendingCount', { count: pendingAssets.length })}
          </span>
        </div>
        <div className="divide-y divide-gray-100">
          {pendingAssets.slice(0, 5).map((asset) => (
            <div key={asset.id} className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="font-medium text-gray-900">{asset.title}</p>
                <p className="text-xs text-gray-500">{asset.asset_type} • {asset.creator?.first_name} {asset.creator?.last_name}</p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={async () => {
                    await knowledgeAssetService.review(asset.id, 'APPROVED');
                    setPendingAssets(pendingAssets.filter(a => a.id !== asset.id));
                  }}
                  className="rounded-lg bg-green-100 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-200"
                >
                  {t('common.approve')}
                </button>
                <button
                  onClick={async () => {
                    await knowledgeAssetService.review(asset.id, 'REJECTED');
                    setPendingAssets(pendingAssets.filter(a => a.id !== asset.id));
                  }}
                  className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
                >
                  {t('common.reject')}
                </button>
              </div>
            </div>
          ))}
          {pendingAssets.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-gray-500">{t('admin.noPendingReviews')}</div>
          )}
        </div>
      </div>

      {/* Recent Users */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('admin.recentUsers')}</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-6 py-3">{t('common.name')}</th>
              <th className="px-6 py-3">{t('common.email')}</th>
              <th className="px-6 py-3">{t('common.role')}</th>
              <th className="px-6 py-3">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.slice(0, 10).map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-3 text-sm font-medium text-gray-900">
                  {user.first_name} {user.last_name}
                </td>
                <td className="px-6 py-3 text-sm text-gray-500">{user.email}</td>
                <td className="px-6 py-3">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {user.role.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {user.is_active ? t('common.active') : t('common.inactive')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
