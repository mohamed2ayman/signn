import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  const qc = useQueryClient();
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

  // ── "Mark as Actioned" mutation ─────────────────────────────────
  // Uses the canonical PATCH /contracts/:id/obligations/:obligationId
  // endpoint (Phase 3.3, validated via UpdateObligationInlineDto).
  const markActioned = useMutation({
    mutationFn: (obligationId: string) =>
      complianceService.updateObligation(contractId, obligationId, {
        status: 'COMPLETED',
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['contract-obligations', contractId] }),
  });

  // ── Apply UI filters client-side ────────────────────────────────
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

  // ── Action handlers ─────────────────────────────────────────────
  // Step 3 will replace these console.info() calls with real modals.
  const handleAdd = () => {
    // eslint-disable-next-line no-console
    console.info('[ObligationsTab] Add obligation — modal in Step 3');
  };
  const handleEdit = (id: string) => {
    // eslint-disable-next-line no-console
    console.info('[ObligationsTab] Edit obligation — modal in Step 3', id);
  };
  const handleAssign = (id: string) => {
    // eslint-disable-next-line no-console
    console.info('[ObligationsTab] Assign obligation — modal in Step 3', id);
  };
  const handleViewDetails = (id: string) => {
    // eslint-disable-next-line no-console
    console.info('[ObligationsTab] View details — page in Step 4', id);
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
              onMarkActioned={(id) => markActioned.mutate(id)}
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
