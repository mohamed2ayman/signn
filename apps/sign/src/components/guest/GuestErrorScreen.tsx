import { useTranslation } from 'react-i18next';

export type GuestErrorKind =
  | 'no-token'
  | 'invalid'
  | 'expired'
  | 'not-found'
  | 'throttled'
  | 'unknown';

/**
 * Clean, no-leak error screen for the public guest entry point.
 *
 * Invalid / expired / not-found all collapse to the SAME generic copy — a
 * public endpoint must never confirm whether a given invitation exists.
 * No stack traces, no backend messages surfaced.
 *
 * Visual config (icon + retry affordance) lives here; the title/body copy is
 * resolved via i18n at render time under `guest.errorScreen.<key>.{title,body}`.
 */
const CONFIG: Record<GuestErrorKind, { icon: string; key: string; retry: boolean }> = {
  'no-token': { icon: '🔗', key: 'noToken', retry: false },
  invalid: { icon: '⛔', key: 'invalid', retry: false },
  expired: { icon: '⏳', key: 'expired', retry: true },
  'not-found': { icon: '⛔', key: 'notFound', retry: false },
  throttled: { icon: '🐢', key: 'throttled', retry: true },
  unknown: { icon: '⚠️', key: 'unknown', retry: true },
};

export default function GuestErrorScreen({
  kind,
  onRetry,
}: {
  kind: GuestErrorKind;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const config = CONFIG[kind] ?? CONFIG.unknown;
  const manageXUrl = import.meta.env.VITE_MANAGEX_URL || 'http://localhost:5175';

  return (
    <div className="mx-auto flex min-h-[55vh] max-w-md flex-col items-center justify-center text-center">
      <div className="mb-4 text-5xl" aria-hidden="true">
        {config.icon}
      </div>
      <h1 className="text-xl font-semibold text-gray-900">
        {t(`guest.errorScreen.${config.key}.title`)}
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        {t(`guest.errorScreen.${config.key}.body`)}
      </p>
      {config.retry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
        >
          {t('guest.errorScreen.reload')}
        </button>
      )}
      <a
        href={manageXUrl}
        className="mt-4 text-xs text-gray-400 transition-colors hover:text-gray-600"
      >
        {t('guest.errorScreen.learnMore')}
      </a>
    </div>
  );
}
