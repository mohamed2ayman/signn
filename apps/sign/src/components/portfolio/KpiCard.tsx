import { useTranslation } from 'react-i18next';
import type { PortfolioDelta } from '@/services/api/portfolioService';

/**
 * KPI card with an optional QoQ delta badge.
 *
 * Two delta-badge rules:
 *
 * 1) Non-inverse (default — for "up is good" metrics like Contracts Created):
 *      previous=0,  current=0   → "—"          (gray, no baseline, no change)
 *      previous=0,  current>0   → "New"        (blue — soft, "first time")
 *      previous>0,  current=0   → "-100%"      (green — improving? signed-pct path)
 *      otherwise   delta_pct>=0 → "+X%"        (green — up is good)
 *      otherwise   delta_pct<0  → "X%"         (red — down is bad)
 *
 *    The 0→positive "New" rule (not "+100%") is from project memory: `pctChange`
 *    returns +100 for any 0→positive transition, so the percentage is a display
 *    half-truth (0→1 and 0→1,000,000 both read "+100%"). The backend `pctChange`
 *    is left untouched; this is purely presentation.
 *
 * 2) Inverse (`inverseGood` — for "down is good" metrics like Risks Flagged):
 *      The signed-pct PATH inverts (up=red, down=green), AND 0→positive becomes
 *      a RED ALARM showing the absolute count — NOT a neutral "New" — because
 *      "0 risks → 5 risks" is bad news and a soft "New" badge would mis-tone it.
 *      Full inverted truth table:
 *        previous=0,  current=0   → "—"            (gray — same as non-inverse)
 *        previous=0,  current>0   → "+N"           (RED — alarm; N = current)
 *        previous>0,  current=0   → "-100%"        (GREEN — positive→0 = good)
 *        otherwise   delta_pct>=0 → "+X%"          (RED — up is bad here)
 *        otherwise   delta_pct<0  → "X%"           (GREEN — down is good here)
 *
 *    Apply `inverseGood` only to genuinely inverse metrics; do NOT default-on.
 */
export default function KpiCard({
  label,
  value,
  delta,
  subtitle,
  inverseGood = false,
}: {
  label: string;
  value: string | number;
  delta?: PortfolioDelta;
  subtitle?: string;
  /** True for metrics where DOWN is good (e.g. risks_flagged). Inverts colors AND
   *  changes 0→positive from neutral "New" to RED alarm with absolute count. */
  inverseGood?: boolean;
}) {
  const { t } = useTranslation();

  const RED = 'bg-red-50 text-red-700';
  const GREEN = 'bg-emerald-50 text-emerald-700';
  const BLUE = 'bg-blue-50 text-blue-700';
  const GRAY = 'bg-gray-100 text-gray-500';

  let badge: { text: string; cls: string } | null = null;
  if (delta) {
    if (delta.previous === 0 && delta.current === 0) {
      // Both zero — neutral in both modes.
      badge = { text: t('portfolio.kpis.delta.none'), cls: GRAY };
    } else if (delta.previous === 0 && delta.current > 0) {
      // 0 → positive — branch on mode.
      badge = inverseGood
        ? { text: `+${delta.current}`, cls: RED }                    // alarm: bad thing started
        : { text: t('portfolio.kpis.delta.new'), cls: BLUE };        // soft "first time"
    } else {
      // Signed percentage — color flips under inverseGood.
      const up = delta.delta_pct >= 0;
      const text = `${up ? '+' : ''}${delta.delta_pct}%`;
      const cls = inverseGood ? (up ? RED : GREEN) : (up ? GREEN : RED);
      badge = { text, cls };
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="text-2xl font-bold text-gray-900">{value}</div>
        {badge && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
            {badge.text}
          </span>
        )}
      </div>
      {subtitle && <div className="mt-1 text-xs text-gray-400">{subtitle}</div>}
    </div>
  );
}
