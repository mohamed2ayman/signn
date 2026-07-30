import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import ModalShell from '@/components/obligations/ModalShell';
import playbookService, {
  type PlaybookPosition,
} from '@/services/api/playbookService';
import PlaybookPositionModal, {
  apiErrorMessage,
} from '@/components/playbook/PlaybookPositionModal';
import {
  RULE_TYPE_BADGE,
  SCOPE_BADGE,
  coverageOfStandardTypes,
  groupPositionsByFamily,
  positionClauseTypeLabel,
  renderPositionValue,
} from '@/components/playbook/playbookModel';

/** RTL-safe content style for org-authored text (house pattern). */
const bidiPlain = { unicodeBidi: 'plaintext' as const };

/**
 * 7.22 Slice 3 — the Contract Playbook manager, at /app/settings/playbook.
 *
 * OWNER_ADMIN-only. The route carries
 * `<ProtectedRoute allowedRoles={[UserRole.OWNER_ADMIN]}>` (the ERP-connections
 * and portfolio precedent) and the API carries `@Roles(UserRole.OWNER_ADMIN)`
 * — an EXACT-match membership check, not a hierarchy, so SYSTEM_ADMIN is
 * excluded from both by design.
 *
 * Positions authored here are ORG-scoped. Narrower PROJECT / CONTRACT overrides
 * are authored from a contract's Compliance tab and appear in this list with a
 * scope badge, read-only as to scope.
 */
export default function PlaybookPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PlaybookPosition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PlaybookPosition | null>(null);

  const query = useQuery({
    queryKey: ['playbook-positions'],
    queryFn: () => playbookService.list(),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => playbookService.remove(id),
    onSuccess: () => {
      toast.success(t('playbook.toast.deleted'));
      qc.invalidateQueries({ queryKey: ['playbook-positions'] });
      setConfirmDelete(null);
    },
    onError: (err: unknown) => toast.error(apiErrorMessage(err, t)),
  });

  const openAdd = () => {
    setEditing(null);
    setShowModal(true);
  };
  const openEdit = (p: PlaybookPosition) => {
    setEditing(p);
    setShowModal(true);
  };

  const positions = query.data ?? [];
  const groups = groupPositionsByFamily(positions);
  const coverage = coverageOfStandardTypes(positions);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-2">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('playbook.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('playbook.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-dark"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          {t('playbook.addPosition')}
        </button>
      </header>

      {/* Coverage summary */}
      {!query.isLoading && !query.isError && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                {t('playbook.coverage.headline', {
                  covered: coverage.covered,
                  total: coverage.total,
                })}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t('playbook.coverage.hint')}
              </p>
            </div>
            <div
              className="shrink-0 text-2xl font-bold text-primary"
              dir="ltr"
            >
              {coverage.covered}/{coverage.total}
            </div>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{
                width: `${Math.round((coverage.covered / coverage.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Body */}
      {query.isLoading && (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner />
        </div>
      )}

      {query.isError && (
        <div className="rounded-xl border border-red-100 bg-red-50/60 p-6 text-center">
          <p className="text-sm text-red-700">{t('playbook.errorLoading')}</p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            {t('playbook.retry')}
          </button>
        </div>
      )}

      {!query.isLoading && !query.isError && positions.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-gray-900">
            {t('playbook.empty.title')}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-gray-500">
            {t('playbook.empty.body')}
          </p>
          <button
            type="button"
            onClick={openAdd}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
          >
            {t('playbook.addPosition')}
          </button>
        </div>
      )}

      {/* Grouped list */}
      {groups.map((group) => (
        <section key={group.family} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            {t(`playbook.family.${group.family}`)}
          </h2>
          <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {group.positions.map((p) => (
              <PositionRow
                key={p.id}
                position={p}
                onEdit={() => openEdit(p)}
                onDelete={() => setConfirmDelete(p)}
              />
            ))}
          </div>
        </section>
      ))}

      <p className="pt-2 text-center text-xs text-gray-400">
        {t('playbook.footerNote')}
      </p>

      {showModal && (
        <PlaybookPositionModal
          position={editing}
          onClose={() => {
            setShowModal(false);
            setEditing(null);
          }}
        />
      )}

      {confirmDelete && (
        <ModalShell
          isOpen
          onClose={removeMutation.isPending ? () => {} : () => setConfirmDelete(null)}
          title={t('playbook.delete.title')}
          subtitle={positionClauseTypeLabel(confirmDelete, t)}
          size="sm"
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={removeMutation.isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('playbook.cancel')}
              </button>
              <button
                type="button"
                onClick={() => removeMutation.mutate(confirmDelete.id)}
                disabled={removeMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {removeMutation.isPending
                  ? t('playbook.deleting')
                  : t('playbook.delete.confirm')}
              </button>
            </div>
          }
        >
          <p className="text-sm text-gray-600">{t('playbook.delete.body')}</p>
        </ModalShell>
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function PositionRow({
  position,
  onEdit,
  onDelete,
}: {
  position: PlaybookPosition;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-sm font-semibold text-gray-900"
            dir="auto"
            style={bidiPlain}
          >
            {positionClauseTypeLabel(position, t)}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RULE_TYPE_BADGE[position.rule_type] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {t(`playbook.ruleType.${position.rule_type}`)}
          </span>
          {position.scope !== 'ORG' && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SCOPE_BADGE[position.scope] ?? 'bg-gray-100 text-gray-600'}`}
            >
              {t(`playbook.scope.${position.scope}`)}
            </span>
          )}
          {position.is_custom_clause_type && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
              {t('playbook.customBadge')}
            </span>
          )}
          {!position.is_active && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
              {t('playbook.inactiveBadge')}
            </span>
          )}
        </div>

        <p
          className="mt-1 text-sm text-gray-700"
          dir="auto"
          style={bidiPlain}
        >
          {renderPositionValue(position, t)}
        </p>

        {position.note && (
          <p
            className="mt-1 text-xs italic text-gray-500"
            dir="auto"
            style={bidiPlain}
          >
            {position.note}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('playbook.edit')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          {t('playbook.deleteAction')}
        </button>
      </div>
    </div>
  );
}
