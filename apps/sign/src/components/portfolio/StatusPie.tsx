import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChartBlock,
  withRtlChrome,
  PORTFOLIO_CHART_COLORS as C,
} from './ChartBlock';
import { WidgetCard, WidgetEmpty } from './states';
import type {
  ContractsByStatus,
  ContractStatusBucket,
} from '@/services/api/portfolioService';

const ORDER: ContractStatusBucket[] = [
  'DRAFT',
  'IN_APPROVAL',
  'WITH_COUNTERPARTY',
  'ACTIVE',
  'COMPLETED',
  'TERMINATED',
];

const COLOR: Record<ContractStatusBucket, string> = {
  DRAFT: C.draft,
  IN_APPROVAL: C.inApproval,
  WITH_COUNTERPARTY: C.withCounterparty,
  ACTIVE: C.active,
  COMPLETED: C.completed,
  TERMINATED: C.terminated,
};

/**
 * RTL-distinct geometry #1 — PIE (doughnut). No axes; its RTL failure mode is
 * legend SIDE + legend/tooltip text direction. We flip the legend to the left
 * under rtl and rely on withRtlChrome for legend.rtl + textDirection.
 */
export default function StatusPie({ data }: { data: ContractsByStatus }) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.language === 'ar';

  const config = useMemo(
    () =>
      withRtlChrome(
        {
          type: 'doughnut',
          data: {
            labels: ORDER.map((b) => t(`portfolio.status.${b}`)),
            datasets: [
              {
                data: ORDER.map((b) => data.buckets[b] ?? 0),
                backgroundColor: ORDER.map((b) => COLOR[b]),
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
    <WidgetCard title={t('portfolio.charts.statusPie.title')}>
      {data.total === 0 ? <WidgetEmpty /> : <ChartBlock config={config} height={240} />}
    </WidgetCard>
  );
}
