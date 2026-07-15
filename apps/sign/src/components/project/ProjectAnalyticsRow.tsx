import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';

import type { RootState } from '@/store';
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
import {
  type DashboardLayout,
  type WidgetId,
  layoutStorageKey,
  loadLayout,
  saveLayout,
  visibleWidgets,
  isAllHidden,
  isDefaultLayout,
  moveWidget,
  reorderTo,
  hideWidget,
  showWidget,
  resetLayout,
} from './dashboardLayout';
import type { PartyType } from '@/types';

/**
 * Supporting analytics row — 7.20 slice 3, made CUSTOMIZABLE in slice 5.
 *
 * Four widgets below the attention zone: (A) risk mix, (B) obligation rollup,
 * (C) contracts-by-status via the 12→6 fold, (D) directory summary. A and C
 * REUSE the self-carded portfolio charts (RiskDistributionBar / StatusPie) fed
 * by the pure adapters in dashboardAnalytics.ts.
 *
 * Slice 5 — CUSTOMIZE MODE: only these four widgets can be reordered / hidden /
 * restored. The ProjectHealthBar and ProjectAttentionZone are the fixed
 * dashboard spine (the "30-second test") and live in ProjectDetailPage above
 * this row — they carry NO customize controls, by design. Layout (order +
 * hidden set) persists to localStorage ONLY, per-user-and-project (see
 * dashboardLayout.ts). There is NO backend preferences store — server-side
 * layout sync is deferred to Ayman; the copy never implies cross-device sync.
 *
 * Data: A/C/D-counts ride the SAME ['project-dashboard'] and
 * ['project-obligations'] cache entries Slices 1-2 already fetch (lesson #213 —
 * identical queryKeys ARE the lift). ['project-parties'] + ['project-members']
 * are the directory-slice keys. Per-widget isolation: each widget renders its
 * own loading/error chrome from ITS source queries — one failure never blanks
 * the row.
 *
 * NOTE: the parent gives this component `key={projectId}`, so a project switch
 * remounts it and the localStorage layout for the new project loads cleanly via
 * the useState initializer — storageKey is therefore stable for an instance.
 */

const WIDGET_TITLE_KEYS: Record<WidgetId, string> = {
  riskMix: 'portfolio.charts.riskBar.title',
  obligations: 'projectDashboard.analytics.obligationsTitle',
  contractsByStatus: 'portfolio.charts.statusPie.title',
  directory: 'projectDashboard.analytics.directoryTitle',
};

