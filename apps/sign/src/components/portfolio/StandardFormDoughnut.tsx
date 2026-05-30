import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartBlock,
  withRtlChrome,
  PORTFOLIO_CHART_COLORS as C,
} from './ChartBlock';
import { WidgetCard, WidgetEmpty } from './states';
import type {
  ContractsByStandardForm,
  StandardForm,
} from '@/services/api/portfolioService';

/**
 * Pure structural clone of StatusPie — same withRtlChrome, same options
 * (cutout '60%', legend position rtl-flip), same borderWidth:0 dataset shape.
 * ONLY `labels`, `data`, and `backgroundColor` differ per the Bucket-2 D1
 * pure-reuse commitment. No center-total annotation, no extra plugin, no
 * legend reposition for 4-vs-6 categories. If this diverges in any
 * chart-chrome way, treat it as a new shape and AR-screenshot it (the
 * Bucket-2 tripwire).
 */
const ORDER: StandardForm[] = ['FIDIC', 'NEC', 'OTHER', 'ADHOC'];

const COLOR: Record<StandardForm, string> = {
  FIDIC: C.primary,       // SIGN indigo
  NEC: '#0EA5E9',         // cyan
  OTHER: '#9CA3AF',       // gray
  ADHOC: C.inApproval,    // amber — visually distinguishes "not a standard form"
};

export default function StandardFormDoughnut({ data }: { data: ContractsByStandardForm }) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.language === 'ar';

  const config = useMemo(
    () =>
      withRtlChrome(
        {
          type: 'doughnut',
          data: {
            labels: ORDER.map((f) => t(`portfolio.standardForm.${f}`)),
            datasets: [
              {
                data: ORDER.map((f) => data.forms[f] ?? 0),
                backgroundColor: ORDER.map((f) => COLOR[f]),
                borderWidth: 0,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            plugins: {
              legend: { position: rtl ? 'left' : 'right' },
            },
          },
        },
        rtl,
      ),
    [data, rtl, t],
  );

  return (
    <WidgetCard title={t('portfolio.charts.standardForm.title')}>
      {data.total === 0 ? <WidgetEmpty /> : <ChartBlock config={config} height={240} />}
    </WidgetCard>
  );
}
