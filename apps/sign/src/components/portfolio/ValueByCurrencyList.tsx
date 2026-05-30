import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WidgetCard, WidgetEmpty } from './states';
import type { ValueByCurrency } from '@/services/api/portfolioService';

// Per D2: list of currency rows ("EGP 100,000,000.00 · 12 contracts"), sorted
// by total desc, NO bars (bars imply cross-currency comparison the no-FX rule
// forbids). Latin numerals + ISO currency code regardless of locale (lesson
// #137: MENA construction-finance convention). dir="ltr" on the value+code
// string so it reads normally under page rtl (bidi/notation, same #136 pattern
// as the KpiCard badge).
const MONEY = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function ValueByCurrencyList({ data }: { data: ValueByCurrency[] }) {
  const { t } = useTranslation();
  const rows = useMemo(() => [...data].sort((a, b) => b.total - a.total), [data]);

  return (
    <WidgetCard title={t('portfolio.charts.valueByCurrency.title')}>
      {rows.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li
              key={r.currency}
              className="flex items-baseline justify-between gap-4 py-2.5"
            >
              <span dir="ltr" className="text-sm font-semibold tabular-nums text-gray-800">
                {MONEY.format(r.total)} {r.currency}
              </span>
              <span className="text-xs text-gray-500">
                {t('portfolio.charts.valueByCurrency.count', { count: r.count })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
