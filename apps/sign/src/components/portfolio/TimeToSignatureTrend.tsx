import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartBlock,
  withRtlChrome,
  PORTFOLIO_CHART_COLORS as C,
} from './ChartBlock';
import { WidgetCard, WidgetEmpty } from './states';
import type { TimeToSignature } from '@/services/api/portfolioService';

/**
 * RTL-distinct geometry #3 — TIME-AXIS LINE. Its RTL failure mode differs again:
 * the time/category X axis must REVERSE so time reads right-to-left (earliest on
 * the right), and the value Y axis moves to the right. withRtlChrome handles
 * tooltip direction + locale.
 */
export default function TimeToSignatureTrend({ data }: { data: TimeToSignature }) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.language === 'ar';

  const config = useMemo(
    () =>
      withRtlChrome(
        {
          type: 'line',
          data: {
            labels: data.trend.map((p) => p.month),
            datasets: [
              {
                data: data.trend.map((p) => p.avg_days),
                borderColor: C.primary,
                backgroundColor: 'rgba(79,110,247,0.12)',
                fill: true,
                tension: 0.3,
                spanGaps: true,
                pointRadius: 3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { reverse: rtl }, // time flows right-to-left in RTL
              y: {
                beginAtZero: true,
                position: rtl ? 'right' : 'left',
              },
            },
          },
        },
        rtl,
      ),
    [data, rtl],
  );

  const avg =
    data.avg_days != null ? `${data.avg_days} ${t('portfolio.charts.timeToSig.daysUnit')}` : '—';

  return (
    <WidgetCard title={t('portfolio.charts.timeToSig.title')}>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900">{avg}</span>
        <span className="text-xs text-gray-500">
          {t('portfolio.charts.timeToSig.sample', { count: data.sample_size })}
        </span>
      </div>
      {data.trend.length === 0 ? (
        <WidgetEmpty message={t('portfolio.charts.timeToSig.noTrend')} />
      ) : (
        <ChartBlock config={config} height={180} />
      )}
      {data.excluded_no_shared_at > 0 && (
        <p className="mt-2 text-xs text-amber-600">
          {t('portfolio.charts.timeToSig.excludedNote', {
            count: data.excluded_no_shared_at,
          })}
        </p>
      )}
    </WidgetCard>
  );
}
