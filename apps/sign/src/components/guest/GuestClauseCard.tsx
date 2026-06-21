import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Clause } from '@/types';
import ConfidenceBadge from '@/components/common/ConfidenceBadge';
import {
  ClauseContentDisplay,
  CLAUSE_TYPE_LABELS,
} from '@/components/review/ClauseReviewCard';

/**
 * Read-only clause card for the Guest Portal viewer.
 *
 * Reuses the existing `ClauseContentDisplay` renderer (Rule-7 RTL bullets +
 * dir="auto") and `CLAUSE_TYPE_LABELS` from the managing-portal review card —
 * single source for clause rendering — but exposes NONE of its
 * Approve / Edit / Reject / type-change controls. A guest only reads.
 */
export default function GuestClauseCard({
  clause,
  sectionNumber,
}: {
  clause: Clause;
  sectionNumber?: string | null;
}) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const typeLabel = clause.clause_type
    ? CLAUSE_TYPE_LABELS[clause.clause_type] || clause.clause_type
    : null;

  return (
    <div className="rounded-lg border border-l-4 border-gray-200 border-l-gray-300 bg-white p-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {sectionNumber && (
              <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono font-medium text-gray-600">
                {sectionNumber}
              </span>
            )}
            <h4
              className="text-sm font-medium text-gray-900"
              dir="auto"
              style={{ unicodeBidi: 'plaintext', overflowWrap: 'anywhere' }}
            >
              {clause.title}
            </h4>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {typeLabel && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {typeLabel}
              </span>
            )}
            {clause.confidence_score != null && (
              <ConfidenceBadge score={clause.confidence_score} />
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mt-3">
        <ClauseContentDisplay
          content={clause.content}
          isExpanded={isExpanded}
          isRejected={false}
        />
        {clause.content.length > 200 && (
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="mt-1 text-xs font-medium text-primary hover:text-primary/80"
          >
            {isExpanded ? t('guest.clause.showLess') : t('guest.clause.showMore')}
          </button>
        )}
      </div>
    </div>
  );
}
