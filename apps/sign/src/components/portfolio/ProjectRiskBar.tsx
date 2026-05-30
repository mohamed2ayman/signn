import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartBlock,
  withRtlChrome,
  PORTFOLIO_CHART_COLORS as C,
} from './ChartBlock';
import { WidgetCard, WidgetEmpty } from './states';
import type { ProjectRisk, RiskLevel } from '@/services/api/portfolioService';

/**
 * Reuses the proven RiskDistributionBar code path — same indexAxis:'y',
 * scales.x.reverse for RTL bars-from-right, scales.y.position for category
 * labels right under rtl, and `animation: false` inherited via withRtlChrome
 * (lesson #136). All of that rides along automatically by importing the same
 * ChartBlock + withRtlChrome.
 *
 * Divergence vs RiskDistributionBar (watch-item per Bucket-2 brief):
 * - Category labels are FREE-TEXT project names (Arabic + Latin, longer than
 *   "High/Medium/Low", potentially wrapping/clipping). The AR rendering of
 *   project names on the chart-chrome category axis is verified by the
 *   Bucket-2 AR screenshot; if it diverges from the proven bar's behaviour
 *   (wrap/clip/mis-align/internal reversal), that's a new shape and the
 *   screenshot stays in the deliverable.
 * - Bar value = worst_score (PMBOK 1-25); x.max pinned to 25 keeps the visual
 *   scale stable across reloads (the worst-finding-rule is fixed-range).
 * - Per-bar color encodes the risk LEVEL (HIGH=red / MEDIUM=amber / LOW=green)
 *   so no separate legend is needed.
 */
const LEVEL_COLOR: Record<RiskLevel, string> = {
  HIGH: C.riskHigh,
  MEDIUM: C.riskMedium,
  LOW: C.riskLow,
};

const MAX_BARS = 10; // backend orders by worst_score DESC; show top-N

export default function ProjectRiskBar({ data }: { data: ProjectRisk[] }) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.language === 'ar';

  const rows = data.slice(0, MAX_BARS);

  const config = useMemo(
    () =>
      withRtlChrome(
        {
          type: 'bar',
          data: {
            labels: rows.map((r) => r.project_name),
            datasets: [
              {
                data: rows.map((r) => r.worst_score),
                backgroundColor: rows.map((r) => LEVEL_COLOR[r.level]),
                borderRadius: 4,
                maxBarThickness: 22,
              },
            ],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: {
                beginAtZero: true,
                max: 25,
                reverse: rtl,
                position: rtl ? 'top' : 'bottom',
                ticks: { precision: 0 },
              },
              y: { position: rtl ? 'right' : 'left' },
            },
          },
        },
        rtl,
      ),
    [rows, rtl],
  );

  return (
    <WidgetCard title={t('portfolio.charts.projectRisk.title')}>
      {data.length === 0 ? (
        <WidgetEmpty />
      ) : (
        // Dynamic height so many projects don't compress to unreadable bars.
        <ChartBlock config={config} height={Math.max(220, rows.length * 32 + 60)} />
      )}
    </WidgetCard>
  );
}
