import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import { obligationService } from '@/services/api/obligationService';
import type {
  ObligationPortfolioItem,
  PortfolioObligationFilters,
} from '@/services/api/obligationService';
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
// Phase 7.1 Step 3 — modals + drawer wired to replace Step 2 placeholders.
import AddEditObligationModal from '@/components/obligations/AddEditObligationModal';
import MarkActionedModal from '@/components/obligations/MarkActionedModal';
import AssignUserModal from '@/components/obligations/AssignUserModal';
import ObligationDetailDrawer from '@/components/obligations/ObligationDetailDrawer';

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
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ObligationFilters>({});

  // ── Permission gate (Phase 7.15) ────────────────────────────────
  const currentUser = useSelector((state: RootState) => state.auth.user);
  const canEdit =
    currentUser?.role === 'SYSTEM_ADMIN' ||
    currentUser?.role === 'OWNER_ADMIN' ||
    currentUser?.role === 'PROJECT_MANAGER' ||
    currentUser?.role === 'REVIEWER' ||
    currentUser?.role === 'CONTRACTOR_ADMIN';
  const canDelete =
    currentUser?.role === 'SYSTEM_ADMIN' ||
    currentUser?.role === 'OWNER_ADMIN';

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

  // ── Modal + drawer state (Phase 7.1 Step 3) ─────────────────────
  // Portfolio page doesn't have an "Add" surface — creation flows from
  // ContractDetailPage's Obligations tab (where the contract is known).
  // Edit / mark-actioned / assign hold the target obligation.
  const [editObligation, setEditObligation] = useState<ObligationPortfolioItem | null>(null);
  const [actioningObligation, setActioningObligation] = useState<ObligationPortfolioItem | null>(null);
  const [assigningObligation, setAssigningObligation] = useState<ObligationPortfolioItem | null>(null);
  const [detailObligation, setDetailObligation] = useState<{ id: string; contractId: string } | null>(null);

  // ── Delete state (Phase 7.15) ───────────────────────────────────
  const [deletingObligation, setDeletingObligation] = useState<ObligationPortfolioItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const find = (id: string): ObligationPortfolioItem | null =>
    (portfolioQuery.data ?? []).find((o) => o.id === id) ?? null;

  // ── Handlers ────────────────────────────────────────────────────
  const handleViewCalendar = () => navigate('/app/obligations/calendar');
  const handleExport = () => {
    // Export deferred — backend has no CSV/XLSX endpoint yet. Tracked
    // in CLAUDE.md "what's deferred" for Phase 7.1 Step 3.
    // eslint-disable-next-line no-console
    console.info('[ObligationsPage] Export to Excel — deferred to a future step');
  };
  const handleEdit = (id: string) => setEditObligation(find(id));
  const handleAssign = (id: string) => setAssigningObligation(find(id));
  const handleMarkActioned = (id: string) =>
    setActioningObligation(find(id));
  const handleViewDetails = (id: string) => {
    const o = find(id);
    if (o) setDetailObligation({ id: o.id, contractId: o.contract_id });
  };
  const handleDelete = (id: string) => {
    setDeleteError(null);
    setDeletingObligation(find(id));
  };
  const confirmDelete = async () => {
    if (!deletingObligation) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await obligationService.delete(deletingObligation.id);
      await queryClient.invalidateQueries({ queryKey: ['portfolio-obligations'] });
      setDeletingObligation(null);
    } catch (err: any) {
      setDeleteError(
        err?.response?.data?.message ?? t('obligation.ui.errorTitle'),
      );
    } finally {
      setDeleteLoading(false);
    }
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
              onMarkActioned={handleMarkActioned}
              onEdit={handleEdit}
              onAssign={handleAssign}
              onViewDetails={handleViewDetails}
              onDelete={canDelete ? handleDelete : undefined}
            />
          ))}
        </div>
      )}

      {/* ── Modals + drawer (Phase 7.1 Step 3) ──────────────────── */}
      {/* No Add modal here — creation happens from Contract Detail
          where the contract context is known. Portfolio is read-mostly. */}
      <AddEditObligationModal
        isOpen={!!editObligation}
        onClose={() => setEditObligation(null)}
        contractId={editObligation?.contract_id ?? ''}
        obligation={editObligation}
      />
      <MarkActionedModal
        isOpen={!!actioningObligation}
        onClose={() => setActioningObligation(null)}
        contractId={actioningObligation?.contract_id ?? ''}
        obligation={actioningObligation}
      />
      <AssignUserModal
        isOpen={!!assigningObligation}
        onClose={() => setAssigningObligation(null)}
        contractId={assigningObligation?.contract_id ?? ''}
        projectId={assigningObligation?.project_id ?? undefined}
        obligation={assigningObligation}
      />
      <ObligationDetailDrawer
        isOpen={!!detailObligation}
        onClose={() => setDetailObligation(null)}
        obligationId={detailObligation?.id ?? null}
        contractId={detailObligation?.contractId ?? ''}
        onEdit={canEdit ? (o) => setEditObligation(o as ObligationPortfolioItem) : undefined}
        onMarkActioned={(o) => setActioningObligation(o as ObligationPortfolioItem)}
        onAssign={(o) => setAssigningObligation(o as ObligationPortfolioItem)}
      />

      {/* ── Delete confirmation dialog (Phase 7.15) ─────────────── */}
      {deletingObligation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !deleteLoading && setDeletingObligation(null)} />
          <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">
              {t('obligation.deleteConfirm.title')}
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              {t('obligation.deleteConfirm.message')}
            </p>
            {deletingObligation.description && (
              <p
                className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800"
                dir="auto"
                style={{ unicodeBidi: 'plaintext' }}
              >
                {deletingObligation.description}
              </p>
            )}
            {deleteError && (
              <p className="mt-2 text-sm text-red-600" role="alert">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => setDeletingObligation(null)}
                className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('obligation.deleteConfirm.cancel')}
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={confirmDelete}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? t('common.loading') : t('obligation.deleteConfirm.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
