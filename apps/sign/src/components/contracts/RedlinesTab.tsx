import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

import redlineService, {
  NegotiationStatus,
  RedlineRow,
  RedlineStatus,
} from '@/services/api/redlineService';
import { ContractClause } from '@/types';
import ModalShell from '@/components/obligations/ModalShell';
import { DiffView, DiffViewData } from '@/components/versions/DiffView';

/**
 * 7.19 Slice 3 — the Redlines tab on ContractDetailPage.
 *
 * Renders the Slice-1 negotiation loop (propose / accept / reject / counter /
 * withdraw) + the Slice-2 negotiation lane. Role-aware:
 *   - isHost (caller's org == contract's project org): Accept / Reject /
 *     Counter on PROPOSED redlines + the negotiation actions (agree /
 *     ready-to-sign).
 *   - counterparty (bound viewer, NOT host): the Propose flow.
 *   - the redline's own author (API-provided is_author): Withdraw.
 * The author projection is the backend's SCRUBBED shape (display name +
 * TEAM/GUEST + is_author) — no emails/org ids exist client-side to leak.
 *
 * Diffs render via the SHARED <DiffView> (no fork): each redline's
 * word_level_diff is backend-computed by the same util as version compares.
 * RTL: clause/proposed text uses the established dir="auto" +
 * unicodeBidi:'plaintext' pattern; DiffView owns its own RTL handling.
 */

/** Coded-409 → readable message (exported for tests). */
export function redlineErrorMessage(
  err: unknown,
  t: (k: string) => string,
): string {
  const e = err as { response?: { status?: number; data?: { error?: string } } };
  switch (e?.response?.data?.error) {
    case 'STALE_REDLINE':
      return t('redlines.errors.stale');
    case 'CONTRACT_PINNED':
      return t('redlines.errors.pinned');
    case 'OPEN_REDLINES_EXIST':
      return t('redlines.errors.openRedlines');
    case 'REDLINE_NOT_PROPOSED':
      return t('redlines.errors.notProposed');
    case 'INVALID_NEGOTIATION_TRANSITION':
      return t('redlines.errors.invalidTransition');
    default:
      break;
  }
  if (e?.response?.status === 404) return t('redlines.errors.notFound');
  return t('redlines.errors.generic');
}

export const REDLINE_STATUS_BADGE: Record<RedlineStatus, string> = {
  PROPOSED: 'bg-blue-100 text-blue-700',
  ACCEPTED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  COUNTERED: 'bg-amber-100 text-amber-700',
  WITHDRAWN: 'bg-gray-100 text-gray-600',
  STALE: 'bg-orange-100 text-orange-700',
};

export const NEGOTIATION_BADGE: Record<NegotiationStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  SHARED: 'bg-blue-100 text-blue-700',
  UNDER_REVIEW: 'bg-amber-100 text-amber-700',
  AGREED: 'bg-emerald-100 text-emerald-700',
  READY_TO_SIGN: 'bg-violet-100 text-violet-700',
};

/** RTL-safe content style for clause/proposal text (house pattern). */
const bidiPlain = { unicodeBidi: 'plaintext' as const };

interface Props {
  contractId: string;
  /** LIVE contract_clauses (the page's clauses state) — propose picker + titles. */
  clauses: ContractClause[];
  /** Caller org == contract's project org (computed by the page). */
  isHost: boolean;
}

type ModalState =
  | { kind: 'propose' }
  | { kind: 'accept'; row: RedlineRow }
  | { kind: 'reject'; row: RedlineRow }
  | { kind: 'counter'; row: RedlineRow }
  | { kind: 'withdraw'; row: RedlineRow }
  | { kind: 'negotiation'; action: 'agree' | 'readyToSign' }
  | null;

