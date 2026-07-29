import { useTranslation } from 'react-i18next';
import ProcessingStatusCard from '@/components/common/ProcessingStatusCard';
import { DocumentProcessingStatus } from '@/types';
import type { DocumentUpload } from '@/types';

// Quality-flag prefixes that mean a FINISHED document still needs human review:
// clause_extraction_incomplete (PR #177 — a truncated/malformed chunk dropped
// clauses) and text_corruption_suspected (Fix #2, PR #198 — Arabic text was
// silently OCR-reconstructed). Prefix match tolerates the ":<score>" suffix.
const NEEDS_REVIEW_FLAG_PREFIXES = [
  'clause_extraction_incomplete',
  'text_corruption_suspected',
];

/**
 * True iff a document finished extraction (CLAUSES_EXTRACTED) yet carries a
 * quality flag that means clauses may be missing or corrupted.
 *
 * ProcessingStatusCard renders the incomplete + corruption banners (and, for the
 * incomplete case, a re-run button) for exactly this situation — but on
 * ContractDetailPage the card only mounts for IN-PROGRESS docs, so on a finished
 * contract those banners never appear. This predicate is the parallel gate that
 * lets a finished-but-flagged doc keep its card. Pure + unit-tested.
 */
export function docNeedsReview(doc: DocumentUpload): boolean {
  return (
    doc.processing_status === DocumentProcessingStatus.CLAUSES_EXTRACTED &&
    !!doc.quality_flags?.some((f) =>
      NEEDS_REVIEW_FLAG_PREFIXES.some((p) => f.startsWith(p)),
    )
  );
}

interface DocumentsNeedingReviewProps {
  /** Candidate documents (already fetched by the page). Filtered to the flagged
   *  terminal set internally, so a mixed list is safe. */
  documents: DocumentUpload[];
  /** Re-run extraction for a document (the ProcessingStatusCard onRetry). */
  onReprocess: (docId: string) => void;
}

/**
 * "Needs review" panel for FINISHED-but-flagged documents — a parallel mount to
 * the transient "Analyzing Documents…" panel (which only shows in-progress docs).
 * Reuses ProcessingStatusCard UNCHANGED, so Fix #2's incomplete + corruption
 * banners and the re-run/reprocess button render on a CLAUSES_EXTRACTED doc.
 * Renders NOTHING when no document needs review — a clean completed contract
 * shows no panel.
 */
export default function DocumentsNeedingReview({
  documents,
  onReprocess,
}: DocumentsNeedingReviewProps) {
  const { t } = useTranslation();
  const flagged = documents.filter(docNeedsReview);
  if (flagged.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h3 className="mb-3 text-sm font-semibold text-amber-800">
        {t('document.processing.needsReviewHeading')}
      </h3>
      <div className="space-y-2">
        {flagged.map((doc) => (
          <ProcessingStatusCard
            key={doc.id}
            document={doc}
            onRetry={() => onReprocess(doc.id)}
          />
        ))}
      </div>
    </div>
  );
}
