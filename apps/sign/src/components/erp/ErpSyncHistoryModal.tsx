import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import ModalShell from '@/components/obligations/ModalShell';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  erpService,
  type ErpConnection,
  type ErpSyncJob,
} from '@/services/api/erpService';
import { JOB_STATUS_BADGE, ACTIVE_JOB_STATUSES } from './erpConstants';

/** Stable Latin-numeral timestamp (lesson #137 — no Intl ar-EG on dates). */
function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

/**
 * Phase 7.28 Part 2a — "Sync now" + sync history for one connection.
 *
 * IMPORT-ONLY: the trigger enqueues an import/cost job; there is no export
 * action. The jobs list polls every 4s WHILE any job is pending/running and
 * stops once all jobs reach a terminal state.
 */
export default function ErpSyncHistoryModal({
  isOpen,
  onClose,
  connection,
}: {
  isOpen: boolean;
  onClose: () => void;
  connection: ErpConnection;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ['erp-jobs', connection.id],
    queryFn: () => erpService.listJobs(connection.id),
    enabled: isOpen,
    refetchInterval: (q) => {
      const data = q.state.data as ErpSyncJob[] | undefined;
      if (!data || data.length === 0) return false;
      const hasActive = data.some((j) => ACTIVE_JOB_STATUSES.includes(j.status));
      return hasActive ? 4000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const syncMutation = useMutation({
    mutationFn: () => erpService.triggerSync(connection.id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['erp-jobs', connection.id] });
      toast.success(res.reused ? t('erp.sync.alreadyQueued') : t('erp.sync.queued'));
    },
    onError: () => toast.error(t('erp.sync.error')),
  });

  const jobs = jobsQuery.data ?? [];
  const canSync = connection.enabled && !syncMutation.isPending;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={t('erp.sync.title')}
      subtitle={connection.name}
      size="lg"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('common.close')}
        </button>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600">{t('erp.sync.help')}</p>
        <button
          type="button"
          onClick={() => syncMutation.mutate()}
          disabled={!canSync}
          className="flex-shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
        >
          {syncMutation.isPending ? t('erp.sync.starting') : t('erp.sync.syncNow')}
        </button>
      </div>

      {!connection.enabled && (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {t('erp.sync.disabledNotice')}
        </p>
      )}

      {jobsQuery.isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : jobsQuery.isError ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {t('erp.sync.loadError')}
        </p>
      ) : jobs.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          {t('erp.sync.noJobs')}
        </p>
      ) : (
        <div className="overflow-x-auto w-full">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500 ltr:text-left rtl:text-right">
                <th className="px-3 py-2 font-medium">{t('erp.sync.col.status')}</th>
                <th className="px-3 py-2 font-medium">{t('erp.sync.col.records')}</th>
                <th className="px-3 py-2 font-medium">{t('erp.sync.col.started')}</th>
                <th className="px-3 py-2 font-medium">{t('erp.sync.col.finished')}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-gray-50 last:border-0 align-top">
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${JOB_STATUS_BADGE[job.status]}`}
                    >
                      {t(`erp.jobStatus.${job.status}`)}
                    </span>
                    {job.error && (
                      <p
                        className="mt-1 text-xs text-red-600"
                        dir="auto"
                        style={{ unicodeBidi: 'plaintext' }}
                      >
                        {job.error}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-700" dir="ltr">
                    {t('erp.sync.recordsSummary', {
                      imported: job.records_imported,
                      processed: job.records_processed,
                      failed: job.records_failed,
                    })}
                  </td>
                  <td className="px-3 py-2 text-gray-600" dir="ltr">
                    {formatDateTime(job.started_at)}
                  </td>
                  <td className="px-3 py-2 text-gray-600" dir="ltr">
                    {formatDateTime(job.finished_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  );
}
