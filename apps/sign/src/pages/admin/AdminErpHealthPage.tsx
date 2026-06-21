import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { adminService } from '@/services/api/adminService';
import type { ErpConnection } from '@/services/api/erpService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  CONNECTION_STATUS_BADGE,
  OPERATOR_HOLD_BADGE,
} from '@/components/erp/erpConstants';
import ErpAdminActionModal, {
  type ErpAdminAction,
} from '@/components/erp/ErpAdminActionModal';

/** Stable Latin-numeral timestamp (lesson #137), matching Part 2a. */
function formatDateTime(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Display the operator who placed the hold: their name/email for a manual
 * suspend, "System" for an auto-suspend, "—" when not held. (`hold_by_user_id`
 * may be null for a manual hold if the operator's user row was later deleted.)
 */
function suspendedBy(conn: ErpConnection, t: (k: string) => string): string {
  if (conn.operator_hold_state === 'none') return '—';
  if (conn.operator_hold_state === 'auto_suspended') return t('erp.admin.systemActor');
  return conn.hold_by_name || conn.hold_by_email || t('erp.admin.unknownOperator');
}

const TOAST_KEY: Record<ErpAdminAction, string> = {
  suspend: 'suspended',
  unsuspend: 'unsuspended',
  'force-check': 'forceCheckRequested',
  delete: 'deleted',
};

/**
 * Phase 7.28 v1.1 Part B — SYSTEM_ADMIN cross-tenant "ERP Health" dashboard.
 *
 * Extends the Part 2b read-only monitor with operator ACTIONS against the Part A
 * endpoints: suspend (when no hold), unsuspend (when held), force-check (always),
 * and a guarded delete (only when held, with a second confirm). Every action
 * requires a reason and refetches on success. Feature-off (404) stays graceful.
 */
export default function AdminErpHealthPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<{ action: ErpAdminAction; conn: ErpConnection } | null>(
    null,
  );

  const { data: connections = [], isLoading, isError, error } = useQuery<ErpConnection[]>({
    queryKey: ['admin', 'erp-health'],
    queryFn: () => adminService.getErpConnections(),
    retry: 1,
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, id, reason }: { action: ErpAdminAction; id: string; reason: string }) => {
      switch (action) {
        case 'suspend':
          return adminService.suspendErpConnection(id, reason);
        case 'unsuspend':
          return adminService.unsuspendErpConnection(id, reason);
        case 'force-check':
          return adminService.forceCheckErpConnection(id, reason);
        case 'delete':
          return adminService.deleteErpConnection(id, reason);
      }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'erp-health'] });
      toast.success(t(`erp.admin.toast.${TOAST_KEY[vars.action]}`));
      setModal(null);
    },
    onError: () => toast.error(t('erp.admin.toast.actionError')),
  });

  const featureOff =
    isError && (error as { response?: { status?: number } })?.response?.status === 404;

  const open = (action: ErpAdminAction, conn: ErpConnection) => setModal({ action, conn });

  return (
    <div className="p-6 space-y-6">
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
                {['organization', 'connection', 'vendor', 'status', 'hold', 'lastSync', 'actions'].map((c) => (
                  <th key={c} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    {t(`erp.admin.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {connections.map((conn) => {
                const held = conn.operator_hold_state !== 'none';
                return (
                  <tr key={conn.id} className="hover:bg-gray-50 transition-colors align-top">
                    <td className="px-4 py-3 text-sm text-gray-700" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                      {conn.organization_id}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-800" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                      {conn.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{conn.vendor}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONNECTION_STATUS_BADGE[conn.status]}`}>
                        {t(`erp.status.${conn.status}`)}
                      </span>
                      {conn.error_message && (
                        <p className="mt-1 text-xs text-red-600" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                          {conn.error_message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${OPERATOR_HOLD_BADGE[conn.operator_hold_state]}`}>
                        {t(`erp.admin.holdState.${conn.operator_hold_state}`)}
                      </span>
                      {held && (
                        <div className="mt-1 space-y-0.5">
                          {conn.hold_reason && (
                            <p className="text-xs text-gray-600" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                              {conn.hold_reason}
                            </p>
                          )}
                          <p className="text-xs text-gray-500" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                            {t('erp.admin.suspendedBy')}: {suspendedBy(conn, t)}
                          </p>
                          <p className="text-xs text-gray-400" dir="ltr">
                            {t('erp.admin.heldAt')}: {formatDateTime(conn.hold_at, '—')}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500" dir="ltr">
                      {formatDateTime(conn.last_sync_at, t('erp.never'))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {held ? (
                          <button
                            type="button"
                            onClick={() => open('unsuspend', conn)}
                            className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            {t('erp.admin.action.unsuspend.button')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => open('suspend', conn)}
                            className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            {t('erp.admin.action.suspend.button')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => open('force-check', conn)}
                          className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {t('erp.admin.action.forceCheck.button')}
                        </button>
                        <button
                          type="button"
                          onClick={() => open('delete', conn)}
                          disabled={!held}
                          title={!held ? t('erp.admin.action.delete.requiresHold') : undefined}
                          className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {t('erp.admin.action.delete.button')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ErpAdminActionModal
          isOpen
          onClose={() => setModal(null)}
          action={modal.action}
          connectionName={modal.conn.name}
          isPending={actionMutation.isPending}
          onConfirm={(reason) =>
            actionMutation.mutate({ action: modal.action, id: modal.conn.id, reason })
          }
        />
      )}
    </div>
  );
}
