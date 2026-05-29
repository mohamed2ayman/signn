import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  portfolioService,
  PortfolioFilters,
  PortfolioPeriod,
} from '@/services/api/portfolioService';
import { projectService } from '@/services/api/projectService';
import KpiCard from '@/components/portfolio/KpiCard';
import StatusPie from '@/components/portfolio/StatusPie';
import RiskDistributionBar from '@/components/portfolio/RiskDistributionBar';
import TimeToSignatureTrend from '@/components/portfolio/TimeToSignatureTrend';
import TopProjectsTable from '@/components/portfolio/TopProjectsTable';
import {
  PortfolioLoading,
  PortfolioEmptyState,
  PortfolioErrorState,
} from '@/components/portfolio/states';

const STORAGE_KEY = 'sign_portfolio_view';
const PERIODS: PortfolioPeriod[] = ['7d', '30d', '90d', '365d'];

interface PortfolioView {
  period: PortfolioPeriod;
  project_id: string; // '' = all projects
}

function loadView(): PortfolioView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return {
        period: PERIODS.includes(v?.period) ? v.period : '90d',
        project_id: typeof v?.project_id === 'string' ? v.project_id : '',
      };
    }
  } catch {
    /* ignore malformed localStorage */
  }
  return { period: '90d', project_id: '' };
}

const SELECT_CLS =
  'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400';

export default function PortfolioPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<PortfolioView>(loadView);

  // Persist filter + view state (localStorage v1).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
    } catch {
      /* ignore quota/availability errors */
    }
  }, [view]);

  // period + project_id are the ONLY server-side filters (see plan amendment 1).
  const apiFilters = useMemo<PortfolioFilters>(
    () => ({
      period: view.period,
      ...(view.project_id ? { project_id: view.project_id } : {}),
    }),
    [view],
  );

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['portfolio', apiFilters],
    queryFn: () => portfolioService.getPortfolioAnalytics(apiFilters),
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectService.getAll(),
  });

  // Amendment 2: "no data yet" (success + empty) is distinct from the error
  // state below. An org with nothing recorded yet → calm empty state.
  const isEmpty =
    !!data &&
    data.kpis.total_contracts === 0 &&
    data.contracts_by_status.total === 0 &&
    data.project_risk.length === 0 &&
    data.top_projects.length === 0 &&
    data.value_by_currency.length === 0;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-gray-900">{t('portfolio.title')}</h1>
        <p className="text-sm text-gray-500">{t('portfolio.subtitle')}</p>
      </div>

      {/* Filter bar — period + project only (server-side filters). */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <select
          aria-label={t('portfolio.filters.periodLabel')}
          value={view.period}
          onChange={(e) =>
            setView((v) => ({ ...v, period: e.target.value as PortfolioPeriod }))
          }
          className={SELECT_CLS}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`portfolio.filters.period.${p}`)}
            </option>
          ))}
        </select>

        <select
          aria-label={t('portfolio.filters.projectLabel')}
          value={view.project_id}
          onChange={(e) => setView((v) => ({ ...v, project_id: e.target.value }))}
          className={SELECT_CLS}
        >
          <option value="">{t('portfolio.filters.allProjects')}</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {isFetching && !isLoading && (
          <span className="text-xs text-gray-400">{t('portfolio.loadingInline')}</span>
        )}
      </div>

      {/* Body: loading / error / empty / data — error and empty are DISTINCT. */}
      {isLoading ? (
        <PortfolioLoading />
      ) : isError ? (
        <PortfolioErrorState onRetry={() => refetch()} />
      ) : !data || isEmpty ? (
        <PortfolioEmptyState />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={t('portfolio.kpis.totalContracts')} value={data.kpis.total_contracts} />
            <KpiCard label={t('portfolio.kpis.activeContracts')} value={data.kpis.active_contracts} />
            <KpiCard
              label={t('portfolio.kpis.contractsCreated')}
              value={data.kpis.contracts_created.current}
              delta={data.kpis.contracts_created}
            />
            <KpiCard
              label={t('portfolio.kpis.risksFlagged')}
              value={data.kpis.risks_flagged.current}
              delta={data.kpis.risks_flagged}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <StatusPie data={data.contracts_by_status} />
            <RiskDistributionBar data={data.risk_distribution} />
          </div>

          <TimeToSignatureTrend data={data.time_to_signature} />

          <TopProjectsTable data={data.top_projects} />
        </div>
      )}
    </div>
  );
}
