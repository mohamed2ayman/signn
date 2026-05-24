import { useTranslation } from 'react-i18next';

/**
 * Shared empty / no-matches state for every obligation surface.
 * Caller decides whether to show the "Add Obligation" CTA — it's
 * a separate prop so the portfolio page can omit it (creation
 * is always scoped to a contract).
 */
export default function ObligationEmptyState({
  variant = 'empty',
  onAdd,
}: {
  variant?: 'empty' | 'no-matches';
  onAdd?: () => void;
}) {
  const { t } = useTranslation();
  const title =
    variant === 'no-matches'
      ? t('obligation.ui.noMatches')
      : t('obligation.ui.empty');
  const subtext =
    variant === 'no-matches'
      ? t('obligation.ui.noMatchesSubtext')
      : t('obligation.ui.emptySubtext');

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
        <svg
          className="h-6 w-6 text-emerald-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-gray-600">{subtext}</p>
      {onAdd && variant === 'empty' && (
        <button
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('obligation.actions.add')}
        </button>
      )}
    </div>
  );
}
