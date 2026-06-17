import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import ErpConnectionFormModal from '@/components/erp/ErpConnectionFormModal';
import ErpFieldMappingsModal from '@/components/erp/ErpFieldMappingsModal';
import ErpSyncHistoryModal from '@/components/erp/ErpSyncHistoryModal';
import { CONNECTION_STATUS_BADGE } from '@/components/erp/erpConstants';
import { erpService, type ErpConnection } from '@/services/api/erpService';

/** Stable Latin-numeral date (lesson #137). */
function formatDate(iso: string | null, fallback: string): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

type ModalKind = 'create' | 'edit' | 'mappings' | 'history' | null;

/**
 * Phase 7.28 Part 2a — Client Portal "ERP Connections" (OWNER_ADMIN).
 *
 * Lists this org's ERP connections; create/edit (write-only credentials),
 * configure field mappings, and run/monitor imports. Import-only — there is no
 * export action. The endpoints are feature-gated (404 when the feature is off);
 * a 404 renders a graceful "not available" notice rather than crashing.
 */
export default function ErpConnectionsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalKind>(null);
  const [selected, setSelected] = useState<ErpConnection | null>(null);

  const connectionsQuery = useQuery({
    queryKey: ['erp-connections'],
    queryFn: () => erpService.listConnections(),
    retry: 1,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => erpService.deleteConnection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erp-connections'] });
      toast.success(t('erp.toast.deleted'));
    },
    onError: () => toast.error(t('erp.toast.deleteError')),
  });

  const open = (kind: ModalKind, conn: ErpConnection | null = null) => {
    setSelected(conn);
    setModal(kind);
  };
  const close = () => {
    setModal(null);
    setSelected(null);
  };

  const handleDelete = (conn: ErpConnection) => {
    if (window.confirm(t('erp.confirmDelete', { name: conn.name }))) {
      deleteMutation.mutate(conn.id);
    }
  };

  const featureOff =
    connectionsQuery.isError &&
    (connectionsQuery.error as { response?: { status?: number } })?.response
      ?.status === 404;

  const connections = connectionsQuery.data ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('erp.title')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('erp.subtitle')}</p>
        </div>
        {!featureOff && (
          <button
            type="button"
            onClick={() => open('create')}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
          >
            {t('erp.addConnection')}
          </button>
        )}
      </div>

      {/* Feature-off (404) — graceful, no crash */}
      {featureOff && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">{t('erp.featureOff')}</p>
        </div>
      )}

      {/* Loading */}
      {!featureOff && connectionsQuery.isLoading && (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Error (non-404) */}
      {!featureOff && connectionsQuery.isError && !connectionsQuery.isLoading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{t('erp.loadError')}</p>
          <button
            type="button"
            onClick={() => connectionsQuery.refetch()}
            className="mt-2 text-sm font-medium text-red-700 underline"
          >
            {t('erp.retry')}
          </button>
        </div>
      )}

      {/* Empty */}
      {!featureOff &&
        !connectionsQuery.isLoading &&
        !connectionsQuery.isError &&
        connections.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center">
            <p className="text-sm font-medium text-gray-700">{t('erp.empty.title')}</p>
            <p className="mt-1 text-sm text-gray-500">{t('erp.empty.subtitle')}</p>
            <button
              type="button"
              onClick={() => open('create')}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
            >
              {t('erp.addConnection')}
            </button>
          </div>
        )}

      {/* Data */}
      {!featureOff && connections.length > 0 && (
        <div className="overflow-x-auto w-full rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500 ltr:text-left rtl:text-right">
                <th className="px-4 py-3 font-medium">{t('erp.col.name')}</th>
                <th className="px-4 py-3 font-medium">{t('erp.col.vendor')}</th>
                <th className="px-4 py-3 font-medium">{t('erp.col.status')}</th>
                <th className="px-4 py-3 font-medium">{t('erp.col.lastSync')}</th>
                <th className="px-4 py-3 font-medium ltr:text-right rtl:text-left">
                  {t('erp.col.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {connections.map((conn) => (
                <tr key={conn.id} className="border-b border-gray-50 last:border-0">
                  <td
                    className="px-4 py-3 font-medium text-gray-800"
                    dir="auto"
                    style={{ unicodeBidi: 'plaintext' }}
                  >
                    {conn.name}
                    {!conn.enabled && (
                      <span className="ltr:ml-2 rtl:mr-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        {t('erp.disabled')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{conn.vendor}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CONNECTION_STATUS_BADGE[conn.status]}`}
                    >
                      {t(`erp.status.${conn.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">
                    {formatDate(conn.last_sync_at, t('erp.never'))}
                  </td>
                  <td className="px-4 py-3 ltr:text-right rtl:text-left">
                    <div className="inline-flex flex-wrap gap-2 ltr:justify-end rtl:justify-start">
                      <button
                        type="button"
                        onClick={() => open('history', conn)}
                        className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {t('erp.action.sync')}
                      </button>
                      <button
                        type="button"
                        onClick={() => open('mappings', conn)}
                        className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {t('erp.action.mappings')}
                      </button>
                      <button
                        type="button"
                        onClick={() => open('edit', conn)}
                        className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(conn)}
                        className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {(modal === 'create' || modal === 'edit') && (
        <ErpConnectionFormModal
          isOpen
          onClose={close}
          connection={modal === 'edit' ? selected : null}
        />
      )}
      {modal === 'mappings' && selected && (
        <ErpFieldMappingsModal isOpen onClose={close} connection={selected} />
      )}
      {modal === 'history' && selected && (
        <ErpSyncHistoryModal isOpen onClose={close} connection={selected} />
      )}
    </div>
  );
}
