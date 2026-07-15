import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { RiskAnalysis } from '@/types';
import { riskAnalysisService } from '@/services/api/riskAnalysisService';
import RiskCard from './RiskCard';
import { splitVisibleHidden, severityRank } from './riskVisibility';

/**
 * Risk-tab rework — STEP 5. The single home for risk + recommendations, listed
 * CLAUSE BY CLAUSE in the SAME order as the Clauses tab (the backend already
 * returns risks ordered by document priority → clause order — see
 * RiskAnalysisService.getByContract), grouped into collapsible per-document
 * sections (first expanded).
 *
 * Each clause block: clause number + title + text (truncate/expand) → the
 * clause's risks. Each risk: the level/category/status/description card
 * (RiskCard, recommendation hidden) → an editable RecommendationBlock with four
 * states (default / editing / merged / cancelled) + an AI "re-phrase clause"
 * action that proposes a new clause version and merges it via a confirm step.
 */

interface RiskAnalysisTabProps {
  /** The contract id — needed to load/persist per-clause swap overrides. */
  contractId: string;
  risks: RiskAnalysis[];
  /**
   * Map `contract_clause_id → display number`, built from the FULL ordered
   * clause list on the Clauses tab (buildClauseNumberMap). Lets each clause
   * heading here show the IDENTICAL number the Clauses tab shows — section_number
   * when present, otherwise its position in the shared ordering. Optional so the
   * component still renders (falling back to section_number) if it's absent.
   */
  clauseNumberById?: Record<string, string>;
  onAnnotate: (
    riskId: string,
    data: { risk_level?: string; risk_category?: string; recommendation?: string },
  ) => Promise<void>;
  /** Called after a rewrite is merged (clause changed) so the parent reloads. */
  onRephraseApplied: () => void;
}

/** Per-clause swap override map: { [contract_clause_id]: [visibleId, visibleId] }. */
type OverrideMap = Record<string, string[]>;

interface ClauseGroup {
  clauseKey: string;
  clauseNumber: string | null;
  clauseTitle: string;
  clauseContent: string;
  risks: RiskAnalysis[];
}
interface DocGroup {
  docKey: string;
  docLabel: string;
  clauses: ClauseGroup[];
}

/** Group the (already backend-ordered) risks by document → clause, preserving
 *  first-seen order so the sequence matches the Clauses tab exactly. The clause
 *  number is resolved from `clauseNumberById` (the Clauses-tab derivation over
 *  the FULL clause list) so the identical clause shows the identical number on
 *  both tabs; it falls back to the risk's own section_number when the map is
 *  absent or the clause isn't in it. */
function groupRisks(
  risks: RiskAnalysis[],
  clauseNumberById?: Record<string, string>,
): DocGroup[] {
  const docs: DocGroup[] = [];
  const docIndex = new Map<string, DocGroup>();
  const clauseIndex = new Map<string, ClauseGroup>();

  for (const r of risks) {
    const cc = r.contract_clause;
    const clause = cc?.clause;
    const doc = clause?.source_document ?? null;
    const docKey = doc?.id ?? cc?.clause_id ?? 'no-document';
    const docLabel =
      doc?.document_label || doc?.file_name || '';

    let dg = docIndex.get(docKey);
    if (!dg) {
      dg = { docKey, docLabel, clauses: [] };
      docIndex.set(docKey, dg);
      docs.push(dg);
    }

    const clauseKey = r.contract_clause_id ?? `no-clause-${r.id}`;
    let cg = clauseIndex.get(clauseKey);
    if (!cg) {
      cg = {
        clauseKey,
        clauseNumber: clauseNumberById?.[clauseKey] ?? cc?.section_number ?? null,
        clauseTitle: clause?.title ?? '',
        clauseContent: clause?.content ?? '',
        risks: [],
      };
      clauseIndex.set(clauseKey, cg);
      dg.clauses.push(cg);
    }
    cg.risks.push(r);
  }
  return docs;
}

/* ── Truncating clause text with expand ── */
function ClauseText({ content }: { content: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 320;
  const shown = expanded || !isLong ? content : content.slice(0, 320) + '…';
  return (
    <div>
      <p
        className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600"
        dir="auto"
        style={{ unicodeBidi: 'plaintext' }}
      >
        {shown}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-xs font-medium text-primary hover:underline"
        >
          {expanded
            ? t('riskTab.showLess', { defaultValue: 'Show less' })
            : t('riskTab.showMore', { defaultValue: 'Show more' })}
        </button>
      )}
    </div>
  );
}

