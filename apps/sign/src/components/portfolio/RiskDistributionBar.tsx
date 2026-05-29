import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartBlock,
  withRtlChrome,
  PORTFOLIO_CHART_COLORS as C,
} from './ChartBlock';
import { WidgetCard, WidgetEmpty } from './states';
import type { RiskDistribution, RiskLevel } from '@/services/api/portfolioService';

const ORDER: RiskLevel[] = ['HIGH', 'MEDIUM', 'LOW'];
const COLOR: Record<RiskLevel, string> = {
  HIGH: C.riskHigh,
  MEDIUM: C.riskMedium,
  LOW: C.riskLow,
};

/**
 * RTL-distinct geometry #2 — HORIZONTAL BAR (indexAxis: 'y'). Its RTL failure
 * mode differs from the pie: the VALUE axis (x) must reverse so bars grow
 * right-to-left, and the CATEGORY axis (y) labels must move to the right.
 * withRtlChrome handles legend/tooltip; the axis flips are done here.
 *
 * Note: the axes (and category labels) render even when all values are 0, so
 * the RTL chrome is verifiable on the empty dev DB; bar magnitudes are not.
 */
export default function RiskDistributionBar({ data }: { data: RiskDistribution }) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.language === 'ar';

  const config = useMemo(
    () =>
      withRtlChrome(
        {
          type: 'bar',
          data: {
            labels: ORDER.map((l) => t(`portfolio.riskLevel.${l}`)),
            datasets: [
              {
                data: ORDER.map((l) => data.levels[l] ?? 0),
                backgroundColor: ORDER.map((l) => COLOR[l]),
                borderRadius: 4,
                maxBarThickness: 28,
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
                reverse: rtl, // value axis grows leftward in RTL
                position: rtl ? 'top' : 'bottom',
                ticks: { precision: 0 },
              },
              y: {
                position: rtl ? 'right' : 'left', // category labels on the right in RTL
              },
            },
          },
        },
        rtl,
      ),
    [data, rtl, t],
  );

  return (
    <WidgetCard title={t('portfolio.charts.riskBar.title')}>
      {data.total === 0 ? <WidgetEmpty /> : <ChartBlock config={config} height={220} />}
    </WidgetCard>
  );
}