export default function RedlinesTab({ contractId, clauses, isHost }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<ModalState>(null);
  const [diffRow, setDiffRow] = useState<RedlineRow | null>(null);

  const redlinesQuery = useQuery({
    queryKey: ['contract-redlines', contractId],
    queryFn: () => redlineService.list(contractId),
  });
  const negotiationQuery = useQuery({
    queryKey: ['contract-negotiation', contractId],
    queryFn: () => redlineService.getNegotiation(contractId),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['contract-redlines', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contract-negotiation', contractId] });
  };

  const clauseById = useMemo(() => {
    const m = new Map<string, ContractClause>();
    for (const cc of clauses) m.set(cc.id, cc);
    return m;
  }, [clauses]);

  const clauseLabel = (ccId: string): string => {
    const cc = clauseById.get(ccId);
    if (!cc) return t('redlines.unknownClause');
    const num = cc.section_number ? `§ ${cc.section_number} — ` : '';
    return `${num}${cc.clause?.title ?? ''}`.trim() || t('redlines.unknownClause');
  };

  /** Group by clause; groups ordered by their newest redline; rounds newest first. */
  const groups = useMemo(() => {
    const rows = redlinesQuery.data ?? [];
    const byClause = new Map<string, RedlineRow[]>();
    for (const r of rows) {
      // List is newest-first already; preserve that inside each group.
      const g = byClause.get(r.contract_clause_id) ?? [];
      g.push(r);
      byClause.set(r.contract_clause_id, g);
    }
    return [...byClause.entries()];
  }, [redlinesQuery.data]);

  const negotiationStatus = negotiationQuery.data?.negotiation_status;
  const locale = i18n.language;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white shadow-card">
      {/* ── Panel header: title + negotiation lane + actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900">{t('redlines.title')}</h3>
          {negotiationStatus && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${NEGOTIATION_BADGE[negotiationStatus]}`}
            >
              {t(`redlines.negotiation.${negotiationStatus}`)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isHost && negotiationStatus && (
            <>
              <button
                onClick={() => setModal({ kind: 'negotiation', action: 'agree' })}
                disabled={negotiationStatus !== 'UNDER_REVIEW'}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('redlines.negotiation.markAgreed')}
              </button>
              <button
                onClick={() => setModal({ kind: 'negotiation', action: 'readyToSign' })}
                disabled={negotiationStatus !== 'AGREED'}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('redlines.negotiation.readyToSign')}
              </button>
            </>
          )}
          {!isHost && (
            <button
              onClick={() => setModal({ kind: 'propose' })}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
            >
              {t('redlines.propose.button')}
            </button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-5 py-4">
        {redlinesQuery.isLoading && (
          <p className="py-8 text-center text-sm text-gray-500">{t('redlines.loading')}</p>
        )}
        {redlinesQuery.isError && (
          <p className="py-8 text-center text-sm text-red-600">
            {t('redlines.errors.loadFailed')}
          </p>
        )}
        {redlinesQuery.data && groups.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-gray-700">{t('redlines.empty.title')}</p>
            <p className="mt-1 text-xs text-gray-500">
              {isHost ? t('redlines.empty.host') : t('redlines.empty.counterparty')}
            </p>
          </div>
        )}

        <div className="space-y-6">
          {groups.map(([ccId, rows]) => (
            <div key={ccId}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500" dir="auto" style={bidiPlain}>
                {clauseLabel(ccId)}
              </p>
              <div className="space-y-3">
                {rows.map((row) => (
                  <RedlineCard
                    key={row.id}
                    row={row}
                    isHost={isHost}
                    locale={locale}
                    t={t}
                    onViewDiff={() => setDiffRow(row)}
                    onAccept={() => setModal({ kind: 'accept', row })}
                    onReject={() => setModal({ kind: 'reject', row })}
                    onCounter={() => setModal({ kind: 'counter', row })}
                    onWithdraw={() => setModal({ kind: 'withdraw', row })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Diff modal (shared DiffView — never forked) ── */}
      {diffRow && (
        <DiffView
          title={t('redlines.diff.title')}
          subtitle={clauseLabel(diffRow.contract_clause_id)}
          colLabelA={t('redlines.diff.current')}
          colLabelB={t('redlines.diff.proposed')}
          rtlIndicator={t('proposedDiff.rtlIndicator')}
          data={diffDataFor(diffRow, clauseLabel(diffRow.contract_clause_id))}
          onClose={() => setDiffRow(null)}
        />
      )}

      {/* ── Action modals ── */}
      {modal?.kind === 'propose' && (
        <ProposeModal
          contractId={contractId}
          clauses={clauses}
          onDone={() => {
            setModal(null);
            refresh();
          }}
          onClose={() => setModal(null)}
        />
      )}
      {(modal?.kind === 'accept' ||
        modal?.kind === 'reject' ||
        modal?.kind === 'counter' ||
        modal?.kind === 'withdraw') && (
        <DecisionModal
          contractId={contractId}
          kind={modal.kind}
          row={modal.row}
          clauseTitle={clauseLabel(modal.row.contract_clause_id)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'negotiation' && (
        <NegotiationConfirmModal
          contractId={contractId}
          action={modal.action}
          onDone={() => {
            setModal(null);
            refresh();
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

/**
 * Build the single-change DiffView payload from a redline row. MODIFIED is
 * decided by CONTENT inequality, not by word_level_diff presence — a backend
 * that predates the Slice-3 diff field (or a null diff) still renders the
 * full side-by-side texts, just without word-level highlights (DiffView
 * handles wordLevelDiff: null gracefully).
 */
function diffDataFor(row: RedlineRow, clauseTitle: string): DiffViewData {
  const modified = row.base_content_snapshot !== row.proposed_content;
  return {
    summary: {
      added: 0,
      removed: 0,
      modified: modified ? 1 : 0,
      unchanged: modified ? 0 : 1,
    },
    changes: [
      {
        clauseId: row.id,
        clauseNumber: null,
        clauseTitle,
        changeType: modified ? 'MODIFIED' : 'UNCHANGED',
        originalText: row.base_content_snapshot,
        newText: row.proposed_content,
        wordLevelDiff: row.word_level_diff ?? null,
      },
    ],
  };
}

/* ── Redline card ──────────────────────────────────────────────── */

function RedlineCard({
  row,
  isHost,
  locale,
  t,
  onViewDiff,
  onAccept,
  onReject,
  onCounter,
  onWithdraw,
}: {
  row: RedlineRow;
  isHost: boolean;
  locale: string;
  t: (k: string, o?: Record<string, unknown>) => string;
  onViewDiff: () => void;
  onAccept: () => void;
  onReject: () => void;
  onCounter: () => void;
  onWithdraw: () => void;
}) {
  const proposed = row.status === 'PROPOSED';
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${REDLINE_STATUS_BADGE[row.status]}`}
        >
          {t(`redlines.status.${row.status}`)}
        </span>
        <span className="text-xs text-gray-500">
          {t('redlines.round', { round: row.round })}
        </span>
        <span className="text-xs font-medium text-gray-700" dir="auto" style={bidiPlain}>
          {row.author_name}
        </span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
          {row.author_role === 'TEAM' ? t('redlines.role.team') : t('redlines.role.external')}
        </span>
        <span className="ms-auto text-xs text-gray-400" dir="ltr">
          {new Date(row.created_at).toLocaleString(locale)}
        </span>
      </div>

      <p
        className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-600"
        dir="auto"
        style={bidiPlain}
      >
        {row.proposed_content}
      </p>

      {row.note && (
        <p className="mt-2 text-xs text-gray-500" dir="auto" style={bidiPlain}>
          <span className="font-medium">{t('redlines.noteLabel')}: </span>
          {row.note}
        </p>
      )}
      {row.decision_note && (
        <p className="mt-1 text-xs text-gray-500" dir="auto" style={bidiPlain}>
          <span className="font-medium">{t('redlines.decisionNoteLabel')}: </span>
          {row.decision_note}
        </p>
      )}
      {row.status === 'STALE' && (
        <p className="mt-2 text-xs text-orange-700">{t('redlines.staleHint')}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onViewDiff}
          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('redlines.viewChanges')}
        </button>
        {proposed && isHost && (
          <>
            <button
              onClick={onAccept}
              className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-white hover:bg-primary-dark"
            >
              {t('redlines.actions.accept')}
            </button>
            <button
              onClick={onReject}
              className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              {t('redlines.actions.reject')}
            </button>
            <button
              onClick={onCounter}
              className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
            >
              {t('redlines.actions.counter')}
            </button>
          </>
        )}
        {proposed && row.is_author && (
          <button
            onClick={onWithdraw}
            className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            {t('redlines.actions.withdraw')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Propose modal (counterparty) ──────────────────────────────── */

function ProposeModal({
  contractId,
  clauses,
  onDone,
  onClose,
}: {
  contractId: string;
  clauses: ContractClause[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [ccId, setCcId] = useState<string>('');
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');

  const pick = (id: string) => {
    setCcId(id);
    const cc = clauses.find((c) => c.id === id);
    setContent(cc?.clause?.content ?? '');
  };

  const mutation = useMutation({
    mutationFn: () =>
      redlineService.propose(contractId, ccId, {
        proposedContent: content,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success(t('redlines.propose.success'));
      onDone();
    },
    onError: (err) => toast.error(redlineErrorMessage(err, t)),
  });

  return (
    <ModalShell
      isOpen
      onClose={mutation.isPending ? () => {} : onClose}
      title={t('redlines.propose.title')}
      subtitle={t('redlines.propose.subtitle')}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('redlines.cancel')}
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !ccId || !content.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {mutation.isPending ? t('redlines.submitting') : t('redlines.propose.submit')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {t('redlines.propose.clauseLabel')}
          </label>
          <select
            value={ccId}
            onChange={(e) => pick(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          >
            <option value="">{t('redlines.propose.clausePlaceholder')}</option>
            {clauses.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.section_number ? `§ ${cc.section_number} — ` : ''}
                {cc.clause?.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {t('redlines.propose.contentLabel')}
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            dir="auto"
            style={bidiPlain}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-primary focus:outline-none"
            placeholder={t('redlines.propose.contentPlaceholder')}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">
            {t('redlines.noteOptional')}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            dir="auto"
            style={bidiPlain}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>
      </div>
    </ModalShell>
  );
}

/* ── Accept / Reject / Counter / Withdraw modal ────────────────── */

function DecisionModal({
  contractId,
  kind,
  row,
  clauseTitle,
  onDone,
  onClose,
}: {
  contractId: string;
  kind: 'accept' | 'reject' | 'counter' | 'withdraw';
  row: RedlineRow;
  clauseTitle: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [editText, setEditText] = useState(kind === 'counter' ? row.proposed_content : '');
  const [useEdit, setUseEdit] = useState(false);
  const [note, setNote] = useState('');
  // Same-tick double-click guard on the irreversible confirms (lesson #238 —
  // acquire before mutate, ALWAYS release in onSettled so a deliberate retry
  // after failure re-fires).
  const inFlight = useRef(false);

  const mutation = useMutation({
    mutationFn: () => {
      if (kind === 'accept')
        return redlineService.accept(contractId, row.id, {
          editedContent: useEdit && editText.trim() ? editText : undefined,
          note: note.trim() || undefined,
        });
      if (kind === 'reject')
        return redlineService.reject(contractId, row.id, { note: note.trim() || undefined });
      if (kind === 'counter')
        return redlineService.counter(contractId, row.id, {
          proposedContent: editText,
          note: note.trim() || undefined,
        });
      return redlineService.withdraw(contractId, row.id);
    },
    onSuccess: () => {
      toast.success(t(`redlines.${kind}.success`));
      onDone();
    },
    onError: (err) => toast.error(redlineErrorMessage(err, t)),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const confirm = () => {
    if (inFlight.current || mutation.isPending) return;
    inFlight.current = true;
    mutation.mutate();
  };

  const disableSubmit =
    mutation.isPending ||
    (kind === 'counter' && !editText.trim()) ||
    (kind === 'accept' && useEdit && !editText.trim());

  return (
    <ModalShell
      isOpen
      onClose={mutation.isPending ? () => {} : onClose}
      title={t(`redlines.${kind}.title`)}
      subtitle={clauseTitle}
      size={kind === 'reject' || kind === 'withdraw' ? 'md' : 'lg'}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('redlines.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={disableSubmit}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              kind === 'reject'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-primary hover:bg-primary-dark'
            }`}
          >
            {mutation.isPending ? t('redlines.submitting') : t(`redlines.${kind}.confirm`)}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600">{t(`redlines.${kind}.body`)}</p>

        {/* The proposal under decision (RTL-safe). */}
        {kind !== 'counter' && (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="whitespace-pre-wrap text-sm text-gray-700" dir="auto" style={bidiPlain}>
              {row.proposed_content}
            </p>
          </div>
        )}

        {kind === 'accept' && (
          <div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-700">
              <input
                type="checkbox"
                checked={useEdit}
                onChange={(e) => {
                  setUseEdit(e.target.checked);
                  if (e.target.checked && !editText) setEditText(row.proposed_content);
                }}
              />
              {t('redlines.accept.editToggle')}
            </label>
            {useEdit && (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={8}
                dir="auto"
                style={bidiPlain}
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-primary focus:outline-none"
              />
            )}
          </div>
        )}

        {kind === 'counter' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              {t('redlines.counter.contentLabel')}
            </label>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={8}
              dir="auto"
              style={bidiPlain}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm leading-relaxed focus:border-primary focus:outline-none"
            />
          </div>
        )}

        {kind !== 'withdraw' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              {t('redlines.noteOptional')}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              dir="auto"
              style={bidiPlain}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        )}
      </div>
    </ModalShell>
  );
}

/* ── Negotiation confirm (host: agree / ready-to-sign) ─────────── */

function NegotiationConfirmModal({
  contractId,
  action,
  onDone,
  onClose,
}: {
  contractId: string;
  action: 'agree' | 'readyToSign';
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: () =>
      action === 'agree'
        ? redlineService.agree(contractId)
        : redlineService.readyToSign(contractId),
    onSuccess: () => {
      toast.success(t(`redlines.negotiation.${action}Success`));
      onDone();
    },
    onError: (err) => toast.error(redlineErrorMessage(err, t)),
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const confirm = () => {
    if (inFlight.current || mutation.isPending) return;
    inFlight.current = true;
    mutation.mutate();
  };

  return (
    <ModalShell
      isOpen
      onClose={mutation.isPending ? () => {} : onClose}
      title={t(`redlines.negotiation.${action}Title`)}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {t('redlines.cancel')}
          </button>
          <button
            onClick={confirm}
            disabled={mutation.isPending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {mutation.isPending ? t('redlines.submitting') : t(`redlines.negotiation.${action}Confirm`)}
          </button>
        </div>
      }
    >
      <p className="text-sm text-gray-600">{t(`redlines.negotiation.${action}Body`)}</p>
    </ModalShell>
  );
}