/* ── Merge confirmation modal — original vs proposed ── */
function MergeConfirmModal({
  originalTitle,
  originalContent,
  proposedTitle,
  proposedContent,
  applying,
  onConfirm,
  onCancel,
}: {
  originalTitle: string;
  originalContent: string;
  proposedTitle: string;
  proposedContent: string;
  applying: boolean;
  onConfirm: (markHandled: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // TASK 3 (design 3a) — "mark risk as handled after merge", checked by default.
  const [markHandled, setMarkHandled] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applying) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [applying, onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="border-b border-gray-100 px-5 py-3">
          <h3 className="text-sm font-bold text-gray-900">
            {t('riskTab.mergeTitle', { defaultValue: 'Review & merge the re-phrased clause' })}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {t('riskTab.mergeSubtitle', {
              defaultValue:
                'The current clause will be replaced by the proposed version. The original is kept in version history.',
            })}
          </p>
        </div>
        <div className="grid flex-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <div className="mb-1 text-xs font-semibold text-gray-500">
              {t('riskTab.current', { defaultValue: 'Current' })}
            </div>
            <p className="text-xs font-semibold text-gray-700" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
              {originalTitle}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
              {originalContent}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="mb-1 text-xs font-semibold text-emerald-600">
              {t('riskTab.proposed', { defaultValue: 'Proposed' })}
            </div>
            <p className="text-xs font-semibold text-gray-700" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
              {proposedTitle}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
              {proposedContent}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={markHandled}
              onChange={(e) => setMarkHandled(e.target.checked)}
              disabled={applying}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <span dir="auto">
              {t('riskTab.markHandled', {
                defaultValue: 'Mark this risk as handled after merge',
              })}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={applying}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('riskTab.cancel', { defaultValue: 'Cancel' })}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(markHandled)}
              disabled={applying}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {applying
                ? t('riskTab.applying', { defaultValue: 'Applying…' })
                : t('riskTab.mergeApply', { defaultValue: 'Merge & Apply' })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Lightweight confirm dialog (FIX 2) — matches the PDF's dialog language:
      a small centered card, primary Confirm + quiet Cancel. NOT the full merge
      review screen (that stays exclusive to the clause merge). ── */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
        <h3 className="text-sm font-bold text-gray-900" dir="auto">{title}</h3>
        <p className="mt-1 text-sm text-gray-500" dir="auto">{body}</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type Proposed = {
  proposed_contract_clause_id: string;
  title: string;
  content: string;
  original_title: string;
  original_content: string;
};

/* ── The editable recommendation block (4 states) ── */
function RecommendationBlock({
  risk,
  onAnnotate,
  onRephraseApplied,
}: {
  risk: RiskAnalysis;
  onAnnotate: RiskAnalysisTabProps['onAnnotate'];
  onRephraseApplied: () => void;
}) {
  const { t } = useTranslation();

  // Hydrate an already-pending proposal from the loaded risk.
  const hydrated: Proposed | null =
    risk.proposed_contract_clause_id && risk.proposed_contract_clause?.clause
      ? {
          proposed_contract_clause_id: risk.proposed_contract_clause_id,
          title: risk.proposed_contract_clause.clause.title ?? '',
          content: risk.proposed_contract_clause.clause.content ?? '',
          original_title: risk.contract_clause?.clause?.title ?? '',
          original_content: risk.contract_clause?.clause?.content ?? '',
        }
      : null;

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(risk.recommendation ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false); // FIX 2 confirm dialog
  // TASK 2 (Option C) — editing the PROPOSED clause text (distinct from the
  // advice edit above). Persisted via editProposal so it survives reload.
  const [editingProposal, setEditingProposal] = useState(false);
  const [proposalText, setProposalText] = useState('');
  const [confirmProposal, setConfirmProposal] = useState(false);
  // TASK 4 — "view previous version" toggle on the merged state.
  const [showPrev, setShowPrev] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [proposed, setProposed] = useState<Proposed | null>(hydrated);
  const [showMerge, setShowMerge] = useState(false);
  const [applying, setApplying] = useState(false);
  // FIX 1 — the MERGED state is persistent: hydrate it from risk.merged_at so a
  // reload still shows the merged/updated indicator (and keeps the block
  // collapsed), not just the in-session merge.
  const [merged, setMerged] = useState(!!risk.merged_at);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStart = useRef(0);

  const canRephrase = !!risk.contract_clause_id;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Poll the rewrite job until terminal (cap ~90s).
  useEffect(() => {
    if (!jobId) return;
    pollStart.current = Date.now();
    setGenerating(true);
    setError('');
    pollRef.current = setInterval(async () => {
      if (Date.now() - pollStart.current > 90_000) {
        stopPolling();
        setGenerating(false);
        setError(t('riskTab.rephraseTimeout', { defaultValue: 'Re-phrase timed out. Try again.' }));
        return;
      }
      try {
        const res = await riskAnalysisService.pollRephrase(risk.id, jobId);
        if (res.status === 'completed' && res.proposed) {
          stopPolling();
          setGenerating(false);
          setProposed(res.proposed);
        } else if (res.status === 'failed') {
          stopPolling();
          setGenerating(false);
          setError(res.error || t('riskTab.rephraseFailed', { defaultValue: 'Re-phrase failed.' }));
        }
      } catch {
        stopPolling();
        setGenerating(false);
        setError(t('riskTab.rephraseFailed', { defaultValue: 'Re-phrase failed.' }));
      }
    }, 1500);
    return stopPolling;
  }, [jobId, risk.id, stopPolling, t]);

  const saveEdit = async () => {
    setSaving(true);
    setError('');
    try {
      await onAnnotate(risk.id, { recommendation: editText });
      setConfirmSave(false);
      setEditing(false);
    } catch {
      setError(t('riskTab.saveFailed', { defaultValue: 'Failed to save' }));
    } finally {
      setSaving(false);
    }
  };

  const startRephrase = async () => {
    setError('');
    try {
      const { job_id } = await riskAnalysisService.startRephrase(risk.id);
      setJobId(job_id);
    } catch {
      setError(t('riskTab.rephraseFailed', { defaultValue: 'Re-phrase failed.' }));
    }
  };

  const confirmMerge = async (markHandled: boolean) => {
    setApplying(true);
    try {
      await riskAnalysisService.applyRephrase(risk.id, 'accept', markHandled);
      setShowMerge(false);
      setProposed(null);
      setMerged(true);
      onRephraseApplied();
    } catch {
      setError(t('riskTab.mergeFailed', { defaultValue: 'Merge failed.' }));
    } finally {
      setApplying(false);
    }
  };

  // TASK 2 — persist an edit to the PROPOSED clause text (Option C).
  const saveProposalEdit = async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await riskAnalysisService.editProposal(risk.id, {
        content: proposalText,
      });
      setProposed((p) => (p ? { ...p, content: updated.content, title: updated.title } : p));
      setConfirmProposal(false);
      setEditingProposal(false);
    } catch {
      setError(t('riskTab.saveFailed', { defaultValue: 'Failed to save' }));
    } finally {
      setSaving(false);
    }
  };

  // Cancel a proposal — the recommendation stays IN PLACE, unchanged (CANCELLED).
  const discardProposal = async () => {
    const keep = proposed;
    setProposed(null);
    try {
      await riskAnalysisService.applyRephrase(risk.id, 'reject');
    } catch {
      setProposed(keep); // restore on failure
      setError(t('riskTab.cancelFailed', { defaultValue: 'Could not discard the proposal.' }));
    }
  };

  // MERGED — persistent "updated" state (hydrated from merged_at). Shows the
  // green "Updated · v{n}" badge (TASK 4) + a read-only "view previous version"
  // toggle (the parent clause via the parent chain). The recommendation area
  // stays collapsed.
  if (merged) {
    const liveClause = risk.contract_clause?.clause;
    const version = liveClause?.version;
    const prevContent = liveClause?.parent_clause?.content ?? null;
    return (
      <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {t('riskTab.updatedVersion', { defaultValue: 'Updated', })}
            {version != null && ` · v${version}`}
          </span>
          <span className="text-xs font-medium text-emerald-700">
            {t('riskTab.clauseUpdated', { defaultValue: 'Clause updated with the re-phrased version.' })}
          </span>
          {prevContent && (
            <button
              type="button"
              onClick={() => setShowPrev((s) => !s)}
              className="text-xs font-medium text-primary hover:underline"
            >
              {showPrev
                ? t('riskTab.hidePrevious', { defaultValue: 'Hide previous version' })
                : t('riskTab.viewPrevious', { defaultValue: 'View previous version' })}
            </button>
          )}
        </div>
        {showPrev && prevContent && (
          <div className="mt-2 rounded-md border border-gray-200 bg-white/70 p-2">
            <div className="mb-1 text-[11px] font-semibold text-gray-500">
              {t('riskTab.previousVersion', { defaultValue: 'Previous version' })}
            </div>
            <p
              className="whitespace-pre-wrap text-xs text-gray-600"
              dir="auto"
              style={{ unicodeBidi: 'plaintext' }}
            >
              {prevContent}
            </p>
          </div>
        )}
      </div>
    );
  }

  const hasRec = !!(risk.recommendation && risk.recommendation.trim());

  return (
    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
      <div className="mb-1.5 flex items-center gap-1.5">
        <svg className="h-3.5 w-3.5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
        </svg>
        <span className="text-xs font-semibold text-blue-700">
          {t('riskTab.recommendation', { defaultValue: 'AI Recommendation' })}
        </span>
        {risk.is_edited_by_user && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
            {t('riskTab.edited', { defaultValue: 'edited' })}
          </span>
        )}
      </div>

      {/* EDITING state */}
      {editing ? (
        <div>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={4}
            dir="auto"
            style={{ unicodeBidi: 'plaintext' }}
            className="w-full rounded-md border border-blue-200 bg-white p-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
            placeholder={t('riskTab.recommendationPlaceholder', { defaultValue: 'Recommendation…' })}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmSave(true)}
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {saving
                ? t('riskTab.saving', { defaultValue: 'Saving…' })
                : t('riskTab.apply', { defaultValue: 'Apply' })}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditText(risk.recommendation ?? '');
                setEditing(false);
                setError('');
              }}
              disabled={saving}
              className="rounded-md px-3 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
            >
              {t('riskTab.cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
          {/* FIX 2 — confirm before saving a recommendation edit. Confirm →
              PATCH (snapshot-once unchanged); Cancel → stay in editing. */}
          {confirmSave && (
            <ConfirmDialog
              title={t('riskTab.confirmSaveTitle', { defaultValue: 'Save changes to this recommendation?' })}
              body={t('riskTab.confirmSaveBody', {
                defaultValue: 'Your edit replaces the current recommendation text.',
              })}
              confirmLabel={
                saving
                  ? t('riskTab.saving', { defaultValue: 'Saving…' })
                  : t('riskTab.confirm', { defaultValue: 'Confirm' })
              }
              cancelLabel={t('riskTab.cancel', { defaultValue: 'Cancel' })}
              busy={saving}
              onConfirm={saveEdit}
              onCancel={() => setConfirmSave(false)}
            />
          )}
        </div>
      ) : (
        <>
          {/* DEFAULT state */}
          {hasRec ? (
            <p className="text-sm text-blue-600" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
              {risk.recommendation}
            </p>
          ) : (
            <p className="text-sm italic text-gray-400">
              {t('riskTab.noRecommendation', { defaultValue: 'No recommendation yet.' })}
            </p>
          )}
          {/* Advice-level actions only when there is NO proposal yet. Once a
              proposal exists the block is proposal-centric (Merge/Edit/Cancel
              on the proposal below), per the design. */}
          {!proposed && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditText(risk.recommendation ?? '');
                  setEditing(true);
                }}
                className="rounded-md border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-100"
              >
                {t('riskTab.edit', { defaultValue: 'Edit' })}
              </button>
              {canRephrase && (
                <button
                  type="button"
                  onClick={startRephrase}
                  disabled={generating}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-50"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  {generating
                    ? t('riskTab.rephrasing', { defaultValue: 'Re-phrasing…' })
                    : t('riskTab.rephrase', { defaultValue: 'Re-phrase clause (AI)' })}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Proposed replacement panel (tinted) — persisted + shown up-front on
          load (Option C). Merge / Edit / Cancel. Edit edits the PROPOSED
          clause text (TASK 2), persisted via editProposal + FIX-2 confirm. */}
      {proposed && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="mb-1 text-xs font-semibold text-emerald-700">
            {t('riskTab.proposedReplacement', { defaultValue: 'Proposed replacement clause' })}
          </div>
          {editingProposal ? (
            <div>
              <textarea
                value={proposalText}
                onChange={(e) => setProposalText(e.target.value)}
                rows={6}
                dir="auto"
                style={{ unicodeBidi: 'plaintext' }}
                className="w-full rounded-md border border-emerald-200 bg-white p-2 text-sm text-gray-700 focus:border-emerald-400 focus:outline-none"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmProposal(true)}
                  disabled={saving}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving
                    ? t('riskTab.saving', { defaultValue: 'Saving…' })
                    : t('riskTab.apply', { defaultValue: 'Apply' })}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingProposal(false);
                    setError('');
                  }}
                  disabled={saving}
                  className="rounded-md px-3 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                >
                  {t('riskTab.cancel', { defaultValue: 'Cancel' })}
                </button>
              </div>
              {confirmProposal && (
                <ConfirmDialog
                  title={t('riskTab.confirmProposalTitle', { defaultValue: 'Save changes to the proposed clause?' })}
                  body={t('riskTab.confirmProposalBody', {
                    defaultValue: 'Your edit becomes the version that will be merged.',
                  })}
                  confirmLabel={
                    saving
                      ? t('riskTab.saving', { defaultValue: 'Saving…' })
                      : t('riskTab.confirm', { defaultValue: 'Confirm' })
                  }
                  cancelLabel={t('riskTab.cancel', { defaultValue: 'Cancel' })}
                  busy={saving}
                  onConfirm={saveProposalEdit}
                  onCancel={() => setConfirmProposal(false)}
                />
              )}
            </div>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm text-gray-700" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                {proposed.content}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowMerge(true)}
                  className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary/90"
                >
                  {t('riskTab.merge', { defaultValue: 'Merge' })}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProposalText(proposed.content);
                    setEditingProposal(true);
                  }}
                  className="rounded-md border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                >
                  {t('riskTab.edit', { defaultValue: 'Edit' })}
                </button>
                <button
                  type="button"
                  onClick={discardProposal}
                  className="rounded-md px-3 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
                >
                  {t('riskTab.cancel', { defaultValue: 'Cancel' })}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {showMerge && proposed && (
        <MergeConfirmModal
          originalTitle={proposed.original_title}
          originalContent={proposed.original_content}
          proposedTitle={proposed.title}
          proposedContent={proposed.content}
          applying={applying}
          onConfirm={confirmMerge}
          onCancel={() => setShowMerge(false)}
        />
      )}
    </div>
  );
}

