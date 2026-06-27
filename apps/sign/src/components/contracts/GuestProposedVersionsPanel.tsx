import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import type { ContractClause, DocumentUpload } from '@/types';

type ProposedVersion = { doc: DocumentUpload; proposed: ContractClause[] };

/**
 * Host-v1 view (Slice 1) — surfaces the new contract versions a bound guest
 * submitted, with the PROPOSED clauses extracted from each (Option C).
 *
 * These clauses are excluded from every default contract read, so a finished
 * guest upload would otherwise VANISH from the host's view once it left the
 * "processing" banner. This panel gives those uploads a persistent home: it
 * lists each guest document that carries proposed clauses and lets the host
 * expand to read them.
 *
 * v1 is READ-ONLY — accept / reject / merge and side-by-side diff are Slice 2.
 * A guest document is identified here by "has proposed clauses" (the host's own
 * original documents have none).
 */
export default function GuestProposedVersionsPanel({
  contractId,
}: {
  contractId: string;
}) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<ProposedVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const docs = await documentProcessingService.getDocuments(contractId);
        const enriched = await Promise.all(
          docs.map(async (doc) => {
            try {
              const proposed =
                await documentProcessingService.getProposedClauses(
                  contractId,
                  doc.id,
                );
              return { doc, proposed };
            } catch {
              return { doc, proposed: [] as ContractClause[] };
            }
          }),
        );
        if (!cancelled) {
          setVersions(enriched.filter((v) => v.proposed.length > 0));
        }
      } catch {
        if (!cancelled) setVersions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  // Nothing to show — no guest-submitted versions. Render nothing (no empty
  // header), so the panel only appears when there is something to review.
  if (loading || versions.length === 0) return null;

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <svg
          aria-hidden="true"
          className="h-5 w-5 text-violet-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 8h10M7 12h6m-6 4h10M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z"
          />
        </svg>
        <h3 className="text-sm font-semibold text-violet-900">
          {t('contract.proposedVersions.title')}
        </h3>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
          {versions.length}
        </span>
      </div>
      <p className="mb-4 text-xs text-violet-700/80">
        {t('contract.proposedVersions.subtitle')}
      </p>

      <div className="space-y-3">
        {versions.map(({ doc, proposed }) => {
          const isOpen = !!expanded[doc.id];
          const name = doc.original_name || doc.file_name;
          return (
            <div
              key={doc.id}
              className="rounded-lg border border-violet-100 bg-white"
            >
              <button
                type="button"
                onClick={() =>
                  setExpanded((e) => ({ ...e, [doc.id]: !e[doc.id] }))
                }
                className="flex w-full items-center gap-3 px-4 py-3 text-start"
                aria-expanded={isOpen}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium text-gray-800"
                    dir="auto"
                    style={{ unicodeBidi: 'plaintext' }}
                  >
                    {name}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {t('contract.proposedVersions.byGuest')} ·{' '}
                    {t('contract.proposedVersions.clauseCount', {
                      count: proposed.length,
                    })}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  {String(doc.processing_status).replace(/_/g, ' ')}
                </span>
                <svg
                  aria-hidden="true"
                  className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {isOpen && (
                <div className="space-y-2 border-t border-violet-100 p-4">
                  {proposed.map((cc) => (
                    <div
                      key={cc.id}
                      className="rounded-md border border-gray-100 bg-gray-50/60 p-3"
                    >
                      <p
                        className="text-sm font-medium text-gray-800"
                        dir="auto"
                        style={{ unicodeBidi: 'plaintext' }}
                      >
                        {cc.section_number ? `${cc.section_number}. ` : ''}
                        {cc.clause?.title}
                      </p>
                      {cc.clause?.content && (
                        <p
                          className="mt-1 whitespace-pre-wrap text-xs text-gray-600"
                          dir="auto"
                          style={{ unicodeBidi: 'plaintext' }}
                        >
                          {cc.clause.content}
                        </p>
                      )}
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] italic text-violet-600/80">
                    {t('contract.proposedVersions.reviewOnlyNote')}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
