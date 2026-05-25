import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { obligationService } from '@/services/api/obligationService';
import type {
  ObligationPortfolioItem,
  PortfolioObligationFilters,
} from '@/services/api/obligationService';
import complianceService from '@/services/api/complianceService';
import { projectService } from '@/services/api/projectService';
import type { ProjectMember } from '@/types';
import ObligationKpiRow from '@/components/obligations/ObligationKpiRow';
import ObligationFilterBar, {
  type ObligationFilters,
} from '@/components/obligations/ObligationFilterBar';
import ObligationCard from '@/components/obligations/ObligationCard';
import ObligationEmptyState from '@/components/obligations/ObligationEmptyState';
import ObligationLoadingSkeleton from '@/components/obligations/ObligationLoadingSkeleton';
import ObligationErrorState from '@/components/obligations/ObligationErrorState';
import { computeKpis, effectiveStatus } from '@/components/obligations/statusUtils';

/**
 * /app/obligations — cross-contract portfolio view.
 *
 * Phase 7.1 Step 2: replaces the legacy contract-creator-only dashboard
 * with a real portfolio surface backed by `GET /obligations/portfolio`.
 *
 * NOT yet implemented (deferred to Step 3+):
 *  - Calendar view (button is a placeholder navigate to /app/obligations/calendar)
 *  - Excel export (button logs to console — proper export comes later)
 *  - Add Obligation modal (creation must be scoped to a contract — for
 *    now we show the empty state without an "Add" CTA on the portfolio
 *    page since creation is always done from a contract's Obligations tab)
 *  - Plan gating (Starter vs Professional/Enterprise) — see lessons.md
 *    note for Phase 7.1 Step 2: no plan tier enum exists yet
 */
