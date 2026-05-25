import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import complianceService from '@/services/api/complianceService';
import { obligationService } from '@/services/api/obligationService';
import type {
  ContractObligation,
  ObligationStatus,
} from '@/services/api/complianceService';
import type { ObligationPortfolioItem } from '@/services/api/obligationService';
import ObligationStatusBadge from './ObligationStatusBadge';
import ObligationTypeBadge from './ObligationTypeBadge';
import {
  effectiveStatus,
  daysUntil,
  daysTone,
  DAYS_TONE_STYLES,
  tierKey,
} from './statusUtils';

interface ObligationDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  obligationId: string | null;
  contractId: string;
  /** If supplied, parent can open AddEdit / MarkActioned / Assign in
   *  response to footer button clicks. */
  onEdit?: (obligation: ContractObligation) => void;
  onMarkActioned?: (obligation: ContractObligation) => void;
  onAssign?: (obligation: ContractObligation) => void;
}

/**
 * Right-anchored slide-in drawer showing the full obligation record.
 *
 * Sections (in order):
 *   1. Description (full text, with dir="auto")
 *   2. Key Details (type, frequency, party, amount, dates)
 *   3. Assignees (list with avatars + Manage Assignees button)
 *   4. Evidence (URL link or "No evidence")
 *   5. Reminder History (placeholder — backend endpoint not yet shipped)
 *   6. Activity Timeline (simple vertical list of state transitions)
 *
 * Sticky header (badges + close), scrollable body, sticky footer
 * (Edit + Mark Actioned). Mobile: full-width drawer.
 *
 * "View Clause" back-link navigates to
 * `/app/contracts/:contractId#clause-:clauseId`. Browser scrolls to the
 * element with id=`clause-{id}` natively IF the Clauses tab is already
 * the default (it is — ContractDetailPage initialises `activeTab` to
 * 'clauses'). A future Step 4+ deep-link enhancement can also force
 * the tab to switch via a hash listener in ContractDetailPage.
 */