/* ── One risk card (card + editable recommendation) ── */
function RiskRow({
  risk,
  onAnnotate,
  onRephraseApplied,
}: {
  risk: RiskAnalysis;
  onAnnotate: RiskAnalysisTabProps['onAnnotate'];
  onRephraseApplied: () => void;
}) {
  return (
    <div>
      <RiskCard risk={risk} onAnnotate={onAnnotate} hideRecommendation />
      <RecommendationBlock
        risk={risk}
        onAnnotate={onAnnotate}
        onRephraseApplied={onRephraseApplied}
      />
    </div>
  );
}

/* ── Per-clause risks: top-2 visible + "Show more (N)" + swap ──
   Clutter reduction: only the top-2 (severity + distinct) show by default; the
   rest collapse under a per-session toggle. In the expanded list, "Show in top"
   promotes a hidden risk (auto-replacing the LOWER-severity of the 2 visible) —
   a DISPLAY/selection choice persisted per clause (never mutates risk data). */
function ClauseRisks({
  clauseId,
  risks,
  override,
  onSwap,
  onAnnotate,
  onRephraseApplied,
}: {
  clauseId: string;
  risks: RiskAnalysis[];
  override: string[] | null;
  onSwap: (clauseId: string, visibleIds: string[]) => void;
  onAnnotate: RiskAnalysisTabProps['onAnnotate'];
  onRephraseApplied: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false); // per-session; collapsed by default

  const { visible, hidden, visibleIds } = useMemo(
    () => splitVisibleHidden(risks, override),
    [risks, override],
  );

  const promote = (hiddenId: string) => {
    if (visibleIds.length < 2) {
      onSwap(clauseId, [...visibleIds, hiddenId].slice(0, 2));
      return;
    }
    // Keep the higher-severity visible; replace the lower (tie → replace 2nd).
    const [a, b] = visible;
    const keepId = severityRank(a.risk_level) >= severityRank(b.risk_level) ? a.id : b.id;
    onSwap(clauseId, [keepId, hiddenId]);
  };

  return (
    <div className="space-y-3 p-4">
      {visible.map((risk) => (
        <RiskRow
          key={risk.id}
          risk={risk}
          onAnnotate={onAnnotate}
          onRephraseApplied={onRephraseApplied}
        />
      ))}

      {hidden.length > 0 && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            {expanded
              ? t('riskTab.showLess', { defaultValue: 'Show less' })
              : `${t('riskTab.showMore', { defaultValue: 'Show more' })} (${hidden.length})`}
          </button>

          {expanded &&
            hidden.map((risk) => (
              <div
                key={risk.id}
                className="rounded-lg border border-dashed border-gray-200 bg-gray-50/40 p-2"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] italic text-gray-400">
                    {t('riskTab.hiddenRisk', { defaultValue: 'Hidden — not in the top 2' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => promote(risk.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-primary/30 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                    title={t('riskTab.showInTopHint', {
                      defaultValue: 'Promote into the visible top 2 (replaces the lower-severity one)',
                    })}
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                    {t('riskTab.showInTop', { defaultValue: 'Show in top' })}
                  </button>
                </div>
                <RiskRow
                  risk={risk}
                  onAnnotate={onAnnotate}
                  onRephraseApplied={onRephraseApplied}
                />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/* ── Collapsible per-document section ── */
function DocumentSection({
  group,
  defaultOpen,
  overrides,
  onSwap,
  onAnnotate,
  onRephraseApplied,
}: {
  group: DocGroup;
  defaultOpen: boolean;
  overrides: OverrideMap;
  onSwap: (clauseId: string, visibleIds: string[]) => void;
  onAnnotate: RiskAnalysisTabProps['onAnnotate'];
  onRephraseApplied: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const riskCount = group.clauses.reduce((n, c) => n + c.risks.length, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 bg-gray-50/70 px-4 py-3 text-start hover:bg-gray-100/70"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-90' : ''} rtl:-scale-x-100`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-semibold text-gray-800" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
            {group.docLabel || t('riskTab.document', { defaultValue: 'Document' })}
          </span>
        </div>
        <span className="rounded-full bg-gray-200/70 px-2 py-0.5 text-xs font-medium text-gray-600">
          {t('riskTab.riskCount', { defaultValue: '{{count}} risks', count: riskCount })}
        </span>
      </button>

      {open && (
        <div className="space-y-4 p-4">
          {group.clauses.map((cg) => (
            <div key={cg.clauseKey} className="rounded-lg border border-gray-100 bg-white">
              <div className="border-b border-gray-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className="flex h-6 min-w-6 items-center justify-center rounded bg-primary/8 px-1.5 text-xs font-bold text-primary"
                    dir="auto"
                    style={{ unicodeBidi: 'plaintext' }}
                  >
                    {cg.clauseNumber || '—'}
                  </span>
                  <h4 className="text-sm font-semibold text-gray-900" dir="auto" style={{ unicodeBidi: 'plaintext' }}>
                    {cg.clauseTitle}
                  </h4>
                </div>
                <div className="mt-2">
                  <ClauseText content={cg.clauseContent} />
                </div>
              </div>
              <ClauseRisks
                clauseId={cg.clauseKey}
                risks={cg.risks}
                override={overrides[cg.clauseKey] ?? null}
                onSwap={onSwap}
                onAnnotate={onAnnotate}
                onRephraseApplied={onRephraseApplied}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RiskAnalysisTab({
  contractId,
  risks,
  clauseNumberById,
  onAnnotate,
  onRephraseApplied,
}: RiskAnalysisTabProps) {
  const groups = useMemo(
    () => groupRisks(risks, clauseNumberById),
    [risks, clauseNumberById],
  );

  // Per-clause swap overrides (which 2 risks are visible). Loaded once; a swap
  // updates it optimistically and persists via the backend (survives reload).
  const [overrides, setOverrides] = useState<OverrideMap>({});
  useEffect(() => {
    let cancelled = false;
    riskAnalysisService
      .getVisibility(contractId)
      .then((m) => { if (!cancelled) setOverrides(m || {}); })
      .catch(() => { /* no overrides → defaults apply */ });
    return () => { cancelled = true; };
  }, [contractId]);

  const handleSwap = useCallback(
    async (clauseId: string, visibleIds: string[]) => {
      const prev = overrides[clauseId];
      setOverrides((o) => ({ ...o, [clauseId]: visibleIds })); // optimistic
      try {
        await riskAnalysisService.setVisibility(clauseId, visibleIds);
      } catch {
        setOverrides((o) => {
          const n = { ...o };
          if (prev) n[clauseId] = prev;
          else delete n[clauseId];
          return n;
        });
      }
    },
    [overrides],
  );

  return (
    <div className="space-y-4">
      {groups.map((g, i) => (
        <DocumentSection
          key={g.docKey}
          group={g}
          defaultOpen={i === 0}
          overrides={overrides}
          onSwap={handleSwap}
          onAnnotate={onAnnotate}
          onRephraseApplied={onRephraseApplied}
        />
      ))}
    </div>
  );
}
