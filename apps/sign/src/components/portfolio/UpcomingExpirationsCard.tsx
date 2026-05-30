import { useTranslation } from 'react-i18next';
import { WidgetCard, WidgetEmpty } from './states';
import type { UpcomingExpirations } from '@/services/api/portfolioService';

/**
 * Three-tile stat group: 30d (red), 31-60d (amber), 61-90d (gray neutral) +
 * a small total-within-90d caption. Numerals Latin per #137; tile values wrapped
 * dir="ltr" so they read normally under page rtl. New shape (stat-card-group)
 * — AR-screenshotted per Bucket-3 brief.
 */
const NUM = new Intl.NumberFormat('en-US');

export default function UpcomingExpirationsCard({ data }: { data: UpcomingExpirations }) {
  const { t } = useTranslation();

  const tiles = [
    { key: 'in_30_days', value: data.in_30_days, valueCls: 'text-red-700' },
    { key: 'in_60_days', value: data.in_60_days, valueCls: 'text-amber-700' },
    { key: 'in_90_days', value: data.in_90_days, valueCls: 'text-gray-700' },
  ] as const;

  return (
    <WidgetCard title={t('portfolio.charts.expirations.title')}>
      {data.total_within_90 === 0 ? (
        <WidgetEmpty />
      ) : (
        <div>
          <div className="grid grid-cols-3 gap-3">
            {tiles.map((t2) => (
              <div
                key={t2.key}
                className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-center"
              >
                <div className={`text-2xl font-bold tabular-nums ${t2.valueCls}`} dir="ltr">
                  {NUM.format(t2.value)}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {t(`portfolio.charts.expirations.${t2.key}`)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-center text-xs text-gray-500">
            {t('portfolio.charts.expirations.totalWithin90', { count: data.total_within_90 })}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
