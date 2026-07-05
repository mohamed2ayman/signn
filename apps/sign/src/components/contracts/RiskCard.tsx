import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { RiskAnalysis } from '@/types';
// Reuse the SAME 17-category source as the clause-type editor so risk category
// labels stay in lock-step with clause_type labels (no duplicated list) and get
// the same AR/FR translations via the shared clauseTypeLabel helper.
import { CLAUSE_TYPE_LABELS, clauseTypeLabel } from '@/components/review/ClauseReviewCard';

/* ── Risk level colour map (identical to ContractDetailPage's RiskLevelBadge) ── */
const riskColors: Record<string, { bg: string; text: string; icon: string }> = {
  HIGH: { bg: 'bg-red-50', text: 'text-red-700', icon: 'text-red-500' },
  MEDIUM: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'text-amber-500' },
  LOW: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-500' },
};

// Level dropdown values — matches the RiskLevel enum (LOW/MEDIUM/HIGH only).
const RISK_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

interface RiskCardProps {
  risk: RiskAnalysis;
  /** Persist a level/category edit. Rejects → the card reverts optimistically. */
  onAnnotate: (
    riskId: string,
    data: { risk_level?: string; risk_category?: string },
  ) => Promise<void>;
}

/**
 * Phase 8.3 — editable risk card. Same layout/look as the read-only card it
 * replaces; the level badge and category are now dropdowns (mirroring the
 * clause-type edit pattern in ClauseReviewCard: optimistic set + revert on
 * failure). Everything else (status pill, description, recommendation,
 * citation) is unchanged.
 */
export default function RiskCard({ risk, onAnnotate }: RiskCardProps) {
  const { t } = useTranslation();
  const [localLevel, setLocalLevel] = useState<string>(risk.risk_level);
  const [localCategory, setLocalCategory] = useState<string>(risk.risk_category);
  const [levelOpen, setLevelOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [error, setError] = useState('');
  const levelRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

  // Resync when the parent risk prop changes (e.g. after save or revert).
  useEffect(() => setLocalLevel(risk.risk_level), [risk.risk_level]);
  useEffect(() => setLocalCategory(risk.risk_category), [risk.risk_category]);

  // Close either dropdown on an outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (levelRef.current && !levelRef.current.contains(e.target as Node)) {
        setLevelOpen(false);
      }
      if (categoryRef.current && !categoryRef.current.contains(e.target as Node)) {
        setCategoryOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selectLevel = async (level: string) => {
    setLevelOpen(false);
    if (level === localLevel) return;
    const prev = localLevel;
    setLocalLevel(level); // optimistic
    setError('');
    try {
      await onAnnotate(risk.id, { risk_level: level });
    } catch {
      setLocalLevel(prev); // revert
      setError('Failed to update');
      setTimeout(() => setError(''), 3000);
    }
  };

  const selectCategory = async (category: string) => {
    setCategoryOpen(false);
    if (category === localCategory) return;
    const prev = localCategory;
    setLocalCategory(category); // optimistic
    setError('');
    try {
      await onAnnotate(risk.id, { risk_category: category });
    } catch {
      setLocalCategory(prev); // revert
      setError('Failed to update');
      setTimeout(() => setError(''), 3000);
    }
  };

  const c = riskColors[localLevel] || riskColors.LOW;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white shadow-card transition-shadow hover:shadow-card-hover">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          {/* ── Risk level dropdown (styled as the badge, now clickable) ── */}
          <div className="relative" ref={levelRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCategoryOpen(false);
                setLevelOpen((o) => !o);
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold transition-opacity hover:opacity-80 ${c.bg} ${c.text}`}
              title="Click to change risk level"
            >
              <svg className={`h-3 w-3 ${c.icon}`} fill="currentColor" viewBox="0 0 24 24">
                {localLevel === 'HIGH' ? (
                  <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
                ) : (
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z" />
                )}
              </svg>
              {t(`portfolio.riskLevel.${localLevel}`, { defaultValue: localLevel })}
              <svg className="h-2.5 w-2.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {levelOpen && (
              <div className="absolute top-full z-50 mt-1 w-32 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg ltr:left-0 rtl:right-0">
                {RISK_LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectLevel(lvl);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-start text-xs transition-colors hover:bg-gray-50 ${
                      lvl === localLevel ? 'bg-primary/5 font-medium text-primary' : 'text-gray-700'
                    }`}
                  >
                    {t(`portfolio.riskLevel.${lvl}`, { defaultValue: lvl })}
                    {lvl === localLevel && (
                      <svg className="h-3.5 w-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Category dropdown (styled as the muted category label) ── */}
          <div className="relative" ref={categoryRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLevelOpen(false);
                setCategoryOpen((o) => !o);
              }}
              className="flex items-center gap-1 text-xs font-medium text-gray-400 transition-colors hover:text-gray-600"
              title="Click to change category"
            >
              <span dir="auto">{clauseTypeLabel(localCategory, t)}</span>
              <svg className="h-2.5 w-2.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {categoryOpen && (
              <div className="absolute top-full z-50 mt-1 max-h-60 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg ltr:left-0 rtl:right-0">
                {Object.entries(CLAUSE_TYPE_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectCategory(label);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-start text-xs transition-colors hover:bg-gray-50 ${
                      label === localCategory ? 'bg-primary/5 font-medium text-primary' : 'text-gray-700'
                    }`}
                  >
                    <span dir="auto">{t(`clauseType.${key}`, { defaultValue: label })}</span>
                    {label === localCategory && (
                      <svg className="h-3.5 w-3.5 shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            risk.status === 'OPEN' ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-500'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${risk.status === 'OPEN' ? 'bg-amber-400' : 'bg-gray-300'}`} />
          {risk.status}
        </span>
      </div>
      <div className="border-t border-gray-50 px-5 py-4">
        <p className="text-sm leading-relaxed text-gray-600" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
          {risk.description}
        </p>
        {risk.recommendation && (
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            <div className="mb-1 flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
              </svg>
              <span className="text-xs font-semibold text-blue-700">AI Recommendation</span>
            </div>
            <p className="text-sm text-blue-600" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
              {risk.recommendation}
            </p>
          </div>
        )}
        {risk.citation_source && (
          <p className="mt-2 text-xs text-gray-400">
            <span className="font-medium">Source:</span> {risk.citation_source}
          </p>
        )}
      </div>
    </div>
  );
}
