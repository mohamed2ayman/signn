import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { projectService } from '@/services/api/projectService';
import { projectPartyService } from '@/services/api/projectPartyService';
import { obligationService } from '@/services/api/obligationService';
import { WidgetCard } from '@/components/portfolio/states';
import RiskDistributionBar from '@/components/portfolio/RiskDistributionBar';
import StatusPie from '@/components/portfolio/StatusPie';
import ObligationKpiRow from '@/components/obligations/ObligationKpiRow';
import {
  computeKpis,
  daysUntil,
  daysTone,
  DAYS_TONE_STYLES,
} from '@/components/obligations/statusUtils';
import {
  foldContractStatuses,
  riskMixFromSummary,
  deriveUpcomingObligations,
} from './dashboardAnalytics';
import type { PartyType } from '@/types';

/**
 * Supporting analytics row — 7.20 slice 3. Four widgets below the attention
 * zone: (A) risk mix, (B) obligation rollup, (C) contracts-by-status via the
 * 12→6 fold, (D) directory summary. A and C REUSE the self-carded portfolio
 * charts (RiskDistributionBar / StatusPie) fed by the pure adapters in
 * dashboardAnalytics.ts.
 *
 * Data: A/C/D-counts ride the SAME ['project-dashboard'] and
 * ['project-obligations'] cache entries Slices 1-2 already fetch (lesson
 * #213 — identical queryKeys ARE the lift). NEW queries this slice:
 * ['project-parties'] + ['project-members'] (reused later by the directory
 * slice). Per-widget isolation: each widget renders its own loading/error
 * chrome from ITS source queries — one failure never blanks the row.
 */
export default function ProjectAnalyticsRow({
  projectId,
  onNavigateToTab,
}: {
  projectId: string;
  onNavigateToTab?: (tab: 'parties') => void;
}) {
  const { t } = useTranslation();

  const dashboardQ = useQuery({
    queryKey: ['project-dashboard', projectId],
    queryFn: () => projectService.getDashboard(projectId),
    enabled: !!projectId,
  });
  const obligationsQ = useQuery({
    queryKey: ['project-obligations', projectId],
    queryFn: () => obligationService.getPortfolioObligations({ project_id: projectId }),
    enabled: !!projectId,
  });
  // NEW this slice — the directory slice will reuse these keys.
  const partiesQ = useQuery({
    queryKey: ['project-parties', projectId],
    queryFn: () => projectPartyService.getAll(projectId),
    enabled: !!projectId,
  });
  const membersQ = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectService.getMembers(projectId),
    enabled: !!projectId,
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* ── A. Risk mix ── */}
      <WidgetGate
        loading={dashboardQ.isLoading}
        error={dashboardQ.isError}
        onRetry={() => void dashboardQ.refetch()}
        title={t('portfolio.charts.riskBar.title')}
      >
        {dashboardQ.data && <RiskDistributionBar data={riskMixFromSummary(dashboardQ.data)} />}
      </WidgetGate>

      {/* ── B. Obligation rollup ── */}
      <WidgetGate
        loading={obligationsQ.isLoading}
        error={obligationsQ.isError}
        onRetry={() => void obligationsQ.refetch()}
        title={t('projectDashboard.analytics.obligationsTitle')}
      >
        {obligationsQ.data && (
          <WidgetCard title={t('projectDashboard.analytics.obligationsTitle')}>
            <ObligationKpiRow counts={computeKpis(obligationsQ.data)} />
            <UpcomingList obligations={deriveUpcomingObligations(obligationsQ.data)} />
          </WidgetCard>
        )}
      </WidgetGate>

      {/* ── C. Contracts by status (the 12→6 fold) ── */}
      <WidgetGate
        loading={dashboardQ.isLoading}
        error={dashboardQ.isError}
        onRetry={() => void dashboardQ.refetch()}
        title={t('portfolio.charts.statusPie.title')}
      >
        {dashboardQ.data && (
          <StatusPie data={foldContractStatuses(dashboardQ.data.contracts.by_status)} />
        )}
      </WidgetGate>

      {/* ── D. Directory summary ── */}
      <WidgetGate
        loading={partiesQ.isLoading || membersQ.isLoading}
        error={partiesQ.isError || membersQ.isError}
        onRetry={() => {
          void partiesQ.refetch();
          void membersQ.refetch();
        }}
        title={t('projectDashboard.analytics.directoryTitle')}
      >
        {partiesQ.data && membersQ.data && (
          <DirectorySummary
            partyCounts={countByType(partiesQ.data.map((p) => p.party_type))}
            pendingInvites={partiesQ.data.filter((p) => p.invitation_status === 'PENDING').length}
            teamCount={membersQ.data.length}
            onViewAll={() => onNavigateToTab?.('parties')}
          />
        )}
      </WidgetGate>
    </div>
  );
}

