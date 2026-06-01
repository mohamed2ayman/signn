import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { RootState } from '@/store';
import complianceService, {
  type ContractObligation,
} from '@/services/api/complianceService';
import { obligationService } from '@/services/api/obligationService';
import { projectService } from '@/services/api/projectService';
import type { ObligationPortfolioItem } from '@/services/api/obligationService';
import ObligationKpiRow from '@/components/obligations/ObligationKpiRow';
import ObligationFilterBar, {
  type ObligationFilters,
} from '@/components/obligations/ObligationFilterBar';
import ObligationCard from '@/components/obligations/ObligationCard';
import ObligationEmptyState from '@/components/obligations/ObligationEmptyState';
import ObligationLoadingSkeleton from '@/components/obligations/ObligationLoadingSkeleton';
import ObligationErrorState from '@/components/obligations/ObligationErrorState';
import { computeKpis, effectiveStatus } from '@/components/obligations/statusUtils';
// Phase 7.1 Step 3 — modals and drawer wired to replace Step 2 placeholders.
import AddEditObligationModal from '@/components/obligations/AddEditObligationModal';
import MarkActionedModal from '@/components/obligations/MarkActionedModal';
import AssignUserModal from '@/components/obligations/AssignUserModal';
import ObligationDetailDrawer from '@/components/obligations/ObligationDetailDrawer';

interface ObligationsTabProps {
  contractId: string;
  /** Used to gate certain actions in future iterations (e.g. disabling
   *  manual entry for terminated contracts). Currently informational. */
  contractStatus: string;
  /** Project of the parent contract — needed to load assignable members.
   *  ContractDetailPage already holds the contract object, so passing
   *  this avoids a duplicate fetch. */
  projectId?: string;
  /**
   * Optional callback the parent (ContractDetailPage) provides so it
   * can mirror the obligation count next to the tab label. The count
   * updates whenever the React Query refetches.
   */
  onCountChange?: (count: number) => void;
}

/**
 * Obligations tab on the Contract Detail page. Composes:
 *   - 4-card KPI row (Total / Pending / Overdue / Actioned)
 *   - Filter bar (Type / Status / Assignee / Date range + Add button)
 *   - Card list with status badges, days-remaining traffic light, assignees
 *   - Empty / loading / error states
 *
 * Mutations done here:
 *   - "Mark as Actioned" → PATCH /contracts/:id/obligations/:obligationId
 *     { status: 'COMPLETED' }  via complianceService.updateObligation
 *   - "Delete" → DELETE /obligations/:id (APPROVER only — Phase 7.15)
 */
