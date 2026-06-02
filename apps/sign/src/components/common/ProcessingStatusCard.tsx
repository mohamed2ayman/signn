import { useTranslation } from 'react-i18next';
import { DocumentProcessingStatus } from '@/types';
import type { DocumentUpload } from '@/types';

interface ProcessingStatusCardProps {
  document: DocumentUpload;
  onRetry?: () => void;
}

// ─── Stage config — exhaustive Record so TypeScript enforces all statuses ───

const STAGE_CONFIG: Record<
  DocumentProcessingStatus,
  { label: string; progress: number; color: string }
> = {
  [DocumentProcessingStatus.UPLOADED]: {
    label: 'document.processing.queued',
    progress: 10,
    color: 'bg-gray-400',
  },
  [DocumentProcessingStatus.EXTRACTING_TEXT]: {
    label: 'document.processing.readingDocument',
    progress: 30,
    color: 'bg-blue-500',
  },
  [DocumentProcessingStatus.TEXT_EXTRACTED]: {
    label: 'document.processing.preparingClauses',
    progress: 50,
    color: 'bg-blue-500',
  },
  [DocumentProcessingStatus.EXTRACTING_CLAUSES]: {
    label: 'document.processing.extractingClauses',
    progress: 70,
    color: 'bg-primary',
  },
  [DocumentProcessingStatus.CLAUSES_EXTRACTED]: {
    label: 'document.processing.complete',
    progress: 100,
    color: 'bg-green-500',
  },
  [DocumentProcessingStatus.FAILED]: {
    label: 'document.processing.failed',
    progress: 0,
    color: 'bg-red-500',
  },
  [DocumentProcessingStatus.HUMAN_REVIEW_RECOMMENDED]: {
    label: 'document.processing.humanReviewRecommended',
    progress: 40,
    color: 'bg-amber-500',
  },
};

const STAGES_ORDER: DocumentProcessingStatus[] = [
  DocumentProcessingStatus.UPLOADED,
  DocumentProcessingStatus.EXTRACTING_TEXT,
  DocumentProcessingStatus.EXTRACTING_CLAUSES,
  DocumentProcessingStatus.CLAUSES_EXTRACTED,
];

// ─── Quality flag parser ───────────────────────────────────────────────────

/**
 * Parse a raw quality flag string (e.g. "blur:32.1") into a human-readable
 * i18n key and the measured value. Returns null for unrecognised flag shapes.
 */
function parseQualityFlag(
  flag: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  const [type, value] = flag.split(':');
  if (!type) return null;
  const num = value !== undefined ? parseFloat(value) : null;
  switch (type) {
    case 'blur':
      return t('document.processing.qualityWarning.blur', {
        score: num !== null ? num.toFixed(1) : '?',
      });
    case 'contrast':
      return t('document.processing.qualityWarning.contrast', {
        score: num !== null ? num.toFixed(1) : '?',
      });
    case 'rotation':
      return t('document.processing.qualityWarning.rotation', {
        degrees: num !== null ? Math.round(num) : '?',
      });
    default:
      return flag;
  }
}

// ─── File type label ──────────────────────────────────────────────────────

