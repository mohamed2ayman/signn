import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import complianceService, {
  type ContractObligation,
} from '@/services/api/complianceService';
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
 *
 * Placeholder actions (Add / Assign / Edit / View Details) log to
 * console — modals come in Phase 7.1 Step 3.
 */
export default function ObligationsTab({
  contractId,
  contractStatus: _contractStatus, // reserved for Step 3
  projectId,
  onCountChange,
}: ObligationsTabProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ObligationFilters>({});

  // ── Load obligations for this contract ──────────────────────────
  // We always fetch the full list and apply UI filters client-side
  // for snappier filter UX. The backend can do server-side filtering
  // via query params too — see complianceService.listContractObligations
  // — but most contracts have <50 obligations, so client-side is fine.
  const obligationsQuery = useQuery({
    queryKey: ['contract-obligations', contractId],
    queryFn: () => complianceService.listContractObligations(contractId),
    enabled: !!contractId,
  });

  // ── Load project members for the assignee filter ────────────────
  // Project members carry user info via the ProjectMember.user relation.
  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectService.getMembers(projectId!),
    enabled: !!projectId,
  });

  // ── Apply UI filters client-side ────────────────────────────────
  // (Step 2's inline "Mark as Actioned" mutation was retired in Step 3 —
  // MarkActionedModal now owns the patch call so it can also take the
  // optional evidence URL + notes in one flow.)
  const filtered: ContractObligation[] = useMemo(() => {
    const all = obligationsQuery.data ?? [];
    return all.filter((o) => {
      if (filters.type && o.obligation_type !== filters.type) return false;
      if (filters.status) {
        // Match against EFFECTIVE status so "OVERDUE" picks up
        // past-due PENDING/IN_PROGRESS obligations the backend hasn't
        // flipped yet.
        if (effectiveStatus(o.status, o.due_date) !== filters.status) return false;
      }
      if (filters.from && o.due_date) {
        if (new Date(o.due_date) < new Date(filters.from)) return false;
      }
      if (filters.to && o.due_date) {
        if (new Date(o.due_date) > new Date(filters.to)) return false;
      }
      // assignee filter — applied only when the obligation carries
      // assignee metadata (contract-scope endpoint may not include it
      // yet; see ObligationPortfolioItem comment in obligationService).
      if (filters.assignee) {
        const aug = o as ObligationPortfolioItem;
        const has = (aug.assignees ?? []).some((a) => a.user_id === filters.assignee);
        if (!has) return false;
      }
      return true;
    });
  }, [obligationsQuery.data, filters]);

  // KPI counts use the FULL list (not the filtered one) so the
  // summary always reflects the whole contract regardless of filter
  // state. This matches established UX patterns elsewhere.
  const kpis = useMemo(
    () => computeKpis(obligationsQuery.data ?? []),
    [obligationsQuery.data],
  );

  // Notify parent of the count so the tab label badge can update.
  useEffect(() => {
    onCountChange?.(obligationsQuery.data?.length ?? 0);
  }, [obligationsQuery.data?.length, onCountChange]);

  // ── Modal + drawer state (Phase 7.1 Step 3) ────────────────────
  // Add modal has no obligation context. Edit / mark-actioned / assign
  // hold the target obligation so the modal can render its content.
  // Drawer holds an id (resolves the full record via React Query).
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editObligation, setEditObligation] = useState<ContractObligation | null>(null);
  const [actioningObligation, setActioningObligation] = useState<ContractObligation | null>(null);
  const [assigningObligation, setAssigningObligation] = useState<ContractObligation | null>(null);
  const [detailObligationId, setDetailObligationId] = useState<string | null>(null);

  const findObligation = (id: string): ContractObligation | null =>
    (obligationsQuery.data ?? []).find((o) => o.id === id) ?? null;

  const handleAdd = () => setAddModalOpen(true);
  const handleEdit = (id: string) => setEditObligation(findObligation(id));
  const handleAssign = (id: string) => setAssigningObligation(findObligation(id));
  const handleMarkActioned = (id: string) =>
    setActioningObligation(findObligation(id));
  const handleViewDetails = (id: string) => setDetailObligationId(id);

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
        onEdit={(o) => setEditObligation(o)}
        onMarkActioned={(o) => setActioningObligation(o)}
        onAssign={(o) => setAssigningObligation(o)}
      />
    </div>
  );
}

