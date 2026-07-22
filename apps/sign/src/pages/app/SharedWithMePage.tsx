import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import SharedContractRowItem from '@/components/sharedWithMe/SharedContractRowItem';
import { getMyShares } from '@/services/api/sharedContractsService';

/**
 * "Shared with me" (#8b) — lists the contracts OTHER orgs shared with this
 * user (their guest_contract_access bindings, via GET /guest/my-contracts).
 * Rows arrive newest-share-first from the API; clicking a row opens the
 * guest-styled viewer at /guest/shared/:contractId.
 */
export default function SharedWithMePage() {
  const { t } = useTranslation();

  const {
    data: rows,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    // Shared cache with the Sidebar nav badge and the shared-viewer banner —
    // one fetch serves all three consumers.
    queryKey: ['guest-my-contracts'],
    queryFn: getMyShares,
  });

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('sharedWithMe.title')}</h1>
        <p className="mt-1 text-sm text-gray-500">{t('sharedWithMe.subtitle')}</p>
      </div>

      {/* The shared-contracts card */}
      <div className="rounded-xl border border-gray-200/80 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <h2 className="text-[15px] font-semibold text-gray-900">{t('sharedWithMe.cardTitle')}</h2>
            {rows && rows.length > 0 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {rows.length}
              </span>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : isError ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-red-600">{t('sharedWithMe.error.title')}</p>
            <p className="mt-1 text-xs text-gray-400">{t('sharedWithMe.error.subtitle')}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-4 rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              {t('sharedWithMe.error.retry')}
            </button>
          </div>
        ) : rows && rows.length > 0 ? (
          <div className="divide-y divide-gray-50">
            {rows.map((row) => (
              <SharedContractRowItem key={row.contract_id} row={row} />
            ))}
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gray-50">
              <svg className="h-6 w-6 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
              </svg>
            </div>
            <p className="mt-3 text-sm font-medium text-gray-500">{t('sharedWithMe.empty.title')}</p>
            <p className="mt-1 text-xs text-gray-400">{t('sharedWithMe.empty.subtitle')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