function getFileTypeLabel(mimeType: string | null): string {
  if (!mimeType) return 'FILE';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('wordprocessingml') || mimeType.includes('msword'))
    return 'DOC';
  if (mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel'))
    return 'XLS';
  if (mimeType.includes('presentationml') || mimeType.includes('ms-powerpoint'))
    return 'PPT';
  if (mimeType.startsWith('text/')) return 'TXT';
  return 'FILE';
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProcessingStatusCard({
  document,
  onRetry,
}: ProcessingStatusCardProps) {
  const { t } = useTranslation();
  const config = STAGE_CONFIG[document.processing_status];
  const isFailed = document.processing_status === DocumentProcessingStatus.FAILED;
  const isComplete =
    document.processing_status === DocumentProcessingStatus.CLAUSES_EXTRACTED;
  const isHumanReview =
    document.processing_status === DocumentProcessingStatus.HUMAN_REVIEW_RECOMMENDED;

  // Compute which stage dot to highlight for HUMAN_REVIEW_RECOMMENDED.
  // It branches off during EXTRACTING_TEXT, so we show the second dot as current.
  const effectiveStatusForDots = isHumanReview
    ? DocumentProcessingStatus.EXTRACTING_TEXT
    : document.processing_status;

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isFailed
          ? 'border-red-200 bg-red-50'
          : isComplete
            ? 'border-green-200 bg-green-50'
            : isHumanReview
              ? 'border-amber-200 bg-amber-50'
              : 'border-gray-200 bg-white'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-lg text-xs font-bold ${
              isFailed
                ? 'bg-red-100 text-red-600'
                : isComplete
                  ? 'bg-green-100 text-green-600'
                  : isHumanReview
                    ? 'bg-amber-100 text-amber-600'
                    : 'bg-primary/10 text-primary'
            }`}
          >
            {getFileTypeLabel(document.mime_type)}
          </span>
          <div>
            <p className="text-sm font-medium text-gray-900">
              {document.original_name || document.file_name}
            </p>
            {document.document_label && (
              <p className="text-xs text-gray-500">{document.document_label}</p>
            )}
          </div>
        </div>

        {isComplete && (
          <svg
            className="h-6 w-6 text-green-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}

        {isHumanReview && (
          <svg
            className="h-6 w-6 text-amber-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        )}
      </div>

      {/* Progress Bar — shown while in-progress or in human-review */}
      {!isComplete && !isFailed && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className={isHumanReview ? 'text-amber-700' : 'text-gray-500'}>
              {t(config.label)}
            </span>
            <span className="font-medium text-gray-700">{config.progress}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${config.color}`}
              style={{ width: `${config.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Stage dots — shown for non-failed states */}
      {!isFailed && (
        <div className="mt-3 flex items-center gap-1">
          {STAGES_ORDER.map((stage, i) => {
            const currentIdx = STAGES_ORDER.indexOf(effectiveStatusForDots);
            const stageIdx = i;
            const isPast = stageIdx < currentIdx || isComplete;
            const isCurrent = stageIdx === currentIdx && !isComplete;

            return (
              <div key={stage} className="flex items-center gap-1">
                <div
                  className={`h-2 w-2 rounded-full ${
                    isPast
                      ? 'bg-green-500'
                      : isCurrent
                        ? isHumanReview
                          ? 'bg-amber-500'
                          : 'animate-pulse bg-primary'
                        : 'bg-gray-200'
                  }`}
                />
                {i < STAGES_ORDER.length - 1 && (
                  <div
                    className={`h-0.5 w-6 ${isPast ? 'bg-green-500' : 'bg-gray-200'}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Error State */}
      {isFailed && (
        <div className="mt-3">
          <p className="text-xs text-red-600">
            {document.error_message || t('document.processing.failedMessage')}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-medium text-primary hover:text-primary/80"
            >
              {t('document.processing.retry')}
            </button>
          )}
        </div>
      )}

      {/* Human Review Recommended State — quality flags + actions */}
      {isHumanReview && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          {/* Quality signals */}
          {document.quality_flags && document.quality_flags.length > 0 && (
            <ul className="mb-2 space-y-1">
              {document.quality_flags.map((flag, idx) => {
                const msg = parseQualityFlag(flag, t);
                return msg ? (
                  <li key={idx} className="flex items-start gap-1.5 text-xs text-amber-800">
                    <span className="mt-0.5 text-amber-500">•</span>
                    <span dir="auto">{msg}</span>
                  </li>
                ) : null;
              })}
            </ul>
          )}

          {/* Re-upload tip */}
          <p className="text-xs text-amber-700">
            {t('document.processing.reuploadTip')}
          </p>

          {/* Continue anyway button */}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-medium text-amber-700 underline hover:text-amber-900"
            >
              {t('document.processing.continueAnyway')}
            </button>
          )}
        </div>
      )}

      {/* Complete State */}
      {isComplete && document.page_count && (
        <p className="mt-2 text-xs text-green-700">
          {t('document.processing.pagesProcessed', { count: document.page_count })}
        </p>
      )}
    </div>
  );
}