export default function ObligationDetailDrawer({
  isOpen,
  onClose,
  obligationId,
  contractId,
  onEdit,
  onMarkActioned,
  onAssign,
}: ObligationDetailDrawerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Single-obligation fetch via the legacy /obligations/:id endpoint.
  // The contract-scoped list endpoint can't return a single row.
  const detailQuery = useQuery({
    queryKey: ['obligation-detail', obligationId],
    queryFn: () => obligationService.getById(obligationId!),
    enabled: !!obligationId && isOpen,
  });

  // The legacy endpoint returns the older Obligation shape WITHOUT the
  // assignees relation. To get assignees we look the same id up from
  // the contract-obligations cache; if that misses we degrade to "no
  // assignees" (acceptable because Step 1 says assignees are optional).
  const contractListQuery = useQuery({
    queryKey: ['contract-obligations', contractId],
    queryFn: () => complianceService.listContractObligations(contractId),
    enabled: !!contractId && isOpen,
  });

  // Merge the two queries into one rich view-model the rest of the
  // drawer reads from. effectiveStatus computed up front.
  const obligation: ObligationPortfolioItem | null = useMemo(() => {
    const base = detailQuery.data as ContractObligation | undefined;
    if (!base) return null;
    const fromList = contractListQuery.data?.find((o) => o.id === base.id);
    return {
      ...base,
      assignees: (fromList as ObligationPortfolioItem | undefined)?.assignees,
    } as ObligationPortfolioItem;
  }, [detailQuery.data, contractListQuery.data]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const eff = obligation
    ? effectiveStatus(obligation.status, obligation.due_date)
    : null;
  const isActioned = eff === 'MET' || eff === 'COMPLETED';
  const days = obligation ? daysUntil(obligation.due_date) : null;
  const tone = daysTone(days);
  const tier = tierKey(days);

  const handleViewClause = () => {
    if (!obligation?.contract_clause_id) return;
    onClose();
    navigate(
      `/app/contracts/${contractId}#clause-${obligation.contract_clause_id}`,
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Overlay backdrop */}
      <div
        className="flex-1 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="flex w-full max-w-full flex-col bg-white shadow-xl sm:w-[480px]"
      >
        {/* ── Sticky header ────────────────────────────────────── */}
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="drawer-title" className="text-base font-semibold text-gray-900">
              {t('obligation.title')}
            </h2>
            {obligation && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <ObligationTypeBadge type={obligation.obligation_type} />
                {eff && <ObligationStatusBadge status={eff as ObligationStatus} />}
                {tier && (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${DAYS_TONE_STYLES[tone].text} ${DAYS_TONE_STYLES[tone].bg}`}
                  >
                    {tier === 'overdue'
                      ? t('obligation.tier.overdue', { days: Math.abs(days ?? 0) })
                      : t(`obligation.tier.${tier}`)}
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex-shrink-0 rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* ── Scrollable body ──────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {detailQuery.isLoading ? (
            <p className="py-12 text-center text-sm text-gray-500">
              {t('common.loading')}
            </p>
          ) : detailQuery.isError || !obligation ? (
            <p className="py-12 text-center text-sm text-red-600">
              {t('obligation.ui.errorTitle')}
            </p>
          ) : (
            <div className="space-y-6">
              {/* Section 1: Description + View Clause */}
              <Section>
                <p
                  className="text-sm text-gray-900"
                  dir="auto"
                  style={{ unicodeBidi: 'plaintext' }}
                >
                  {obligation.description}
                </p>
                {obligation.clause_ref && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                    <span className="font-medium">{obligation.clause_ref}</span>
                    {obligation.contract_clause_id && (
                      <button
                        onClick={handleViewClause}
                        className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-gray-50"
                      >
                        {t('obligation.modal.detail.viewClause')}
                      </button>
                    )}
                  </div>
                )}
              </Section>

              {/* Section 2: Key Details */}
              <Section title={t('obligation.modal.detail.keyDetails')}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Row label={t('obligation.form.dueDate')}>
                    {obligation.due_date
                      ? format(new Date(obligation.due_date), 'PPP')
                      : t('obligation.ui.noDueDate')}
                  </Row>
                  <Row label={t('common.status')}>
                    {eff && <ObligationStatusBadge status={eff as ObligationStatus} size="xs" />}
                  </Row>
                  <Row label={t('common.type')}>
                    {t(`obligation.type.${obligation.obligation_type}`)}
                  </Row>
                  {obligation.responsible_party && (
                    <Row label={t('obligation.form.responsibleParty')}>
                      <span dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                        {obligation.responsible_party}
                      </span>
                    </Row>
                  )}
                  {obligation.amount && (
                    <Row label={t('obligation.form.amount')}>
                      {Number(obligation.amount).toLocaleString()}{' '}
                      {obligation.currency ?? ''}
                    </Row>
                  )}
                  {obligation.timeframe_description && (
                    <Row label={t('obligation.form.timeframe')} full>
                      <span dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                        {obligation.timeframe_description}
                      </span>
                    </Row>
                  )}
                  <Row label={t('common.created')}>
                    {format(new Date(obligation.created_at), 'PPP')}
                  </Row>
                  {obligation.is_critical && (
                    <Row label={t('obligation.ui.critical')}>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                        ⚠ {t('common.yes')}
                      </span>
                    </Row>
                  )}
                </dl>
              </Section>

              {/* Section 3: Assignees */}
              <Section title={t('obligation.modal.detail.assignees')}>
                {!obligation.assignees || obligation.assignees.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('obligation.ui.unassigned')}</p>
                ) : (
                  <ul className="space-y-2">
                    {obligation.assignees.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-sm">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                          {(a.user?.first_name?.[0] ?? '?').toUpperCase()}
                        </span>
                        <span className="min-w-0 truncate">
                          {a.user
                            ? `${a.user.first_name} ${a.user.last_name}`
                            : a.user_id}
                          {a.user?.email && (
                            <span className="ml-2 text-xs text-gray-500">{a.user.email}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {onAssign && (
                  <button
                    onClick={() => onAssign(obligation)}
                    className="mt-3 text-xs font-medium text-primary hover:underline"
                  >
                    {t('obligation.modal.detail.manageAssignees')} →
                  </button>
                )}
              </Section>

              {/* Section 4: Evidence */}
              <Section title={t('obligation.modal.detail.evidence')}>
                {obligation.evidence_url ? (
                  <a
                    href={obligation.evidence_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                    </svg>
                    {t('common.view')}
                  </a>
                ) : (
                  <p className="text-sm text-gray-500">
                    {t('obligation.modal.detail.noEvidence')}
                  </p>
                )}
              </Section>

              {/* Section 5: Reminder history — backend endpoint deferred */}
              <Section title={t('obligation.modal.detail.reminderHistory')}>
                <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-xs italic text-gray-500">
                  {t('obligation.modal.detail.reminderHistoryDeferred')}
                </p>
              </Section>

              {/* Section 6: Activity timeline (derived from known fields) */}
              <Section title={t('obligation.modal.detail.activityTimeline')}>
                <ol className="space-y-3">
                  <TimelineItem
                    icon="dot"
                    label={t('obligation.modal.detail.created')}
                    at={obligation.created_at}
                  />
                  {obligation.completed_at && (
                    <TimelineItem
                      icon="check"
                      label={t('obligation.modal.detail.actioned')}
                      at={obligation.completed_at}
                    />
                  )}
                </ol>
              </Section>
            </div>
          )}
        </div>

        {/* ── Sticky footer ────────────────────────────────────── */}
        {obligation && (
          <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-gray-100 bg-white px-5 py-3 sm:flex-row sm:justify-end">
            {onEdit && (
              <button
                onClick={() => onEdit(obligation)}
                className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('obligation.actions.edit')}
              </button>
            )}
            {!isActioned && onMarkActioned && (
              <button
                onClick={() => onMarkActioned(obligation)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {t('obligation.actions.markActioned')}
              </button>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}

// ─── Section + Row + Timeline helpers ───────────────────────────────

function Section({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      {title && (
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

function Row({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'col-span-2' : undefined}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-900">{children}</dd>
    </div>
  );
}

function TimelineItem({
  icon,
  label,
  at,
}: {
  icon: 'dot' | 'check';
  label: string;
  at: string;
}) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span
        className={`mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
          icon === 'check' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
        }`}
      >
        {icon === 'check' ? (
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{format(new Date(at), 'PPp')}</p>
      </div>
    </li>
  );
}