export default function ObligationsTab({
  contractId,
  contractStatus: _contractStatus, // reserved for Step 3
  projectId,
  onCountChange,
}: ObligationsTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ObligationFilters>({});

  // ── Permission gate (Phase 7.15) ────────────────────────────────
  // Edit  = EDITOR+  (SYSTEM_ADMIN, OWNER_ADMIN, PROJECT_MANAGER, REVIEWER
  //                   and project members with explicit EDITOR/APPROVER level)
  // Delete = APPROVER (SYSTEM_ADMIN, OWNER_ADMIN only in the frontend — we
  //                   cannot cheaply resolve a project member's effective
  //                   permission level without an extra API call)
  // Conservative approach: show Delete only for the two roles that bypass
  // the guard by design. APPROVER project-members can still delete via API.
  // Show Edit for all roles except VIEWER/COMMENTER defaults (REVIEWER and
  // above have at least EDITOR level by the JOB_TITLE_DEFAULT_PERMISSION map).
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

  // ── Load obligations for this contract ──────────────────────────
  const obligationsQuery = useQuery({
    queryKey: ['contract-obligations', contractId],
    queryFn: () => complianceService.listContractObligations(contractId),
    enabled: !!contractId,
  });

  // ── Load project members for the assignee filter ────────────────
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectService.getMembers(projectId!),
    enabled: !!projectId,
  });

  // ── Apply UI filters client-side ────────────────────────────────
  const filtered: ContractObligation[] = useMemo(() => {
    const all = obligationsQuery.data ?? [];
    return all.filter((o) => {
      if (filters.type && o.obligation_type !== filters.type) return false;
      if (filters.status) {
        if (effectiveStatus(o.status, o.due_date) !== filters.status) return false;
      }
      if (filters.from && o.due_date) {
        if (new Date(o.due_date) < new Date(filters.from)) return false;
      }
      if (filters.to && o.due_date) {
        if (new Date(o.due_date) > new Date(filters.to)) return false;
      }
      if (filters.assignee) {
        const aug = o as ObligationPortfolioItem;
        const has = (aug.assignees ?? []).some((a) => a.user_id === filters.assignee);
        if (!has) return false;
      }
      return true;
    });
  }, [obligationsQuery.data, filters]);

  const kpis = useMemo(
    () => computeKpis(obligationsQuery.data ?? []),
    [obligationsQuery.data],
  );

  useEffect(() => {
    onCountChange?.(obligationsQuery.data?.length ?? 0);
  }, [obligationsQuery.data?.length, onCountChange]);

  // ── Modal + drawer state (Phase 7.1 Step 3) ────────────────────
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editObligation, setEditObligation] = useState<ContractObligation | null>(null);
  const [actioningObligation, setActioningObligation] = useState<ContractObligation | null>(null);
  const [assigningObligation, setAssigningObligation] = useState<ContractObligation | null>(null);
  const [detailObligationId, setDetailObligationId] = useState<string | null>(null);

  // ── Delete state (Phase 7.15) ───────────────────────────────────
  const [deletingObligation, setDeletingObligation] = useState<ContractObligation | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const findObligation = (id: string): ContractObligation | null =>
    (obligationsQuery.data ?? []).find((o) => o.id === id) ?? null;

  const handleAdd = () => setAddModalOpen(true);
  const handleEdit = (id: string) => setEditObligation(findObligation(id));
  const handleAssign = (id: string) => setAssigningObligation(findObligation(id));
  const handleMarkActioned = (id: string) =>
    setActioningObligation(findObligation(id));
  const handleViewDetails = (id: string) => setDetailObligationId(id);
  const handleDelete = (id: string) => {
    setDeleteError(null);
    setDeletingObligation(findObligation(id));
  };

  const confirmDelete = async () => {
    if (!deletingObligation) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await obligationService.delete(deletingObligation.id);
      await queryClient.invalidateQueries({ queryKey: ['contract-obligations', contractId] });
      setDeletingObligation(null);
    } catch (err: any) {
      setDeleteError(
        err?.response?.data?.message ?? t('obligation.ui.errorTitle'),
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  const addButton = (
    <button
      onClick={handleAdd}
      className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
      {t('obligation.actions.add')}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <ObligationKpiRow counts={kpis} />

      {/* Filter bar */}
      <ObligationFilterBar
        variant="contract"
        filters={filters}
        onChange={setFilters}
        members={membersQuery.data ?? []}
        action={addButton}
      />

      {/* List / states */}
      {obligationsQuery.isError ? (
        <ObligationErrorState
          error={obligationsQuery.error}
          onRetry={() => obligationsQuery.refetch()}
        />
      ) : obligationsQuery.isLoading ? (
        <ObligationLoadingSkeleton />
      ) : kpis.total === 0 ? (
        <ObligationEmptyState onAdd={handleAdd} />
      ) : filtered.length === 0 ? (
        <ObligationEmptyState variant="no-matches" />
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <ObligationCard
              key={o.id}
              obligation={o as ObligationPortfolioItem}
              onMarkActioned={handleMarkActioned}
              onEdit={handleEdit}
              onAssign={handleAssign}
              onViewDetails={handleViewDetails}
              onDelete={canDelete ? handleDelete : undefined}
            />
          ))}
        </div>
      )}

      {/* ── Modals + drawer (Phase 7.1 Step 3) ─────────────────── */}
      <AddEditObligationModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        contractId={contractId}
      />
      <AddEditObligationModal
        isOpen={!!editObligation}
        onClose={() => setEditObligation(null)}
        contractId={contractId}
        obligation={editObligation}
      />
      <MarkActionedModal
        isOpen={!!actioningObligation}
        onClose={() => setActioningObligation(null)}
        contractId={contractId}
        obligation={actioningObligation}
      />
      <AssignUserModal
        isOpen={!!assigningObligation}
        onClose={() => setAssigningObligation(null)}
        contractId={contractId}
        projectId={projectId}
        obligation={assigningObligation as ObligationPortfolioItem | null}
      />
      <ObligationDetailDrawer
        isOpen={!!detailObligationId}
        onClose={() => setDetailObligationId(null)}
        obligationId={detailObligationId}
        contractId={contractId}
        onEdit={canEdit ? (o) => setEditObligation(o) : undefined}
        onMarkActioned={(o) => setActioningObligation(o)}
        onAssign={(o) => setAssigningObligation(o)}
      />

      {/* ── Delete confirmation dialog (Phase 7.15) ─────────────── */}
      {deletingObligation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => !deleteLoading && setDeletingObligation(null)} />
          <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">
              {t('obligation.deleteConfirm.title')}
            </h3>
            <p
              className="mt-2 text-sm text-gray-600"
              dir="auto"
              style={{ unicodeBidi: 'plaintext' }}
            >
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
