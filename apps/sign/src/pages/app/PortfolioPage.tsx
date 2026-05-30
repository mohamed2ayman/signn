import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  portfolioService,
  PortfolioFilters,
  PortfolioPeriod,
} from '@/services/api/portfolioService';
import { projectService } from '@/services/api/projectService';
import { obligationService } from '@/services/api/obligationService';
import AttentionStrip from '@/components/portfolio/AttentionStrip';
import KpiCard from '@/components/portfolio/KpiCard';
import StatusPie from '@/components/portfolio/StatusPie';
import RiskDistributionBar from '@/components/portfolio/RiskDistributionBar';
import ProjectRiskBar from '@/components/portfolio/ProjectRiskBar';
import StandardFormDoughnut from '@/components/portfolio/StandardFormDoughnut';
import ValueByCurrencyList from '@/components/portfolio/ValueByCurrencyList';
import UpcomingExpirationsCard from '@/components/portfolio/UpcomingExpirationsCard';
import UpcomingObligationsList from '@/components/portfolio/UpcomingObligationsList';
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

  // INDEPENDENT second source for the attention strip's overdue signal —
  // per-source state (loading/error/loaded) is propagated to the strip so a
  // failure here NEVER reads as "0 overdue" (Amendment 2, multi-source).
  const overdueQ = useQuery({
    queryKey: ['obligations', 'overdue'],
    queryFn: () => obligationService.getPortfolioObligations({ status: 'OVERDUE' }),
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
          {/* Attention strip — sticky top-of-content; per-signal state so an
              overdue-query failure renders as an explicit error pill, never as
              "0 overdue" and never blanking the strip's loaded signals. */}
          <AttentionStrip
            highRisks={{ value: data.risk_distribution.levels.HIGH }}
            expiringIn30={{ value: data.upcoming_expirations.in_30_days }}
            overdueObligations={
              overdueQ.isLoading
                ? { loading: true }
                : overdueQ.isError
                  ? { error: true }
                  : { value: overdueQ.data?.length ?? 0 }
            }
          />

          {/* KPI strip — 5 cards. `inverseGood` is applied ONLY to genuinely
              inverse metrics (Risks Flagged) so the badge correctly alarms on
              up-deltas and reassures on down-deltas. Open Risks is a snapshot
              count (no delta in the 2a contract). */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
            <KpiCard label={t('portfolio.kpis.totalContracts')} value={data.kpis.total_contracts} />
            <KpiCard label={t('portfolio.kpis.activeContracts')} value={data.kpis.active_contracts} />
            <KpiCard label={t('portfolio.kpis.openRisks')} value={data.kpis.open_risks} />
            <KpiCard
              label={t('portfolio.kpis.contractsCreated')}
              value={data.kpis.contracts_created.current}
              delta={data.kpis.contracts_created}
            />
            <KpiCard
              label={t('portfolio.kpis.risksFlagged')}
              value={data.kpis.risks_flagged.current}
              delta={data.kpis.risks_flagged}
              inverseGood
            />
          </div>

          {/* Doughnuts row */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <StatusPie data={data.contracts_by_status} />
            <StandardFormDoughnut data={data.contracts_by_standard_form} />
          </div>

          {/* Risk bars row — RiskDistributionBar (3 bands) + ProjectRiskBar (per project, free-text labels) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <RiskDistributionBar data={data.risk_distribution} />
            <ProjectRiskBar data={data.project_risk} />
          </div>

          {/* Trios row — value-per-currency (no FX, list), expirations card (stat
              tiles), upcoming-obligations 14d (independent obligationService query
              with its own loaded/empty/failed states). */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <ValueByCurrencyList data={data.value_by_currency} />
            <UpcomingExpirationsCard data={data.upcoming_expirations} />
            <UpcomingObligationsList />
          </div>

          <TimeToSignatureTrend data={data.time_to_signature} />

          <TopProjectsTable data={data.top_projects} />
        </div>
      )}
    </div>
  );
}
