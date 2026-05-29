import { useTranslation } from 'react-i18next';
import LoadingSpinner from '@/components/common/LoadingSpinner';

/** Card chrome shared by all portfolio widgets (matches DashboardPage visual language). */
export function WidgetCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className ?? ''}`}>
      <div className="border-b border-gray-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/** Per-widget "no data for this widget" placeholder (e.g. zero risks while contracts exist). */
export function WidgetEmpty({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-[180px] items-center justify-center text-sm text-gray-400">
      {message ?? t('portfolio.empty.widget')}
    </div>
  );
}

export function PortfolioLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}

/**
 * Amendment 2 — the SUCCESS-with-no-data state. Visually + semantically
 * DISTINCT from the error state below: a calm, neutral "nothing to show yet".
 * Triggered only when React Query succeeded but the org has no portfolio data.
 */
export function PortfolioEmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
      <div className="mb-3 text-4xl" aria-hidden="true">
        📊
      </div>
      <h3 className="text-base font-semibold text-gray-700">{t('portfolio.empty.title')}</h3>
      <p className="mt-1 max-w-md text-sm text-gray-500">{t('portfolio.empty.body')}</p>
    </div>
  );
}

/**
 * Amendment 2 — the FAILURE state. MUST look different from the empty state:
 * a real backend/network/auth failure (React Query isError) must never read as
 * "this org is empty" and go uninvestigated. Red treatment + an explicit retry.
 */
export function PortfolioErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 p-10 text-center">
      <div className="mb-3 text-4xl" aria-hidden="true">
        ⚠️
      </div>
      <h3 className="text-base font-semibold text-red-800">{t('portfolio.error.title')}</h3>
      <p className="mt-1 max-w-md text-sm text-red-600">{t('portfolio.error.body')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
      >
        {t('portfolio.error.retry')}
      </button>
    </div>
  );
}