export default function ProjectAnalyticsRow({
  projectId,
  onNavigateToTab,
}: {
  projectId: string;
  onNavigateToTab?: (tab: 'parties') => void;
}) {
  const { t } = useTranslation();
  const userId = useSelector((s: RootState) => s.auth.user?.id ?? null);
  const storageKey = layoutStorageKey(userId, projectId);

  const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout(storageKey));
  const [editMode, setEditMode] = useState(false);

  // Persist layout on every change — skip the initial mount so merely visiting
  // a project's dashboard never writes a default row to localStorage.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    saveLayout(storageKey, layout);
  }, [storageKey, layout]);

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

  // Each widget's rendered node, keyed by id — rendered in `layout` order.
  const widgetNodes: Record<WidgetId, React.ReactNode> = {
    riskMix: (
      <WidgetGate
        loading={dashboardQ.isLoading}
        error={dashboardQ.isError}
        onRetry={() => void dashboardQ.refetch()}
        title={t('portfolio.charts.riskBar.title')}
      >
        {dashboardQ.data && <RiskDistributionBar data={riskMixFromSummary(dashboardQ.data)} />}
      </WidgetGate>
    ),
    obligations: (
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
    ),
    contractsByStatus: (
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
    ),
    directory: (
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
    ),
  };

  const visible = visibleWidgets(layout);

  return (
    <section aria-label={t('projectDashboard.customize.sectionLabel')}>
      {/* ── Header: title + Customize entry point ── */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
          {t('projectDashboard.customize.sectionLabel')}
        </h2>
        {!editMode && (
          <button
            type="button"
            data-testid="customize-toggle"
            onClick={() => setEditMode(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
          >
            <SlidersIcon />
            {t('projectDashboard.customize.button')}
          </button>
        )}
      </div>

      {editMode ? (
        <CustomizePanel
          layout={layout}
          onChange={setLayout}
          onDone={() => setEditMode(false)}
        />
      ) : isAllHidden(layout) ? (
        <AllHiddenEmptyState onCustomize={() => setEditMode(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {visible.map((id) => (
            <div key={id} data-testid={`widget-${id}`}>
              {widgetNodes[id]}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Customize edit panel ────────────────────────────────────────

function CustomizePanel({
  layout,
  onChange,
  onDone,
}: {
  layout: DashboardLayout;
  onChange: (next: DashboardLayout) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [dragId, setDragId] = useState<WidgetId | null>(null);

  return (
    <div
      className="rounded-xl border border-primary/30 bg-primary/5 p-4"
      data-testid="customize-panel"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-800">
          {t('projectDashboard.customize.heading')}
        </h3>
        <button
          type="button"
          data-testid="customize-done"
          onClick={onDone}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
        >
          {t('projectDashboard.customize.done')}
        </button>
      </div>
      <p className="mb-3 text-xs text-gray-500">{t('projectDashboard.customize.dragHint')}</p>

      <ul className="space-y-2">
        {layout.order.map((id, idx) => {
          const isHidden = layout.hidden.includes(id);
          return (
            <li
              key={id}
              data-testid={`manage-row-${id}`}
              draggable
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId && dragId !== id) onChange(reorderTo(layout, dragId, id));
                setDragId(null);
              }}
              className={`flex items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 transition-opacity ${
                isHidden ? 'border-gray-200 opacity-60' : 'border-gray-200'
              } ${dragId === id ? 'opacity-40' : ''}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="cursor-grab text-gray-300">
                  <GripIcon />
                </span>
                <span className="truncate text-sm font-medium text-gray-700">
                  {t(WIDGET_TITLE_KEYS[id])}
                </span>
                {isHidden && (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                    {t('projectDashboard.customize.hiddenBadge')}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  testId={`customize-moveup-${id}`}
                  label={`${t('projectDashboard.customize.moveUp')}: ${t(WIDGET_TITLE_KEYS[id])}`}
                  disabled={idx === 0}
                  onClick={() => onChange(moveWidget(layout, id, -1))}
                >
                  <ArrowUpIcon />
                </IconButton>
                <IconButton
                  testId={`customize-movedown-${id}`}
                  label={`${t('projectDashboard.customize.moveDown')}: ${t(WIDGET_TITLE_KEYS[id])}`}
                  disabled={idx === layout.order.length - 1}
                  onClick={() => onChange(moveWidget(layout, id, 1))}
                >
                  <ArrowDownIcon />
                </IconButton>
                <button
                  type="button"
                  data-testid={`customize-visibility-${id}`}
                  onClick={() =>
                    onChange(isHidden ? showWidget(layout, id) : hideWidget(layout, id))
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                >
                  {isHidden ? (
                    <>
                      <EyeIcon />
                      {t('projectDashboard.customize.show')}
                    </>
                  ) : (
                    <>
                      <EyeOffIcon />
                      {t('projectDashboard.customize.hide')}
                    </>
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          data-testid="customize-reset"
          disabled={isDefaultLayout(layout)}
          onClick={() => onChange(resetLayout())}
          className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-700 disabled:cursor-default disabled:text-gray-300"
        >
          {t('projectDashboard.customize.reset')}
        </button>
        <p className="text-[11px] text-gray-400">{t('projectDashboard.customize.browserNote')}</p>
      </div>
    </div>
  );
}

function IconButton({
  testId,
  label,
  disabled,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 transition hover:bg-gray-50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

// ─── All-hidden empty state (view mode) ──────────────────────────

function AllHiddenEmptyState({ onCustomize }: { onCustomize: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="analytics-empty"
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center"
    >
      <div className="mb-2 text-3xl" aria-hidden="true">
        🗂️
      </div>
      <h3 className="text-sm font-semibold text-gray-700">
        {t('projectDashboard.customize.empty.heading')}
      </h3>
      <p className="mt-1 max-w-md text-sm text-gray-500">
        {t('projectDashboard.customize.empty.body')}
      </p>
      <button
        type="button"
        data-testid="customize-empty-restore"
        onClick={onCustomize}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
      >
        {t('projectDashboard.customize.empty.action')}
      </button>
    </div>
  );
}

// ─── Shared per-widget chrome (unchanged from slice 3) ───────────

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

// ─── B. Upcoming list (unchanged from slice 3) ───────────────────

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

// ─── D. Directory summary (unchanged from slice 3) ───────────────

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

// ─── Icons (inline, stroke — match the codebase convention) ──────

function SlidersIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 4v6m0 4v6m6-16v10m0 4v2m6-16v2m0 4v10M3 10h6m3 6h6M15 8h6" />
    </svg>
  );
}
function GripIcon() {
  return (
    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
    </svg>
  );
}
function ArrowUpIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-6 6m6-6l6 6" />
    </svg>
  );
}
function ArrowDownIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m0 0l6-6m-6 6l-6-6" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1 1 0 010-.644C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178a1 1 0 010 .644C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.774 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88" />
    </svg>
  );
}