export default function ObligationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ObligationFilters>({});

  // Map UI filters → API params. Search is applied client-side because
  // the backend portfolio endpoint doesn't expose a search parameter.
  const apiFilters: PortfolioObligationFilters = useMemo(() => {
    const f: PortfolioObligationFilters = {};
    if (filters.project_id) f.project_id = filters.project_id;
    if (filters.type) f.type = filters.type;
    if (filters.status) f.status = filters.status;
    if (filters.assignee) f.assignee = filters.assignee;
    if (filters.from) f.from = filters.from;
    if (filters.to) f.to = filters.to;
    return f;
  }, [filters]);

  // ── Portfolio obligations ───────────────────────────────────────
  const portfolioQuery = useQuery({
    queryKey: ['portfolio-obligations', apiFilters],
    queryFn: () => obligationService.getPortfolioObligations(apiFilters),
  });

  // ── Projects (for the project filter) ───────────────────────────
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectService.getAll(),
  });

  // ── Project members for the assignee select ─────────────────────
  // Two strategies:
  //  1. If a project is selected, fetch its members (richer data)
  //  2. Otherwise, derive unique assignee users from the obligations
  //     already loaded — they carry user info on the assignee row.
  const projectMembersQuery = useQuery({
    queryKey: ['project-members', filters.project_id],
    queryFn: () => projectService.getMembers(filters.project_id!),
    enabled: !!filters.project_id,
  });

  const derivedAssignees: ProjectMember[] = useMemo(() => {
    if (filters.project_id && projectMembersQuery.data) {
      return projectMembersQuery.data;
    }
    const seen = new Map<string, ProjectMember>();
    for (const o of portfolioQuery.data ?? []) {
      for (const a of o.assignees ?? []) {
        if (!seen.has(a.user_id) && a.user) {
          // Fabricate a ProjectMember-shaped object so the FilterBar
          // can reuse one type. user_id + user is the only thing the
          // bar reads.
          seen.set(a.user_id, {
            id: `assignee-${a.user_id}`,
            project_id: '',
            user_id: a.user_id,
            role: null,
            permission_level: null,
            added_at: a.assigned_at,
            user: {
              id: a.user.id,
              email: a.user.email,
              first_name: a.user.first_name,
              last_name: a.user.last_name,
            } as ProjectMember['user'],
          });
        }
      }
    }
    return [...seen.values()];
  }, [filters.project_id, projectMembersQuery.data, portfolioQuery.data]);

  // ── Client-side post-filtering (search) ─────────────────────────
  const visible: ObligationPortfolioItem[] = useMemo(() => {
    const all = portfolioQuery.data ?? [];
    const search = filters.search?.trim().toLowerCase();
    return all.filter((o) => {
      if (filters.contract_id && o.contract_id !== filters.contract_id) {
        return false;
      }
      if (search) {
        const hay = `${o.description} ${o.clause_ref ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [portfolioQuery.data, filters.search, filters.contract_id]);

  // KPIs computed against the SERVER-FILTERED list — so the user
  // sees counts matching the rendered cards. Search-only filtering
  // doesn't change KPIs because search is a string match, not a
  // semantic filter.
  const kpis = useMemo(() => {
    const items = (portfolioQuery.data ?? []).filter((o) =>
      filters.contract_id ? o.contract_id === filters.contract_id : true,
    );
    return {
      ...computeKpis(items),
      // override pending to mean "due this week" for the portfolio
      // KPIs per Step 2 spec: Total / Overdue / Due This Week / Actioned
    };
  }, [portfolioQuery.data, filters.contract_id]);

  const dueThisWeek = useMemo(() => {
    const week = Date.now() + 7 * 86_400_000;
    return (portfolioQuery.data ?? []).filter((o) => {
      if (filters.contract_id && o.contract_id !== filters.contract_id) return false;
      const eff = effectiveStatus(o.status, o.due_date);
      if (eff === 'OVERDUE') return false;
      if (eff === 'COMPLETED' || eff === 'MET' || eff === 'WAIVED') return false;
      return !!o.due_date && +new Date(o.due_date) <= week;
    }).length;
  }, [portfolioQuery.data, filters.contract_id]);

  // ── "Mark as Actioned" mutation ─────────────────────────────────
  const markActioned = useMutation({
    mutationFn: ({ contractId, obligationId }: { contractId: string; obligationId: string }) =>
      complianceService.updateObligation(contractId, obligationId, {
        status: 'COMPLETED',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portfolio-obligations'] }),
  });

  // ── Handlers ────────────────────────────────────────────────────
  const handleViewCalendar = () => navigate('/app/obligations/calendar');
  const handleExport = () => {
    // eslint-disable-next-line no-console
    console.info('[ObligationsPage] Export to Excel — deferred to Step 3');
  };
  const handleEdit = (id: string) => {
    // eslint-disable-next-line no-console
    console.info('[ObligationsPage] Edit obligation — modal in Step 3', id);
  };
  const handleAssign = (id: string) => {
    // eslint-disable-next-line no-console
    console.info('[ObligationsPage] Assign obligation — modal in Step 3', id);
  };
  const handleViewDetails = (id: string) => {
    // eslint-disable-next-line no-console
    console.info('[ObligationsPage] View details — page in Step 4', id);
  };

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {t('obligation.ui.allTitle')}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {t('obligation.ui.allSubtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleViewCalendar}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
            {t('obligation.ui.viewCalendar')}
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3M9 21h6a3 3 0 003-3V8a3 3 0 00-3-3H9a3 3 0 00-3 3v10a3 3 0 003 3z" />
            </svg>
            {t('obligation.ui.exportExcel')}
          </button>
        </div>
      </div>

      {/* ── KPI row — portfolio variant ──────────────────────────── */}
      {/* Total / Overdue / Due this week / Actioned per Step 2 spec.
          We reuse ObligationKpiRow but override the "Pending" slot
          with "Due This Week" via the counts shape. */}
      <ObligationKpiRow
        counts={{
          total: kpis.total,
          pending: dueThisWeek,
          overdue: kpis.overdue,
          actioned: kpis.actioned,
        }}
      />

      {/* ── Filter bar ──────────────────────────────────────────── */}
      <ObligationFilterBar
        variant="portfolio"
        filters={filters}
        onChange={setFilters}
        projects={projectsQuery.data ?? []}
        members={derivedAssignees}
      />

      {/* Project + contract context strip — visible only when filtered */}
      {(filters.project_id || filters.contract_id) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span className="font-medium uppercase tracking-wide text-gray-500">
            {t('common.filter')}:
          </span>
          {filters.project_id && (
            <Link
              to={`/app/projects/${filters.project_id}`}
              className="rounded-full bg-primary/10 px-2.5 py-0.5 text-primary hover:bg-primary/20"
            >
              {projectsQuery.data?.find((p) => p.id === filters.project_id)?.name ?? '—'}
            </Link>
          )}
          {filters.contract_id && (
            <Link
              to={`/app/contracts/${filters.contract_id}`}
              className="rounded-full bg-primary/10 px-2.5 py-0.5 text-primary hover:bg-primary/20"
            >
              #{filters.contract_id.slice(0, 8)}
            </Link>
          )}
          <button
            onClick={() => setFilters({})}
            className="text-gray-500 hover:text-gray-700"
          >
            {t('obligation.ui.clearFilters')}
          </button>
        </div>
      )}

      {/* ── List / states ───────────────────────────────────────── */}
      {portfolioQuery.isError ? (
        <ObligationErrorState
          error={portfolioQuery.error}
          onRetry={() => portfolioQuery.refetch()}
        />
      ) : portfolioQuery.isLoading ? (
        <ObligationLoadingSkeleton />
      ) : (portfolioQuery.data ?? []).length === 0 ? (
        <ObligationEmptyState />
      ) : visible.length === 0 ? (
        <ObligationEmptyState variant="no-matches" />
      ) : (
        <div className="space-y-3">
          {visible.map((o) => (
            <ObligationCard
              key={o.id}
              obligation={o}
              showContractLink
              onMarkActioned={(obligationId) =>
                markActioned.mutate({ contractId: o.contract_id, obligationId })
              }
              onEdit={handleEdit}
              onAssign={handleAssign}
              onViewDetails={handleViewDetails}
            />
          ))}
        </div>
      )}
    </div>
  );
}
