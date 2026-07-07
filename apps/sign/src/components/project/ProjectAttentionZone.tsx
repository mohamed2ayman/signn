import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { projectService } from '@/services/api/projectService';
import { contractService } from '@/services/api/contractService';
import { obligationService } from '@/services/api/obligationService';
import { WidgetCard } from '@/components/portfolio/states';
import ObligationTypeBadge from '@/components/obligations/ObligationTypeBadge';
import {
  daysUntil,
  daysTone,
  DAYS_TONE_STYLES,
} from '@/components/obligations/statusUtils';
import {
  deriveOverdueObligations,
  deriveContractExpiry,
  deriveHighRiskCount,
  type ContractWithExpiry,
} from './attentionData';
import type { ObligationPortfolioItem } from '@/services/api/obligationService';

/** In-page anchor id — ProjectHealthBar's drivers scroll here. */
export const ATTENTION_ZONE_ID = 'project-attention-zone';

const MAX_ROWS_PER_GROUP = 5;

/**
 * "Needs your attention" zone — 7.20 slice 2 (Rev 02 control-center model).
 * Leads with what requires action, ordered by urgency: overdue obligations →
 * expired/expiring contracts → high-risk count. Colour is the primary signal
 * (overdue/expired = red, expiring-soon = amber via daysTone).
 *
 * Data: the SAME three shared queryKeys as ProjectHealthBar — React Query
 * dedupes across components, so this zone adds zero network cost.
 * Per-source isolation: each feed renders its own scoped error; one failing
 * source never blanks the others (AttentionStrip's Amendment-2 model).
 */
export default function ProjectAttentionZone({
  projectId,
  onNavigateToTab,
}: {
  projectId: string;
  /** Tab-switch affordance (high-risk entry → Contracts tab, until the risk-mix slice). */
  onNavigateToTab?: (tab: 'contracts') => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

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

  const overdue = obligationsQ.data ? deriveOverdueObligations(obligationsQ.data) : null;
  const expiry = contractsQ.data
    ? deriveContractExpiry(contractsQ.data as ContractWithExpiry[])
    : null;
  const highRiskCount = dashboardQ.data ? deriveHighRiskCount(dashboardQ.data) : null;

  const isLoading = dashboardQ.isLoading || contractsQ.isLoading || obligationsQ.isLoading;
  const anyError = dashboardQ.isError || contractsQ.isError || obligationsQ.isError;

  // All-clear ONLY when every source loaded and every feed is empty —
  // an errored (unknown) source is never treated as "clear".
  const allClear =
    !anyError &&
    overdue !== null &&
    expiry !== null &&
    highRiskCount !== null &&
    overdue.length === 0 &&
    expiry.expiring.length === 0 &&
    expiry.expired.length === 0 &&
    highRiskCount === 0;

  return (
    <div id={ATTENTION_ZONE_ID}>
      <WidgetCard title={t('projectDashboard.attention.title')}>
        {isLoading && !anyError ? (
          <AttentionSkeleton />
        ) : allClear ? (
          <AllClear />
        ) : (
          <div className="space-y-5">
            {/* ── 1. Overdue obligations (most urgent) ── */}
            <FeedSection
              heading={t('projectDashboard.attention.overdueHeading')}
              count={overdue?.length ?? null}
              countTone="red"
              error={obligationsQ.isError ? t('projectDashboard.attention.error.obligations') : null}
              onRetry={() => void obligationsQ.refetch()}
            >
              {overdue && overdue.length > 0 && (
                <ul className="space-y-2">
                  {overdue.slice(0, MAX_ROWS_PER_GROUP).map((o) => (
                    <OverdueRow key={o.id} obligation={o} projectId={projectId} />
                  ))}
                </ul>
              )}
              {overdue && overdue.length > MAX_ROWS_PER_GROUP && (
                <MoreCount count={overdue.length - MAX_ROWS_PER_GROUP} />
              )}
            </FeedSection>

            {/* ── 2. Expired + expiring contracts (≤30 days) ── */}
            <FeedSection
              heading={t('projectDashboard.attention.expiringHeading')}
              count={expiry ? expiry.expired.length + expiry.expiring.length : null}
              countTone="amber"
              error={contractsQ.isError ? t('projectDashboard.attention.error.contracts') : null}
              onRetry={() => void contractsQ.refetch()}
            >
              {expiry && (expiry.expired.length > 0 || expiry.expiring.length > 0) && (
                <ul className="space-y-2">
                  {expiry.expired.slice(0, MAX_ROWS_PER_GROUP).map((e) => (
                    <ExpiryRow key={e.contract.id} entry={e} />
                  ))}
                  {expiry.expiring.slice(0, MAX_ROWS_PER_GROUP).map((e) => (
                    <ExpiryRow key={e.contract.id} entry={e} />
                  ))}
                </ul>
              )}
            </FeedSection>

            {/* ── 3. High-risk findings (risk mix panel is a LATER slice) ── */}
            <FeedSection
              heading={t('projectDashboard.attention.highRiskHeading')}
              count={highRiskCount}
              countTone="red"
              error={dashboardQ.isError ? t('projectDashboard.attention.error.risk') : null}
              onRetry={() => void dashboardQ.refetch()}
            >
              {highRiskCount !== null && highRiskCount > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigateToTab?.('contracts')}
                  className="group inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 transition-colors hover:border-red-300"
                >
                  <span>
                    {t('projectDashboard.attention.highRisk', { count: highRiskCount })}
                  </span>
                  <span aria-hidden="true" className="text-red-400 group-hover:text-red-600">
                    ↗
                  </span>
                </button>
              )}
            </FeedSection>

            {/* View all → the existing full project obligations view */}
            <div className="border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => navigate(`/app/projects/${projectId}/obligations`)}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary-600"
              >
                {t('projectDashboard.attention.viewAll')}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </div>
        )}
      </WidgetCard>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────

function FeedSection({
  heading,
  count,
  countTone,
  error,
  onRetry,
  children,
}: {
  heading: string;
  count: number | null;
  countTone: 'red' | 'amber';
  error: string | null;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const pill =
    count !== null && count > 0
      ? countTone === 'red'
        ? 'bg-red-100 text-red-700'
        : 'bg-amber-100 text-amber-700'
      : 'bg-gray-100 text-gray-500';
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{heading}</h4>
        {count !== null && (
          <span dir="ltr" className={`rounded-full px-2 py-0.5 text-xs font-semibold ${pill}`}>
            {count}
          </span>
        )}
      </div>
      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="ml-auto font-semibold underline">
            {t('projectDashboard.attention.retry')}
          </button>
        </div>
      ) : count === 0 ? (
        <p className="text-xs text-gray-400">{t('projectDashboard.attention.noneInGroup')}</p>
      ) : (
        children
      )}
    </section>
  );
}

