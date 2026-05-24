import { useTranslation } from 'react-i18next';

/**
 * Error fallback for failed obligation queries. Mirrors the
 * codebase's existing "Failed to load..." patterns (see
 * ProjectDetailPage) but with a Retry button — React Query's
 * refetch is the natural retry trigger.
 */
export default function ObligationErrorState({
  onRetry,
  error,
}: {
  onRetry?: () => void;
  error?: unknown;
}) {
  const { t } = useTranslation();
  const message =
    error instanceof Error ? error.message : t('errors.generic');

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg
          className="h-6 w-6 text-red-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-gray-900">
        {t('obligation.ui.errorTitle')}
      </h3>
      <p className="mt-1 max-w-md text-sm text-gray-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.5m-4.498 11.652a7.5 7.5 0 11.001-9.302" />
          </svg>
          {t('obligation.ui.retry')}
        </button>
      )}
    </div>
  );
}
