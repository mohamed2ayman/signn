import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { WidgetCard, WidgetEmpty } from './states';
import { obligationService } from '@/services/api/obligationService';

/**
 * Reuses the existing 2a `/obligations/portfolio?within=14` endpoint via
 * obligationService. Self-contained data fetching with its own
 * loading / error / empty / list states (Amendment 2 at the widget level —
 * a load failure is NEVER rendered as "no obligations"). Text/list layout,
 * dir-driven RTL; no chart chrome → no AR screenshot deliverable required.
 *
 * Description and project name use dir="auto" + unicodeBidi:'plaintext' since
 * either may contain Arabic (CLAUDE.md hard rule for obligation text).
 */
const MAX_ROWS = 8;

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  // YYYY-MM-DD, Latin numerals always (#137).
  return date.toISOString().slice(0, 10);
}

export default function UpcomingObligationsList() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['obligations', 'upcoming-14d'],
    queryFn: () => obligationService.getPortfolioObligations({ within: 14 }),
  });

  return (
    <WidgetCard title={t('portfolio.charts.upcomingObligations.title')}>
      {isLoading ? (
        <div className="py-4 text-center text-sm text-gray-400">
          {t('portfolio.charts.upcomingObligations.loading')}
        </div>
      ) : isError ? (
        // Distinct ERROR state — never reads as "no obligations" (Amendment 2 at widget level).
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠ {t('portfolio.charts.upcomingObligations.error')}
        </div>
      ) : !data || data.length === 0 ? (
        <WidgetEmpty message={t('portfolio.charts.upcomingObligations.empty')} />
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.slice(0, MAX_ROWS).map((o) => (
            <li key={o.id} className="py-2.5">
              <div
                className="text-sm text-gray-800"
                dir="auto"
                style={{ unicodeBidi: 'plaintext' }}
              >
                {o.description}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                <span dir="ltr" className="tabular-nums">{fmtDate(o.due_date)}</span>
                {o.project?.name && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                      {o.project.name}
                    </span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
