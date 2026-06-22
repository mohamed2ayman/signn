import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Contract } from '@/types';
import GuestClauseCard from './GuestClauseCard';
import { downloadGuestContractPdf } from '@/services/api/guestService';

/**
 * Read-only contract header + clause list for the Guest Portal viewer.
 *
 * `guestJwt` is present ONLY once the guest has established a durable identity
 * (Path B). The watermarked-download affordance is gated on it: a passwordless
 * viewer (Path A) has no `guestJwt` and sees no Download button — consistent
 * with the backend route, which requires account_type=GUEST.
 */
export default function GuestContractView({
  contract,
  guestJwt,
}: {
  contract: Contract;
  guestJwt?: string | null;
}) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const clauses = [...(contract.contract_clauses ?? [])].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );

  const handleDownload = async () => {
    if (!guestJwt || downloading) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      await downloadGuestContractPdf(contract.id, guestJwt);
    } catch {
      // No-leak error — never surface status/identity, mirror the viewer's
      // generic error handling.
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div>
      {/* Contract header */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {contract.contract_type}
          </span>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            {String(contract.status).replace(/_/g, ' ')}
          </span>
        </div>
        <h1
          className="mt-3 text-xl font-semibold text-gray-900 sm:text-2xl"
          dir="auto"
          style={{ unicodeBidi: 'plaintext', overflowWrap: 'anywhere' }}
        >
          {contract.name}
        </h1>
        {(contract.party_first_name || contract.party_second_name) && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {contract.party_first_name && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">
                  {t('guest.contractView.firstParty')}
                </div>
                <div
                  className="text-sm text-gray-700"
                  dir="auto"
                  style={{ unicodeBidi: 'plaintext' }}
                >
                  {contract.party_first_name}
                </div>
              </div>
            )}
            {contract.party_second_name && (
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">
                  {t('guest.contractView.secondParty')}
                </div>
                <div
                  className="text-sm text-gray-700"
                  dir="auto"
                  style={{ unicodeBidi: 'plaintext' }}
                >
                  {contract.party_second_name}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Clauses */}
      <div className="relative mt-6">
        {/* Subtle read-only watermark behind the clause list */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 flex items-start justify-center overflow-hidden"
        >
          <span className="mt-24 select-none text-5xl font-bold uppercase tracking-widest text-gray-900/[0.03] sm:text-7xl">
            {t('guest.contractView.watermark')}
          </span>
        </div>

        <div className="relative z-10">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-700">
              {t('guest.contractView.clauses')}
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
                {clauses.length}
              </span>
            </h2>
            {guestJwt && (
              <div className="flex flex-col items-end">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.06] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <svg
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"
                    />
                  </svg>
                  {downloading
                    ? t('guest.contractView.downloading')
                    : t('guest.contractView.download')}
                </button>
                {downloadError && (
                  <span className="mt-1 text-[11px] text-red-500" dir="auto">
                    {t('guest.contractView.downloadError')}
                  </span>
                )}
              </div>
            )}
          </div>

          {clauses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-400">
              {t('guest.contractView.noClauses')}
            </div>
          ) : (
            <div className="space-y-3">
              {clauses.map((cc) =>
                cc.clause ? (
                  <GuestClauseCard
                    key={cc.id}
                    clause={cc.clause}
                    sectionNumber={cc.section_number}
                  />
                ) : null,
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
