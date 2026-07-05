import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ClauseReviewStatus } from '@/types';
import type { Clause } from '@/types';
import ConfidenceBadge from '@/components/common/ConfidenceBadge';

/** Render clause content with RTL bullet-point support.
 *
 * Lines starting with "- " are collected into a RTL <ul> so that
 * the bullet marker appears on the RIGHT side for Arabic text.
 * All other lines render as plain paragraphs with dir="auto".
 */
export function ClauseContentDisplay({
  content,
  isExpanded,
  isRejected,
}: {
  content: string;
  isExpanded: boolean;
  isRejected: boolean;
}) {
  const strikeClass = isRejected ? 'line-through opacity-60' : '';
  const lines = content.split('\n');
  const hasBullets = lines.some((l) => l.trimStart().startsWith('- '));

  if (!hasBullets) {
    return (
      <p
        className={`text-sm text-gray-600 ${isExpanded ? '' : 'line-clamp-3'} ${strikeClass}`}
        dir="auto"
        style={{ unicodeBidi: 'plaintext' }}
      >
        {content}
      </p>
    );
  }

  // Build mixed content: RTL bullet lists interleaved with plain paragraphs
  type Segment = { kind: 'bullets'; items: string[] } | { kind: 'para'; text: string };
  const segments: Segment[] = [];
  let bulletBuf: string[] = [];

  const flushBullets = () => {
    if (bulletBuf.length > 0) {
      segments.push({ kind: 'bullets', items: [...bulletBuf] });
      bulletBuf = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('- ')) {
      bulletBuf.push(trimmed.slice(2));
    } else {
      flushBullets();
      segments.push({ kind: 'para', text: trimmed });
    }
  }
  flushBullets();

  // When collapsed, show at most 4 bullet items and 2 paragraphs total
  let visibleSegments = segments;
  if (!isExpanded) {
    let bulletCount = 0;
    let paraCount = 0;
    const limited: Segment[] = [];
    for (const seg of segments) {
      if (seg.kind === 'para') {
        if (paraCount < 2) { limited.push(seg); paraCount++; }
      } else {
        const remaining = 4 - bulletCount;
        if (remaining > 0) {
          limited.push({ kind: 'bullets', items: seg.items.slice(0, remaining) });
          bulletCount += Math.min(seg.items.length, remaining);
        }
      }
    }
    visibleSegments = limited;
  }

  return (
    <div className={strikeClass}>
      {visibleSegments.map((seg, i) =>
        seg.kind === 'para' ? (
          <p
            key={i}
            className="text-sm text-gray-600"
            dir="auto"
            style={{ unicodeBidi: 'plaintext' }}
          >
            {seg.text}
          </p>
        ) : (
          <ul
            key={i}
            dir="rtl"
            style={{
              listStyleType: 'disc',
              paddingRight: '1.5rem',
              paddingLeft: '0',
              textAlign: 'right',
            }}
            className="text-sm text-gray-600 space-y-0.5"
          >
            {seg.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

interface ClauseReviewCardProps {
  clause: Clause;
  sectionNumber?: string | null;
  onApprove: (clauseId: string) => void;
  onReject: (clauseId: string) => void;
  onEdit: (clauseId: string, data: { title?: string; content?: string; clause_type?: string }) => Promise<void> | void;
  isSelected?: boolean;
  onClick?: () => void;
}

const REVIEW_BORDER_COLORS: Record<string, string> = {
  [ClauseReviewStatus.PENDING_REVIEW]: 'border-l-yellow-400',
  [ClauseReviewStatus.APPROVED]: 'border-l-green-400',
  [ClauseReviewStatus.EDITED]: 'border-l-blue-400',
  [ClauseReviewStatus.REJECTED]: 'border-l-red-400',
};

const REVIEW_BG_COLORS: Record<string, string> = {
  [ClauseReviewStatus.PENDING_REVIEW]: 'bg-white',
  [ClauseReviewStatus.APPROVED]: 'bg-green-50/50',
  [ClauseReviewStatus.EDITED]: 'bg-blue-50/50',
  [ClauseReviewStatus.REJECTED]: 'bg-red-50/30',
};

export const CLAUSE_TYPE_LABELS: Record<string, string> = {
  general: 'General',
  payment: 'Payment',
  liability: 'Liability',
  termination: 'Termination',
  indemnification: 'Indemnification',
  force_majeure: 'Force Majeure',
  dispute_resolution: 'Dispute Resolution',
  confidentiality: 'Confidentiality',
  compliance: 'Compliance',
  insurance: 'Insurance',
  warranty: 'Warranty',
  intellectual_property: 'IP',
  scope_of_work: 'Scope of Work',
  variations: 'Variations',
  defects: 'Defects',
  time: 'Time',
  other: 'Other',
};

/** Reverse map (English label → key) so a stored English category label can be
 *  resolved back to its `clauseType.*` i18n key. */
export const CLAUSE_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(CLAUSE_TYPE_LABELS).map(([key, label]) => [label, key]),
);

/**
 * Localize a clause_type / risk_category value for DISPLAY only. Accepts a KEY
 * ('payment'), an English LABEL ('Payment'), or free-text ('Uncategorized',
 * 'Payment Terms'). Returns the localized label for the 17 known categories
 * (via the `clauseType.*` i18n keys, English fallback), or the raw value
 * unchanged for anything else. Storage is never affected.
 */
export function clauseTypeLabel(
  value: string | null | undefined,
  t: TFunction,
): string {
  if (!value) return '';
  const key = CLAUSE_TYPE_LABELS[value] ? value : CLAUSE_LABEL_TO_KEY[value];
  if (key) return t(`clauseType.${key}`, { defaultValue: CLAUSE_TYPE_LABELS[key] });
  return value;
}

export default function ClauseReviewCard({
  clause,
  sectionNumber,
  onApprove,
  onReject,
  onEdit,
  isSelected = false,
  onClick,
}: ClauseReviewCardProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(clause.title);
  const [editContent, setEditContent] = useState(clause.content);

  // ── Type dropdown state ──────────────────────────────────────
  const [localType, setLocalType] = useState<string | null>(clause.clause_type ?? null);
  const [isTypeDropdownOpen, setIsTypeDropdownOpen] = useState(false);
  const [typeError, setTypeError] = useState('');
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  // Keep localType in sync when parent clause prop changes (e.g. after revert)
  useEffect(() => {
    setLocalType(clause.clause_type ?? null);
  }, [clause.clause_type]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isTypeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setIsTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isTypeDropdownOpen]);

  const handleTypeSelect = async (newType: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsTypeDropdownOpen(false);
    const prev = localType;
    setLocalType(newType); // optimistic update
    setTypeError('');
    try {
      const result = onEdit(clause.id, { clause_type: newType });
      if (result instanceof Promise) await result;
    } catch {
      setLocalType(prev); // revert on failure
      setTypeError('Failed to update');
      setTimeout(() => setTypeError(''), 3000);
    }
  };
  // ────────────────────────────────────────────────────────────

  const reviewStatus = clause.review_status || ClauseReviewStatus.PENDING_REVIEW;
  const borderColor = REVIEW_BORDER_COLORS[reviewStatus] || 'border-l-gray-300';
  const bgColor = REVIEW_BG_COLORS[reviewStatus] || 'bg-white';

  const handleSaveEdit = () => {
    onEdit(clause.id, { title: editTitle, content: editContent });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(clause.title);
    setEditContent(clause.content);
    setIsEditing(false);
  };

  return (
    <div
      className={`rounded-lg border border-l-4 ${borderColor} ${bgColor} p-4 transition-all ${
        isSelected ? 'ring-2 ring-primary/30' : ''
      } ${onClick ? 'cursor-pointer hover:shadow-sm' : ''}`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {sectionNumber && (
              <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono font-medium text-gray-600">
                {sectionNumber}
              </span>
            )}
            {isEditing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-medium focus:border-primary focus:outline-none"
                onClick={(e) => e.stopPropagation()}
                dir="auto"
              />
            ) : (
              <h4 className="text-sm font-medium text-gray-900 truncate" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                {clause.title}
              </h4>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {/* ── Clickable type dropdown ── */}
            <div className="relative" ref={typeDropdownRef}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setIsTypeDropdownOpen((o) => !o); }}
                className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary transition-colors hover:bg-primary/20"
                title="Click to change clause type"
              >
                {localType ? clauseTypeLabel(localType, t) : 'Set type'}
                <svg className="h-2.5 w-2.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isTypeDropdownOpen && (
                <div className="absolute top-full z-50 mt-1 max-h-60 w-44 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg ltr:left-0 rtl:right-0">
                  {Object.entries(CLAUSE_TYPE_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={(e) => handleTypeSelect(key, e)}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-start text-xs transition-colors hover:bg-gray-50 ${
                        key === localType ? 'bg-primary/5 font-medium text-primary' : 'text-gray-700'
                      }`}
                    >
                      {t(`clauseType.${key}`, { defaultValue: label })}
                      {key === localType && (
                        <svg className="h-3.5 w-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {typeError && (
              <span className="text-xs text-red-500">{typeError}</span>
            )}
            {/* ─────────────────────────────── */}
            {clause.confidence_score != null && (
              <ConfidenceBadge score={clause.confidence_score} />
            )}
            {reviewStatus !== ClauseReviewStatus.PENDING_REVIEW && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  reviewStatus === ClauseReviewStatus.APPROVED
                    ? 'bg-green-100 text-green-700'
                    : reviewStatus === ClauseReviewStatus.EDITED
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-red-100 text-red-700'
                }`}
              >
                {reviewStatus.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content Preview / Edit */}
      <div className="mt-3">
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full rounded border border-gray-300 p-2 text-sm text-gray-700 focus:border-primary focus:outline-none"
            rows={6}
            onClick={(e) => e.stopPropagation()}
            dir="auto"
          />
        ) : (
          <ClauseContentDisplay
            content={clause.content}
            isExpanded={isExpanded}
            isRejected={reviewStatus === ClauseReviewStatus.REJECTED}
          />
        )}

        {!isEditing && clause.content.length > 200 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="mt-1 text-xs font-medium text-primary hover:text-primary/80"
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {isEditing ? (
          <>
            <button
              type="button"
              onClick={handleSaveEdit}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
            >
              Save & Approve
            </button>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {reviewStatus === ClauseReviewStatus.PENDING_REVIEW && (
              <>
                <button
                  type="button"
                  onClick={() => onApprove(clause.id)}
                  className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onReject(clause.id)}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  Reject
                </button>
              </>
            )}
            {reviewStatus === ClauseReviewStatus.APPROVED && (
              <span className="text-xs text-green-600">Approved</span>
            )}
            {reviewStatus === ClauseReviewStatus.REJECTED && (
              <button
                type="button"
                onClick={() => onApprove(clause.id)}
                className="text-xs font-medium text-primary hover:text-primary/80"
              >
                Undo Rejection
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
