import { useTranslation } from 'react-i18next';
import type { PortfolioDelta } from '@/services/api/portfolioService';

/**
 * KPI card with an optional QoQ delta badge.
 *
 * Delta-badge rule (Phase 7.17 Prompt 2b, from project memory):
 * `pctChange` returns +100 for ANY 0→positive transition, which is a display
 * half-truth (0→1 and 0→1M both read "+100%"). So we special-case the badge:
 *   - previous === 0 && current > 0  → "New"  (NOT "+100%")
 *   - previous === 0 && current === 0 → "—"   (no movement / no baseline)
 *   - otherwise → the signed percentage from the backend.
 * The backend `pctChange` is left untouched; this is purely presentation.
 */
export default function KpiCard({
  label,
  value,
  delta,
  subtitle,
}: {
  label: string;
  value: string | number;
  delta?: PortfolioDelta;
  subtitle?: string;
}) {
  const { t } = useTranslation();

  let badge: { text: string; cls: string } | null = null;
  if (delta) {
    if (delta.previous === 0 && delta.current > 0) {
      badge = { text: t('portfolio.kpis.delta.new'), cls: 'bg-blue-50 text-blue-700' };
    } else if (delta.previous === 0 && delta.current === 0) {
      badge = { text: t('portfolio.kpis.delta.none'), cls: 'bg-gray-100 text-gray-500' };
    } else {
      const up = delta.delta_pct >= 0;
      badge = {
        text: `${up ? '+' : ''}${delta.delta_pct}%`,
        cls: up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      };
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
