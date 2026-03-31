import { DocumentProcessingStatus } from '@/types';
import type { DocumentUpload } from '@/types';

interface ProcessingStatusCardProps {
  document: DocumentUpload;
  onRetry?: () => void;
}

const STAGE_CONFIG: Record<
  DocumentProcessingStatus,
  { label: string; progress: number; color: string }
> = {
  [DocumentProcessingStatus.UPLOADED]: {
    label: 'Queued for processing...',
    progress: 10,
    color: 'bg-gray-400',
  },
  [DocumentProcessingStatus.EXTRACTING_TEXT]: {
    label: 'Reading document...',
    progress: 30,
    color: 'bg-blue-500',
  },
  [DocumentProcessingStatus.TEXT_EXTRACTED]: {
    label: 'Document read. Preparing clause extraction...',
    progress: 50,
    color: 'bg-blue-500',
  },
  [DocumentProcessingStatus.EXTRACTING_CLAUSES]: {
    label: 'Extracting clauses with AI...',
    progress: 70,
    color: 'bg-primary',
  },
  [DocumentProcessingStatus.CLAUSES_EXTRACTED]: {
    label: 'Complete',
    progress: 100,
    color: 'bg-green-500',
  },
  [DocumentProcessingStatus.FAILED]: {
    label: 'Processing failed',
    progress: 0,
    color: 'bg-red-500',
  },
};

const STAGES_ORDER: DocumentProcessingStatus[] = [
  DocumentProcessingStatus.UPLOADED,
  DocumentProcessingStatus.EXTRACTING_TEXT,
  DocumentProcessingStatus.EXTRACTING_CLAUSES,
  DocumentProcessingStatus.CLAUSES_EXTRACTED,
];

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

export default function ProcessingStatusCard({
  document,
  onRetry,
}: ProcessingStatusCardProps) {
  const config = STAGE_CONFIG[document.processing_status];
  const isFailed = document.processing_status === DocumentProcessingStatus.FAILED;
  const isComplete =
    document.processing_status === DocumentProcessingStatus.CLAUSES_EXTRACTED;

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isFailed
          ? 'border-red-200 bg-red-50'
          : isComplete
            ? 'border-green-200 bg-green-50'
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
      </div>

      {/* Progress Bar */}
      {!isComplete && !isFailed && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">{config.label}</span>
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

      {/* Stages */}
      {!isFailed && (
        <div className="mt-3 flex items-center gap-1">
          {STAGES_ORDER.map((stage, i) => {
            const currentIdx = STAGES_ORDER.indexOf(document.processing_status);
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
                        ? 'animate-pulse bg-primary'
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
            {document.error_message || 'An error occurred during processing.'}
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-xs font-medium text-primary hover:text-primary/80"
            >
              Retry Processing
            </button>
          )}
        </div>
      )}

      {/* Complete State */}
      {isComplete && document.page_count && (
        <p className="mt-2 text-xs text-green-700">
          {document.page_count} pages processed successfully
        </p>
      )}
    </div>
  );
}