function OverdueRow({
  obligation,
  projectId,
}: {
  obligation: ObligationPortfolioItem;
  projectId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const days = Math.abs(daysUntil(obligation.due_date) ?? 0);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2">
      <span dir="ltr" className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
        {t('projectDashboard.attention.daysOverdue', { count: days })}
      </span>
      {/* CLAUDE.md hard rule: obligation descriptions may be Arabic */}
      <span
        className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900"
        dir="auto"
        style={{ unicodeBidi: 'plaintext' }}
      >
        {obligation.is_critical && (
          <span aria-hidden="true" className="mr-1 text-red-600">
            ⚠
          </span>
        )}
        {obligation.description}
      </span>
      <ObligationTypeBadge type={obligation.obligation_type} />
      {obligation.responsible_party && (
        <span className="text-xs text-gray-500" dir="auto">
          {obligation.responsible_party}
        </span>
      )}
      {obligation.contract?.name && (
        <button
          type="button"
          onClick={() => navigate(`/app/contracts/${obligation.contract_id}`)}
          className="group inline-flex max-w-[180px] items-center gap-1 text-xs text-gray-500 transition-colors hover:text-primary"
        >
          <span className="truncate" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
            {obligation.contract.name}
          </span>
          <span aria-hidden="true">↗</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => navigate(`/app/projects/${projectId}/obligations`)}
        className="ml-auto shrink-0 rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
      >
        {t('projectDashboard.attention.open')}
      </button>
    </li>
  );
}

function ExpiryRow({ entry }: { entry: { contract: ContractWithExpiry; daysLeft: number } }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const expired = entry.daysLeft < 0;
  const tone = expired ? DAYS_TONE_STYLES.red : DAYS_TONE_STYLES[daysTone(entry.daysLeft)];
  const border = expired ? 'border-red-200 bg-red-50/60' : 'border-amber-200 bg-amber-50/60';
  const party =
    entry.contract.party_second_name || entry.contract.party_first_name || entry.contract.party_type;
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 ${border}`}>
      <span dir="ltr" className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${tone.bg} ${tone.text}`}>
        {expired
          ? t('projectDashboard.attention.expiredAgo', { count: Math.abs(entry.daysLeft) })
          : entry.daysLeft === 0
            ? t('projectDashboard.attention.expiresToday')
            : t('projectDashboard.attention.daysLeft', { count: entry.daysLeft })}
      </span>
      <button
        type="button"
        onClick={() => navigate(`/app/contracts/${entry.contract.id}`)}
        className="group inline-flex min-w-0 flex-1 items-center gap-1 text-sm font-medium text-gray-900 transition-colors hover:text-primary"
      >
        <span className="truncate" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
          {entry.contract.name}
        </span>
        <span aria-hidden="true" className="text-gray-300 group-hover:text-primary">
          ↗
        </span>
      </button>
      {party && (
        <span className="shrink-0 text-xs text-gray-500" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
          {party}
        </span>
      )}
    </li>
  );
}

function MoreCount({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <p className="mt-1.5 text-xs text-gray-400">
      {t('projectDashboard.attention.more', { count })}
    </p>
  );
}

function AllClear() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50/60 px-6 py-8 text-center">
      <div className="mb-2 text-3xl" aria-hidden="true">
        ✅
      </div>
      <h4 className="text-sm font-semibold text-emerald-800">
        {t('projectDashboard.attention.allClearTitle')}
      </h4>
      <p className="mt-1 max-w-md text-xs text-emerald-700">
        {t('projectDashboard.attention.allClearBody')}
      </p>
    </div>
  );
}

function AttentionSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}
