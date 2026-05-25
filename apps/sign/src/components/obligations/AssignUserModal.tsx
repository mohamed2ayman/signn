import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { isAxiosError } from 'axios';
import complianceService from '@/services/api/complianceService';
import { projectService } from '@/services/api/projectService';
import type { ObligationPortfolioItem } from '@/services/api/obligationService';
import ModalShell from './ModalShell';

interface AssignUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  obligation: ObligationPortfolioItem | null;
  contractId: string;
  /** Project ID needed to fetch assignable members (the contract's project). */
  projectId?: string;
  onSuccess?: () => void;
}

/**
 * Manage the assignee list for a single obligation.
 *
 * - Current assignees rendered as removable chips along the top.
 * - Searchable team-member dropdown below to add new assignees.
 * - One assign/unassign per backend round-trip (the Step 1 backend
 *   exposes assign/unassign as separate operations — there is no
 *   "set assignees" bulk endpoint).
 * - Mutual exclusion: a user already in the assignee list does NOT
 *   appear in the picker dropdown.
 * - 409 Conflict from the backend (already-assigned) surfaces as an
 *   inline toast rather than crashing the UI.
 */
export default function AssignUserModal({
  isOpen,
  onClose,
  obligation,
  contractId,
  projectId,
  onSuccess,
}: AssignUserModalProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const membersQuery = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectService.getMembers(projectId!),
    enabled: !!projectId && isOpen,
  });

  const assigned = useMemo(
    () => obligation?.assignees ?? [],
    [obligation?.assignees],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['contract-obligations', contractId] });
    qc.invalidateQueries({ queryKey: ['portfolio-obligations'] });
    qc.invalidateQueries({ queryKey: ['obligation-detail'] });
    onSuccess?.();
  };

  const assignMutation = useMutation({
    mutationFn: (userId: string) =>
      complianceService.assignObligation(contractId, obligation!.id, userId),
    onSuccess: () => {
      toast.success(t('obligation.toast.userAssigned'));
      invalidate();
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.status === 409) {
        toast.error(t('obligation.modal.assign.alreadyAssigned'));
      } else {
        toast.error(t('obligation.toast.error'));
      }
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (userId: string) =>
      complianceService.unassignObligation(contractId, obligation!.id, userId),
    onSuccess: () => {
      toast.success(t('obligation.toast.userUnassigned'));
      invalidate();
    },
    onError: () => toast.error(t('obligation.toast.error')),
  });

  // Pool of users who can still be assigned: project members minus the
  // already-assigned set, optionally filtered by the search term.
  const assignable = useMemo(() => {
    const assignedIds = new Set(assigned.map((a) => a.user_id));
    const pool = (membersQuery.data ?? []).filter(
      (m) => m.user && !assignedIds.has(m.user_id),
    );
    if (!search.trim()) return pool;
    const q = search.trim().toLowerCase();
    return pool.filter((m) => {
      const name = `${m.user?.first_name ?? ''} ${m.user?.last_name ?? ''}`.toLowerCase();
      return name.includes(q) || (m.user?.email ?? '').toLowerCase().includes(q);
    });
  }, [membersQuery.data, assigned, search]);

  if (!obligation) return null;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={t('obligation.modal.assign.title')}
      subtitle={obligation.description}
      size="md"
      footer={
        <button
          onClick={onClose}
          className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('common.close')}
        </button>
      }
    >
      {/* Currently assigned — chip row */}
      <div className="mb-4">
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">
          {t('obligation.modal.detail.assignees')}
        </label>
        {assigned.length === 0 ? (
          <p className="text-sm text-gray-500">{t('obligation.ui.unassigned')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {assigned.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {a.user
                  ? `${a.user.first_name} ${a.user.last_name}`
                  : a.user_id}
                <button
                  onClick={() => unassignMutation.mutate(a.user_id)}
                  disabled={unassignMutation.isPending}
                  aria-label="Remove"
                  className="rounded-full p-0.5 hover:bg-primary/20 disabled:opacity-50"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Add new — searchable picker */}
      <div>
        <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-gray-500">
          {t('obligation.modal.assign.addUser')}
        </label>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('obligation.modal.assign.searchPlaceholder')}
          className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
        />

        {membersQuery.isLoading ? (
          <p className="py-3 text-center text-sm text-gray-500">{t('common.loading')}</p>
        ) : !projectId ? (
          <p className="py-3 text-center text-sm text-gray-500">
            {t('obligation.modal.assign.noUsers')}
          </p>
        ) : assignable.length === 0 ? (
          <p className="py-3 text-center text-sm text-gray-500">
            {t('obligation.modal.assign.noUsers')}
          </p>
        ) : (
          <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200">
            {assignable.map((m) => (
              <li key={m.user_id}>
                <button
                  type="button"
                  onClick={() => assignMutation.mutate(m.user_id)}
                  disabled={assignMutation.isPending}
                  className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                      {(m.user?.first_name?.[0] ?? '?').toUpperCase()}
                    </span>
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-gray-900">
                        {m.user?.first_name} {m.user?.last_name}
                      </span>
                      <span className="ml-2 text-xs text-gray-500">{m.user?.email}</span>
                    </span>
                  </span>
                  <span className="ml-2 flex-shrink-0 rounded-md bg-primary px-2 py-0.5 text-[11px] font-medium text-white">
                    {t('obligation.actions.assign')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}
