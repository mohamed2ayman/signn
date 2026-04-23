import { useState } from 'react';
import { ClauseReviewStatus } from '@/types';
import type { Clause } from '@/types';
import ConfidenceBadge from '@/components/common/ConfidenceBadge';

/** Render clause content with RTL bullet-point support.
 *
 * Lines starting with "- " are collected into a RTL <ul> so that
 * the bullet marker appears on the RIGHT side for Arabic text.
 * All other lines render as plain paragraphs with dir="auto".
 */
function ClauseContentDisplay({
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
  onEdit: (clauseId: string, data: { title?: string; content?: string; clause_type?: string }) => void;
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

const CLAUSE_TYPE_LABELS: Record<string, string> = {
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

export default function ClauseReviewCard({
  clause,
  sectionNumber,
  onApprove,
  onReject,
  onEdit,
  isSelected = false,
  onClick,
}: ClauseReviewCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(clause.title);
  const [editContent, setEditContent] = useState(clause.content);

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
            {clause.clause_type && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {CLAUSE_TYPE_LABELS[clause.clause_type] || clause.clause_type}
              </span>
            )}
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
