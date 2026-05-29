import { useTranslation } from 'react-i18next';
import { WidgetCard, WidgetEmpty } from './states';
import type { TopProject, RiskLevel } from '@/services/api/portfolioService';

const RISK_BADGE: Record<RiskLevel, string> = {
  HIGH: 'bg-red-50 text-red-700',
  MEDIUM: 'bg-amber-50 text-amber-700',
  LOW: 'bg-emerald-50 text-emerald-700',
};

export default function TopProjectsTable({ data }: { data: TopProject[] }) {
  const { t } = useTranslation();

  return (
    <WidgetCard title={t('portfolio.topProjects.title')}>
      {data.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <div className="overflow-x-auto w-full">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500 ltr:text-left rtl:text-right">
                <th className="px-3 py-2 font-medium">{t('portfolio.topProjects.col.project')}</th>
                <th className="px-3 py-2 font-medium ltr:text-right rtl:text-left">
                  {t('portfolio.topProjects.col.contracts')}
                </th>
                <th className="px-3 py-2 font-medium ltr:text-right rtl:text-left">
                  {t('portfolio.topProjects.col.active')}
                </th>
                <th className="px-3 py-2 font-medium">{t('portfolio.topProjects.col.worstRisk')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.project_id} className="border-b border-gray-50 last:border-0">
                  <td
                    className="px-3 py-2 font-medium text-gray-800"
                    dir="auto"
                    style={{ unicodeBidi: 'plaintext' }}
                  >
                    {p.project_name}
                  </td>
                  <td className="px-3 py-2 text-gray-700 ltr:text-right rtl:text-left">
                    {p.contract_count}
                  </td>
                  <td className="px-3 py-2 text-gray-700 ltr:text-right rtl:text-left">
                    {p.active_count}
                  </td>
                  <td className="px-3 py-2">
                    {p.worst_level ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${RISK_BADGE[p.worst_level]}`}
                      >
                        {t(`portfolio.riskLevel.${p.worst_level}`)}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetCard>
  );
}
