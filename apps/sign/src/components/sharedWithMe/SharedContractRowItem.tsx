import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ContractStatusDot from '@/components/contracts/ContractStatusDot';
import SharedByLine from '@/components/sharedWithMe/SharedByLine';
import type { SharedContractRow } from '@/services/api/sharedContractsService';

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

export function SignaturePill({ signatureStatus }: { signatureStatus: string | null }) {
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

/**
 * One "shared contract" row — the shared surface behind BOTH the managing-side
 * "Shared with me" page (#8b, /app/shared-with-me) and the pure-guest dashboard
 * (#8c, /guest/dashboard). A single component keeps the two lists from drifting.
 *
 * The whole row is clickable → the guest-styled viewer at
 * /guest/shared/:contractId (the managing-JWT / bound viewer entry). Dates read
 * LTR even inside an RTL row; the chevron mirrors in RTL; contract + project
 * names isolate their own direction (Arabic name in an English UI and vice
 * versa).
 */
export default function SharedContractRowItem({ row }: { row: SharedContractRow }) {
  const navigate = useNavigate();
  const open = () => navigate(`/guest/shared/${row.contract_id}`);

  return (
    <div
      onClick={open}
      onKeyDown={(e) => {
        // Keyboard parity for the clickable row (WCAG 2.1.1) — Enter/Space open
        // the contract, matching native button activation.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={row.contract_name}
      className="group flex cursor-pointer items-center justify-between gap-3 px-6 py-4 transition-colors hover:bg-gray-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
    >
      <div className="flex min-w-0 items-center gap-4">
        {/* Shared-contract tile — same 36px shape as the project contract row,
            tinted primary with an arrow-into-tray glyph so a shared contract
            reads subtly different from an owned one. */}
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <svg className="h-4.5 w-4.5 text-primary" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
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
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </div>
  );
}
