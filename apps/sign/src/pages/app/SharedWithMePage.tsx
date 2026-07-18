import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import ContractStatusDot from '@/components/contracts/ContractStatusDot';
import SharedByLine from '@/components/sharedWithMe/SharedByLine';
import {
  getMyShares,
  type SharedContractRow,
} from '@/services/api/sharedContractsService';

/**
 * Signature pill — shown only when `signature_status` is non-null. Per the
 * approved design (which supersedes the spec's FULLY_EXECUTED-only pill), all
 * three states render: Fully Executed (emerald) / Awaiting Counterparty
 * (amber) / Pending Signature (gray). Unknown values render nothing.
 */
const SIG_CONFIG: Record<string, { bg: string; text: string; dot: string; key: string }> = {
  FULLY_EXECUTED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', key: 'fullyExecuted' },
  AWAITING_COUNTERPARTY: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400', key: 'awaitingCounterparty' },
  PENDING_SIGNATURE: { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400', key: 'pendingSignature' },
};

function SignaturePill({ signatureStatus }: { signatureStatus: string | null }) {
  const { t } = useTranslation();
  if (!signatureStatus) return null;
  const config = SIG_CONFIG[signatureStatus];
  if (!config) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {t(`sharedWithMe.signature.${config.key}`)}
    </span>
  );
}

function SharedContractRowItem({ row }: { row: SharedContractRow }) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/guest/shared/${row.contract_id}`)}
      className="group flex cursor-pointer items-center justify-between gap-3 px-6 py-4 transition-colors hover:bg-gray-50/80"
    >
      <div className="flex min-w-0 items-center gap-4">
        {/* Shared-contract tile — same 36px shape as the project contract row,
            tinted primary with an arrow-into-tray glyph so a shared contract
            reads subtly different from an owned one. */}
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <svg className="h-4.5 w-4.5 text-primary" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15" />
          </svg>
        </div>
        <div className="min-w-0">
          <p
            className="truncate text-sm font-semibold text-gray-900 transition-colors group-hover:text-primary"
            dir="auto"
            style={{ unicodeBidi: 'plaintext' }}
          >
            {row.contract_name}
          </p>
          <SharedByLine org={row.shared_by_org} user={row.shared_by_user} />
          <p className="mt-0.5 truncate text-xs text-gray-400">
            {row.contract_type.replace(/_/g, ' ')}
            {row.project_name && (
              <>
                {' · '}
                <span dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                  {row.project_name}
                </span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        <ContractStatusDot status={row.status} />
        <SignaturePill signatureStatus={row.signature_status} />
        {/* Dates always read LTR, even inside an RTL row. */}
        <span className="text-xs text-gray-400" dir="ltr">
          {new Date(row.granted_at).toLocaleDateString()}
        </span>
        {/* Forward chevron — mirrored so it points "forward" in RTL too. */}
        <svg
          className="h-4 w-4 text-gray-300 transition-colors group-hover:text-gray-400 rtl:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </div>
  );
}

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