// ─── Shared per-widget chrome ────────────────────────────────────

function WidgetGate({
  loading,
  error,
  onRetry,
  title,
  children,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  if (error) {
    return (
      <WidgetCard title={title}>
        <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center">
          <span aria-hidden="true" className="text-2xl">
            ⚠️
          </span>
          <p className="text-sm text-red-700">{t('projectDashboard.analytics.error')}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
          >
            {t('projectDashboard.analytics.retry')}
          </button>
        </div>
      </WidgetCard>
    );
  }
  if (loading) {
    return (
      <WidgetCard title={title}>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </WidgetCard>
    );
  }
  return <>{children}</>;
}

// ─── B. Upcoming list ────────────────────────────────────────────

function UpcomingList({
  obligations,
}: {
  obligations: ReturnType<typeof deriveUpcomingObligations>;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
        {t('projectDashboard.analytics.upcomingTitle')}
      </p>
      {obligations.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">
          {t('projectDashboard.analytics.noneUpcoming')}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {obligations.map((o) => {
            const days = daysUntil(o.due_date) ?? 0;
            const tone = DAYS_TONE_STYLES[daysTone(days)];
            return (
              <li key={o.id} className="flex items-center gap-2">
                <span
                  dir="ltr"
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${tone.bg} ${tone.text}`}
                >
                  {days === 0
                    ? t('projectDashboard.analytics.dueToday')
                    : t('projectDashboard.analytics.dueIn', { count: days })}
                </span>
                {/* CLAUDE.md hard rule: descriptions may be Arabic */}
                <span
                  className="min-w-0 flex-1 truncate text-sm text-gray-700"
                  dir="auto"
                  style={{ unicodeBidi: 'plaintext' }}
                >
                  {o.description}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── D. Directory summary ────────────────────────────────────────

function countByType(types: PartyType[]): Array<{ type: PartyType; count: number }> {
  const map = new Map<PartyType, number>();
  for (const type of types) map.set(type, (map.get(type) ?? 0) + 1);
  return [...map.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

function DirectorySummary({
  partyCounts,
  pendingInvites,
  teamCount,
  onViewAll,
}: {
  partyCounts: Array<{ type: PartyType; count: number }>;
  pendingInvites: number;
  teamCount: number;
  onViewAll: () => void;
}) {
  const { t } = useTranslation();
  const empty = partyCounts.length === 0 && teamCount === 0;
  return (
    <WidgetCard title={t('projectDashboard.analytics.directoryTitle')}>
      {empty ? (
        <div className="flex h-[180px] items-center justify-center text-sm text-gray-400">
          {t('projectDashboard.analytics.directory.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">
              {t('projectDashboard.analytics.directory.team')}
            </span>
            <span className="text-sm font-semibold text-gray-900">
              {t('projectDashboard.analytics.directory.teamCount', { count: teamCount })}
            </span>
          </div>
          {partyCounts.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                {t('projectDashboard.analytics.directory.external')}
              </p>
              <ul className="space-y-1.5">
                {partyCounts.map(({ type, count }) => (
                  <li key={type} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      {t(`projectDashboard.analytics.directory.partyType.${type}`)}
                    </span>
                    <span dir="ltr" className="text-sm font-semibold text-gray-900">
                      {count}
                    </span>
                  </li>
                ))}
              </ul>
              {pendingInvites > 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  {t('projectDashboard.analytics.directory.pendingInvites', {
                    count: pendingInvites,
                  })}
                </p>
              )}
            </div>
          )}
          <div className="border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onViewAll}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary-600"
            >
              {t('projectDashboard.analytics.directory.viewAll')}
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
