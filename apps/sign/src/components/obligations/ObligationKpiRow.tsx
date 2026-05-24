import { useTranslation } from 'react-i18next';
import type { ObligationKpiCounts } from './statusUtils';

/**
 * Four-card KPI summary row used at the top of every obligation list
 * surface (ObligationsTab on Contract Detail, ObligationsPage portfolio).
 *
 * Each card: label + count + small icon. Total is neutral, Pending
 * is amber, Overdue is red (with red border when > 0), Actioned is
 * green. Counts come from `computeKpis()` in statusUtils — never
 * computed inline by callers, to keep the four pages consistent.
 *
 * Responsive: 2 cols at <md, 4 cols at md+.
 */
export default function ObligationKpiRow({ counts }: { counts: ObligationKpiCounts }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <KpiCard
        label={t('obligation.ui.kpi.total')}
        value={counts.total}
        icon={IconList}
      />
      <KpiCard
        label={t('obligation.ui.kpi.pending')}
        value={counts.pending}
        tone="amber"
        icon={IconClock}
      />
      <KpiCard
        label={t('obligation.ui.kpi.overdue')}
        value={counts.overdue}
        tone="red"
        urgent={counts.overdue > 0}
        icon={IconAlert}
      />
      <KpiCard
        label={t('obligation.ui.kpi.actioned')}
        value={counts.actioned}
        tone="green"
        icon={IconCheck}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  urgent,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone?: 'amber' | 'red' | 'green';
  urgent?: boolean;
  icon: React.FC<{ className?: string }>;
}) {
  const valueColor =
    tone === 'amber'
      ? 'text-amber-600'
      : tone === 'red'
      ? 'text-red-600'
      : tone === 'green'
      ? 'text-emerald-600'
      : 'text-gray-900';

  const iconBg =
    urgent
      ? 'bg-red-50'
      : tone === 'amber'
      ? 'bg-amber-50'
      : tone === 'green'
      ? 'bg-emerald-50'
      : 'bg-gray-50';

  const iconColor =
    tone === 'amber'
      ? 'text-amber-500'
      : tone === 'red'
      ? 'text-red-500'
      : tone === 'green'
      ? 'text-emerald-500'
      : 'text-gray-400';

  return (
    <div
      className={`rounded-lg border bg-white p-4 ${
        urgent ? 'border-red-200' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-600">{label}</p>
          <p className={`mt-1 text-3xl font-semibold ${valueColor}`}>{value}</p>
        </div>
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
      </div>
    </div>
  );
}

// ─── Icons (inline so we don't depend on lucide-react across the file) ───

function IconList({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  );
}
function IconClock({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function IconAlert({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}
function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
