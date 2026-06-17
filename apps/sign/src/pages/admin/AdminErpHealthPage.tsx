import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminService } from '@/services/api/adminService';
import type { ErpConnection } from '@/services/api/erpService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { CONNECTION_STATUS_BADGE } from '@/components/erp/erpConstants';

/** Stable Latin-numeral timestamp (lesson #137), matching Part 2a. */
function formatDateTime(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Phase 7.28 Part 2b — SYSTEM_ADMIN cross-tenant "ERP Health" dashboard.
 *
 * READ-ONLY monitoring of every org's ERP connection (org, vendor, status, last
 * sync, error) from GET /admin/erp/connections. No mutation actions, nothing
 * credential-related. Mirrors AdminWaitlistPage (React Query, three states,
 * admin service layer). Feature-gated: a 404 (ERP off) renders a graceful
 * notice instead of crashing, consistent with Part 2a.
 */
export default function AdminErpHealthPage() {
  const { t } = useTranslation();

  const { data: connections = [], isLoading, isError, error } = useQuery<ErpConnection[]>({
    queryKey: ['admin', 'erp-health'],
    queryFn: () => adminService.getErpConnections(),
    retry: 1,
  });

  const featureOff =
    isError && (error as { response?: { status?: number } })?.response?.status === 404;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{t('erp.admin.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('erp.admin.subtitle')}</p>
      </div>

      {featureOff ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {t('erp.admin.featureOff')}
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          {t('erp.admin.loadError')}
        </div>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center">
          <svg className="mx-auto mb-3 h-10 w-10 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
          </svg>
          <p className="text-sm text-gray-400">{t('erp.admin.empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto w-full rounded-xl border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('erp.admin.col.organization')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('erp.admin.col.connection')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('erp.admin.col.vendor')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('erp.admin.col.status')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('erp.admin.col.lastSync')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  {t('erp.admin.col.error')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {connections.map((conn) => (
                <tr key={conn.id} className="hover:bg-gray-50 transition-colors">
                  <td
                    className="px-4 py-3 text-sm text-gray-700"
                    dir="auto"
                    style={{ unicodeBidi: 'plaintext' }}
                  >
                    {conn.organization_id}
                  </td>
                  <td
                    className="px-4 py-3 text-sm font-medium text-gray-800"
                    dir="auto"
                    style={{ unicodeBidi: 'plaintext' }}
                  >
                    {conn.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{conn.vendor}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONNECTION_STATUS_BADGE[conn.status]}`}
                    >
                      {t(`erp.status.${conn.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500" dir="ltr">
                    {formatDateTime(conn.last_sync_at, t('erp.never'))}
                  </td>
                  <td
                    className="px-4 py-3 text-sm text-red-600"
                    dir="auto"
                    style={{ unicodeBidi: 'plaintext' }}
                  >
                    {conn.error_message || <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
