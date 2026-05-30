import { useTranslation } from 'react-i18next';

/**
 * Per-source signal state. The strip pulls THREE signals from TWO independent
 * React Query sources (portfolio-analytics for the first two, obligations for
 * the third), so per-signal state is required — never collapse to "0" when a
 * source errored (that's a lie; the multi-source instance of Amendment 2,
 * "lies without throwing"), and never blank the whole strip on one failure
 * (that discards the signals that DID load).
 */
export interface AttentionSignal {
  value?: number;
  loading?: boolean;
  error?: boolean;
}

interface AttentionStripProps {
  highRisks: AttentionSignal;
  expiringIn30: AttentionSignal;
  overdueObligations: AttentionSignal;
}

/**
 * Sticky attention strip — three independent pills at the top of the page
 * content. Each pill renders one of four states:
 *
 *   loading                          → dim gray "… <label>" (skeleton-ish)
 *   error                            → amber "⚠ <label>: couldn't load" (distinct from 0)
 *   loaded value = 0                 → neutral gray "0 <label>" (genuinely no items)
 *   loaded value > 0                 → tone-colored "<n> <label>" (alarm)
 *
 * Sticky `top-0 z-10` within the page content (below the fixed TopBar);
 * negative horizontal margins so the strip extends across the full content
 * width while the page's padding remains everywhere else.
 */
export default function AttentionStrip({
  highRisks,
  expiringIn30,
  overdueObligations,
}: AttentionStripProps) {
  const { t } = useTranslation();

  return (
    <div className="sticky top-0 z-10 -mx-6 mb-4 border-b border-gray-200 bg-white/95 px-6 py-3 backdrop-blur lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="red" label={t('portfolio.attentionStrip.highRisks')} signal={highRisks} />
        <Pill tone="amber" label={t('portfolio.attentionStrip.expiringIn30')} signal={expiringIn30} />
        <Pill tone="red" label={t('portfolio.attentionStrip.overdueObligations')} signal={overdueObligations} />
      </div>
    </div>
  );
}

function Pill({
  tone,
  label,
  signal,
}: {
  tone: 'red' | 'amber';
  label: string;
  signal: AttentionSignal;
}) {
  const { t } = useTranslation();

  // 1) LOADING — skeleton/dim. Distinct from loaded-zero and from error.
  if (signal.loading) {
    return (
      <span
        className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-400"
        aria-busy="true"
      >
        <span dir="ltr">…</span> {label}
      </span>
    );
  }

  // 2) ERROR — explicit "couldn't load." NEVER "0 <label>" (would be a lie).
  if (signal.error) {
    return (
      <span
        className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800"
        role="status"
      >
        ⚠ {label}: {t('portfolio.attentionStrip.error')}
      </span>
    );
  }

  // 3) LOADED — split on zero (neutral) vs >0 (alarm tone).
  const value = signal.value ?? 0;
  if (value === 0) {
    return (
      <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
        <span dir="ltr">0</span> {label}
      </span>
    );
  }
  const toneCls =
    tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-amber-200 bg-amber-50 text-amber-700';
  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs font-medium ${toneCls}`}>
      <span dir="ltr">{value}</span> {label}
    </span>
  );
}
