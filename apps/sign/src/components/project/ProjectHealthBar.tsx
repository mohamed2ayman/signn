import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { projectService } from '@/services/api/projectService';
import { contractService } from '@/services/api/contractService';
import { obligationService } from '@/services/api/obligationService';
import { PORTFOLIO_CHART_COLORS } from '@/components/portfolio/ChartBlock';
import { WidgetCard, PortfolioLoading, PortfolioErrorState } from '@/components/portfolio/states';
import {
  computeProjectHealth,
  type HealthBand,
  type HealthDriver,
} from './projectHealth';
import type { Contract } from '@/types';

/**
 * Contract date fields exist on the wire (backend entity) but are not
 * declared on the frontend `Contract` type — bind locally per the 7.20
 * recon reference instead of widening the shared type in this slice.
 */
type ContractWithExpiry = Contract & { expiry_date?: string | null };

const BAND_COLOR: Record<HealthBand, string> = {
  healthy: PORTFOLIO_CHART_COLORS.riskLow,
  atRisk: PORTFOLIO_CHART_COLORS.riskMedium,
  critical: PORTFOLIO_CHART_COLORS.riskHigh,
};

/** Where each driver's "explain" affordance points, until its panel exists. */
const DRIVER_TARGET: Record<HealthDriver['key'], 'contracts' | 'obligations'> = {
  highRisk: 'contracts',
  mediumRisk: 'contracts',
  expired: 'contracts',
  expiring: 'contracts',
  stalled: 'contracts',
  overdueObligations: 'obligations',
};

export default function ProjectHealthBar({
  projectId,
  onNavigateToTab,
}: {
  projectId: string;
  /** Tab-switch affordance for drivers whose detail lives on another tab. */
  onNavigateToTab?: (tab: 'contracts') => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Three project-scoped queries — shared keys, reused by later slices
  // (the Contracts tab already consumes ['project-contracts', projectId];
  // React Query dedupes across components on the same key).
  const dashboardQ = useQuery({
    queryKey: ['project-dashboard', projectId],
    queryFn: () => projectService.getDashboard(projectId),
    enabled: !!projectId,
  });
  const contractsQ = useQuery({
    queryKey: ['project-contracts', projectId],
    queryFn: () => contractService.getAll(projectId),
    enabled: !!projectId,
  });
  const obligationsQ = useQuery({
    queryKey: ['project-obligations', projectId],
    queryFn: () => obligationService.getPortfolioObligations({ project_id: projectId }),
    enabled: !!projectId,
  });

  const health = useMemo(() => {
    if (!dashboardQ.data || !contractsQ.data || !obligationsQ.data) return null;
    return computeProjectHealth({
      dashboard: dashboardQ.data,
      contracts: (contractsQ.data as ContractWithExpiry[]).map((c) => ({
        status: c.status,
        expiry_date: c.expiry_date ?? null,
      })),
      obligations: obligationsQ.data.map((o) => ({
        status: o.status,
        due_date: o.due_date,
      })),
    });
  }, [dashboardQ.data, contractsQ.data, obligationsQ.data]);

  const isLoading = dashboardQ.isLoading || contractsQ.isLoading || obligationsQ.isLoading;
  const isError = dashboardQ.isError || contractsQ.isError || obligationsQ.isError;

  if (isLoading) {
    return (
      <WidgetCard title={t('projectDashboard.health.title')}>
        <PortfolioLoading />
      </WidgetCard>
    );
  }

  if (isError || !health) {
    return (
      <WidgetCard title={t('projectDashboard.health.title')}>
        <PortfolioErrorState
          onRetry={() => {
            void dashboardQ.refetch();
            void contractsQ.refetch();
            void obligationsQ.refetch();
          }}
        />
      </WidgetCard>
    );
  }

  if (!health.sufficient) {
    // NEUTRAL by design — never a misleading low/red score for a project
    // that simply has no analysed contracts yet.
    return (
      <WidgetCard title={t('projectDashboard.health.title')}>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
          <div className="mb-2 text-3xl" aria-hidden="true">
            🩺
          </div>
          <h4 className="text-sm font-semibold text-gray-700">
            {t('projectDashboard.health.insufficientTitle')}
          </h4>
          <p className="mt-1 max-w-sm text-xs text-gray-500">
            {t('projectDashboard.health.insufficientBody')}
          </p>
        </div>
      </WidgetCard>
    );
  }

  const { score, band, drivers } = health;
  const color = BAND_COLOR[band];

  const onDriverClick = (key: HealthDriver['key']) => {
    if (DRIVER_TARGET[key] === 'obligations') {
      navigate(`/app/projects/${projectId}/obligations`);
    } else {
      onNavigateToTab?.('contracts');
    }
  };

  return (
    <WidgetCard title={t('projectDashboard.health.title')}>
      <div className="flex items-end justify-between gap-3">
        {/* dir="ltr": "NN%" is numeric notation — reads LTR even under RTL
            (same convention as the portfolio KPI delta badges). */}
        <span dir="ltr" className="text-3xl font-bold text-gray-900">
          {score}%
        </span>
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          {t(`projectDashboard.health.band.${band}`)}
        </span>
      </div>

      {/* Horizontal health bar — fill width = score, fill colour = band. */}
      <div
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('projectDashboard.health.title')}
        className="mt-3 h-3 w-full overflow-hidden rounded-full bg-gray-100"
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>

      {drivers.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {t('projectDashboard.health.driversTitle')}
          </p>
          <ul className="mt-2 space-y-1.5">
            {drivers.map((d) => (
              <li key={d.key}>
                <button
                  type="button"
                  onClick={() => onDriverClick(d.key)}
                  className="group inline-flex items-center gap-1.5 text-sm text-gray-600 transition-colors hover:text-primary"
                >
                  <span>
                    {t(`projectDashboard.health.driver.${d.key}`, {
                      points: d.points,
                      count: d.count,
                    })}
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-gray-300 transition-colors group-hover:text-primary"
                  >
                    ↗
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}
