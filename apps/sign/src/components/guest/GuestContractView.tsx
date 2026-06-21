import { useTranslation } from 'react-i18next';
import type { Contract } from '@/types';
import GuestClauseCard from './GuestClauseCard';

/** Read-only contract header + clause list for the Guest Portal viewer. */
export default function GuestContractView({ contract }: { contract: Contract }) {
  const { t } = useTranslation();
  const clauses = [...(contract.contract_clauses ?? [])].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );

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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              {t('guest.contractView.clauses')}
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal text-gray-500">
                {clauses.length}
              </span>
            </h2>
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
