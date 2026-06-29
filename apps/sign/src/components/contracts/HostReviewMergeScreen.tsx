import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { documentProcessingService } from '@/services/api/documentProcessingService';
import { contractService } from '@/services/api/contractService';
import type { ApplyProposedVersionResult, DocumentUpload } from '@/types';
import {
  buildReviewModel,
  buildApplyDto,
  tallyDecisions,
  categoryMeta,
  type ReviewItem,
  type ReviewKind,
  type ReviewModel,
  type ReviewStatus,
  type UnchangedItem,
} from './hostReviewModel';

/**
 * Guest version review — Sub-slice 2c. The host's full review & merge screen.
 * A full-viewport takeover (the design's standalone screen, rendered as a fixed
 * overlay so it needs no route): header → counts strip → left clause rail +
 * diff pane → review-complete summary → two-step apply confirmation.
 *
 * Wires real data: 2b compare (diff) + getProposedClauses (proposed junction
 * ids + confidence) + getClauses (live junction ids), bridged to the 2a apply
 * DTO by hostReviewModel. Reuses the 2c whole-word diff coalesce. Arabic clause
 * content is RTL + bidi-isolated; the chrome follows the app locale (i18n).
 */
interface Props {
  contractId: string;
  doc: DocumentUpload;
  onClose: () => void;
  /** Called once the host successfully applies — lets the panel refetch. */
  onApplied?: () => void;
}

// ── design palette ───────────────────────────────────────────────────────────
const C = {
  page: '#EEF0F3',
  surface: '#fff',
  border: '#E4E8EE',
  ink: '#161A20',
  ink2: '#2A2F37',
  muted: '#5A636F',
  muted2: '#8A93A0',
  muted3: '#A8B0BB',
  primary: '#0D6EFD',
  primaryDk: '#0A58CA',
  primaryBg: '#E8F0FE',
  accept: '#15A05A',
  acceptDk: '#128A4D',
  acceptInk: '#0E7A43',
  acceptBg: '#E6F6EE',
  reject: '#9AA3AE',
  rejectInk: '#6B7480',
  rejectBg: '#EDEFF2',
  pendingAccent: '#C8861A',
  pendingBg: '#FBF1DF',
  pendingInk: '#9A6207',
  addBg: '#D9F2E2',
  addInk: '#0B6E3B',
  delBg: '#FBDCE0',
  delInk: '#A81F2C',
};

const ARABIC = /[؀-ۿ]/;

const statusMeta = (s: ReviewStatus) =>
  ({
    pending: { accent: C.pendingAccent, bg: C.pendingBg, ink: C.pendingInk },
    accepted: { accent: C.accept, bg: C.acceptBg, ink: C.acceptInk },
    rejected: { accent: C.reject, bg: C.rejectBg, ink: C.rejectInk },
    merged: { accent: C.primary, bg: C.primaryBg, ink: C.primaryDk },
  })[s];

const kindMeta = (k: ReviewKind) =>
  ({
    modify: { badgeBg: '#FFF3E0', badgeInk: '#9A6207', arrow: '→', arrowColor: C.primary },
    remove: { badgeBg: '#FBE3E6', badgeInk: '#A81F2C', arrow: '−', arrowColor: '#A81F2C' },
    add: { badgeBg: '#DEF3E6', badgeInk: '#0B6E3B', arrow: '＋', arrowColor: '#0B6E3B' },
  })[k];

const confStyle = (pct: number): CSSProperties => {
  const base: CSSProperties = {
    padding: '2px 9px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.4,
  };
  if (pct >= 90) return { ...base, background: C.acceptBg, color: C.acceptInk };
  if (pct >= 80) return { ...base, background: '#EAF1FF', color: C.primaryDk };
  return { ...base, background: C.pendingBg, color: C.pendingInk };
};

const BRICOLAGE = "'Bricolage Grotesque', system-ui, sans-serif";
const arabicStack = "'IBM Plex Sans Arabic', 'Cairo', system-ui, sans-serif";
const arStyle = (extra?: CSSProperties): CSSProperties => ({
  fontFamily: arabicStack,
  unicodeBidi: 'plaintext',
  ...extra,
});

// diff token styles
const ADD_TOK: CSSProperties = { background: C.addBg, color: C.addInk, borderRadius: 4, padding: '1px 4px', fontWeight: 700, unicodeBidi: 'isolate' };
const DEL_TOK: CSSProperties = { background: C.delBg, color: C.delInk, borderRadius: 4, padding: '1px 4px', textDecoration: 'line-through', textDecorationColor: 'rgba(168,31,44,.55)', unicodeBidi: 'isolate' };
const WHOLE_ADD: CSSProperties = { background: C.addBg, color: C.addInk, borderRadius: 6, padding: '3px 7px', fontWeight: 600, WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone', lineHeight: 2.2 };
const WHOLE_DEL: CSSProperties = { background: C.delBg, color: C.delInk, borderRadius: 6, padding: '3px 7px', textDecoration: 'line-through', textDecorationColor: 'rgba(168,31,44,.4)', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone', lineHeight: 2.2 };

export default function HostReviewMergeScreen({ contractId, doc, onClose, onApplied }: Props) {
  const { t } = useTranslation();

  const [model, setModel] = useState<ReviewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ReviewStatus>>({});
  const [mergedText, setMergedText] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'changed' | 'all'>('changed');
  const [unchangedOpen, setUnchangedOpen] = useState(false);
  const [view, setView] = useState<'clause' | 'complete'>('clause');
  const [merging, setMerging] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<ApplyProposedVersionResult | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ── load: compare + proposed + live, then build the model ──
  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      documentProcessingService.compareProposedVersion(contractId, doc.id),
      documentProcessingService.getProposedClauses(contractId, doc.id),
      contractService.getClauses(contractId),
    ])
      .then(([diff, proposed, live]) => {
        if (cancelled) return;
        const m = buildReviewModel(diff.changes, proposed, live);
        setModel(m);
        setSelectedId(m.changed[0]?.id ?? m.unchanged[0]?.id ?? null);
      })
      .catch(() => !cancelled && setError(t('hostReview.errorLoad')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [contractId, doc.id, t]);

  useEffect(() => load(), [load]);

  // lock body scroll while the takeover is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const changed = model?.changed ?? [];
  const unchanged = model?.unchanged ?? [];
  const selById = useCallback(
    (id: string | null): ReviewItem | UnchangedItem | null =>
      changed.find((c) => c.id === id) || unchanged.find((u) => u.id === id) || null,
    [changed, unchanged],
  );
  const isChanged = useCallback((id: string) => changed.some((c) => c.id === id), [changed]);

  const reviewed = changed.filter((c) => (statuses[c.id] ?? 'pending') !== 'pending').length;
  const total = changed.length;
  const allReviewed = total > 0 && reviewed === total;
  const tally = tallyDecisions(changed, statuses);

  // ── actions ──
  const advance = useCallback(
    (next: Record<string, ReviewStatus>) => {
      const done = changed.filter((c) => (next[c.id] ?? 'pending') !== 'pending').length;
      if (total > 0 && done === total) {
        setView('complete');
        return;
      }
      const nextPending = changed.find((c) => (next[c.id] ?? 'pending') === 'pending');
      if (nextPending) setSelectedId(nextPending.id);
    },
    [changed, total],
  );

  const setStatus = useCallback(
    (id: string, status: ReviewStatus) => {
      setMerging(false);
      setStatuses((s) => {
        const next = { ...s, [id]: status };
        advance(next);
        return next;
      });
    },
    [advance],
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setView('clause');
    setMerging(false);
  }, []);

  const acceptAll = useCallback(() => {
    const next: Record<string, ReviewStatus> = { ...statuses };
    changed.forEach((c) => (next[c.id] = 'accepted'));
    setStatuses(next);
    setMerging(false);
    setView('complete');
  }, [changed, statuses]);

  const rejectVersion = useCallback(() => {
    const next: Record<string, ReviewStatus> = { ...statuses };
    changed.forEach((c) => (next[c.id] = 'rejected'));
    setStatuses(next);
    setMerging(false);
    setView('complete');
  }, [changed, statuses]);

  const undo = useCallback((id: string) => {
    setStatuses((s) => ({ ...s, [id]: 'pending' }));
    setView('clause');
    setMerging(false);
  }, []);

  const startMerge = useCallback(() => {
    const sel = selById(selectedId);
    if (!sel || !isChanged(sel.id)) return;
    const item = sel as ReviewItem;
    if (item.kind === 'remove') return;
    setDraft(mergedText[item.id] ?? item.proposedText ?? '');
    setMerging(true);
  }, [selById, selectedId, isChanged, mergedText]);

  const saveMerge = useCallback(() => {
    if (!selectedId) return;
    const next = { ...statuses, [selectedId]: 'merged' as ReviewStatus };
    setMergedText((m) => ({ ...m, [selectedId]: draft }));
    setStatuses(next);
    setMerging(false);
    advance(next);
  }, [selectedId, statuses, draft, advance]);

  const nav = useCallback(
    (d: number) => {
      const idx = changed.findIndex((c) => c.id === selectedId);
      if (idx === -1) {
        if (changed[0]) select(changed[0].id);
        return;
      }
      const ni = Math.max(0, Math.min(changed.length - 1, idx + d));
      select(changed[ni].id);
    },
    [changed, selectedId, select],
  );

  const apply = useCallback(async () => {
    if (!model) return;
    setApplying(true);
    setApplyError(null);
    try {
      const dto = buildApplyDto(
        model.changed,
        statuses,
        mergedText,
        model.allProposedClauseIds,
        t('hostReview.changeSummary'),
      );
      const res = await documentProcessingService.applyProposedVersion(contractId, doc.id, dto);
      setApplied(res);
      setConfirming(false);
      onApplied?.();
    } catch {
      setApplyError(t('hostReview.applyFailed'));
      setConfirming(false);
    } finally {
      setApplying(false);
    }
  }, [model, statuses, mergedText, contractId, doc.id, onApplied, t]);

  const requestApply = useCallback(() => {
    if (tally.applyCount === 0) apply();
    else setConfirming(true);
  }, [tally.applyCount, apply]);

  // ── keyboard shortcuts (clause view, not merging/confirming) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape works in EVERY state (reachable above the clause-view guard):
      // confirm modal → close it; merge editor → cancel; otherwise → close the
      // screen (unless a write is in flight).
      if (e.key === 'Escape') {
        if (applying) return;
        e.preventDefault();
        if (confirming) setConfirming(false);
        else if (merging) setMerging(false);
        else onClose();
        return;
      }
      if (view !== 'clause' || merging || confirming || applied) return;
      const tg = e.target as HTMLElement | null;
      if (tg && (tg.tagName === 'TEXTAREA' || tg.tagName === 'INPUT')) return;
      const sel = selById(selectedId);
      const k = (e.key || '').toLowerCase();
      if (sel && isChanged(sel.id)) {
        const item = sel as ReviewItem;
        if (k === 'a') { e.preventDefault(); setStatus(sel.id, 'accepted'); return; }
        if (k === 'r') { e.preventDefault(); setStatus(sel.id, 'rejected'); return; }
        if (k === 'm' && item.kind !== 'remove') { e.preventDefault(); startMerge(); return; }
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); nav(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nav(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, merging, confirming, applied, applying, selectedId, selById, isChanged, setStatus, startMerge, nav, onClose]);

  const fileName = doc.original_name || doc.file_name;
  const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  // ── render ──
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', background: C.page, overflow: 'hidden', fontFamily: "'DM Sans', system-ui, sans-serif", color: C.ink }}
    >
      {/* HEADER */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, height: 60, padding: '0 22px', background: C.surface, borderBottom: `1px solid ${C.border}`, flexShrink: 0, zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: BRICOLAGE, fontWeight: 800, fontSize: 15, flexShrink: 0 }}>S</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 14.5, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }} dir="auto">{fileName}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.primaryBg, color: C.primaryDk, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: C.primaryDk, display: 'inline-block' }} />
                {t('hostReview.reviewingGuestVersion')}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: C.muted2, whiteSpace: 'nowrap' }}>{t('hostReview.proposedBy', { name: t('contract.proposedVersions.byGuest') })}</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: '#4B5563', fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{t('hostReview.reviewedOfTotal', { reviewed, total })}</span>
            <div style={{ width: 120, height: 6, borderRadius: 999, background: C.border, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: C.primary, borderRadius: 999, transition: 'width .35s cubic-bezier(.4,0,.2,1)' }} />
            </div>
          </div>
        )}
        <div style={{ width: 1, height: 28, background: C.border, margin: '0 5px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!applied && total > 0 && (allReviewed ? (
            <button onClick={() => setView('complete')} style={primaryBtn(13)}>{t('hostReview.reviewSummary')} →</button>
          ) : (
            <>
              <button onClick={rejectVersion} style={ghostBtn(13)}>{t('hostReview.rejectVersion')}</button>
              <button onClick={acceptAll} style={primaryBtn(13)}>{t('hostReview.acceptAllChanges', { count: total })}</button>
            </>
          ))}
          <button onClick={onClose} aria-label={t('hostReview.close')} style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${C.border}`, background: '#fff', color: C.muted, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
        </div>
      </header>

      {/* COUNTS STRIP */}
      {model && total >= 0 && !error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '11px 22px', background: '#F4F8FF', borderBottom: `1px solid ${C.border}`, flexShrink: 0, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
            <span style={{ fontFamily: BRICOLAGE, fontWeight: 700, fontSize: 15, color: C.ink }}>{t('hostReview.clausesChanged', { changed: total, total: model.totalClauses })}</span>
            <span style={{ fontSize: 12, color: C.muted }}>{t('hostReview.onlyDiffsShown')}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {countChip('#E8A33D', '#9A6207', t('hostReview.modifiedCount', { count: model.counts.modified }))}
            {countChip('#15A05A', '#0B6E3B', t('hostReview.addedCount', { count: model.counts.added }))}
            {countChip('#E15663', '#A81F2C', t('hostReview.removedCount', { count: model.counts.removed }))}
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: C.muted2, fontWeight: 700, letterSpacing: '.05em' }}>{t('hostReview.viewLabel')}</span>
            <div style={{ display: 'flex', background: '#E7EBF1', borderRadius: 9, padding: 3, gap: 2 }}>
              <button onClick={() => setFilter('changed')} style={seg(filter === 'changed')}>{t('hostReview.segChanged', { count: total })}</button>
              <button onClick={() => setFilter('all')} style={seg(filter === 'all')}>{t('hostReview.segAll', { count: model.totalClauses })}</button>
            </div>
          </div>
        </div>
      )}

      {/* BODY */}
      <main style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {loading && <div style={{ margin: 'auto', color: C.muted2, fontSize: 14 }}>{t('hostReview.loading')}</div>}
        {error && (
          <div style={{ margin: 'auto', textAlign: 'center' }}>
            <div style={{ color: C.delInk, fontSize: 14, marginBottom: 12 }}>{error}</div>
            <button onClick={() => load()} style={ghostBtn(13)}>↺ {t('hostReview.retry')}</button>
          </div>
        )}

        {model && !loading && !error && total === 0 && (
          <div style={{ margin: 'auto', maxWidth: 440, textAlign: 'center', padding: 24 }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: C.acceptBg, color: C.accept, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, margin: '0 auto 16px' }}>=</div>
            <h2 style={{ fontFamily: BRICOLAGE, fontWeight: 700, fontSize: 20, margin: '0 0 8px' }}>{t('hostReview.noChangesTitle')}</h2>
            <p style={{ fontSize: 14, color: C.muted, margin: '0 0 20px', lineHeight: 1.55 }}>{t('hostReview.noChangesBody')}</p>
            <button onClick={onClose} style={primaryBtn(14)}>{t('hostReview.close')}</button>
          </div>
        )}

        {model && !loading && !error && total > 0 && (
          <>
            {/* RAIL */}
            <aside style={{ width: 324, flexShrink: 0, background: '#FBFCFD', borderRight: `1px solid ${C.border}`, overflowY: 'auto', padding: '14px 12px' }}>
              {renderRail()}
            </aside>

            {/* PANE */}
            <section style={{ flex: 1, overflowY: 'auto', background: C.page, minWidth: 0 }}>
              {view === 'clause' ? renderClausePane() : renderComplete()}
            </section>
          </>
        )}
      </main>

      {confirming && renderConfirm()}
    </div>
  );

  // ── rail ──
  function railClauseRow(c: ReviewItem) {
    const st = statusMeta(statuses[c.id] ?? 'pending');
    const selected = selectedId === c.id && view === 'clause';
    const cat = categoryMeta(c.category);
    const editsLabel = c.kind === 'remove' ? t('hostReview.removedLabel') : c.kind === 'add' ? t('hostReview.newClauseLabel') : t('hostReview.editsLabel', { count: c.editsCount });
    const editsColor = c.kind === 'remove' ? '#B5535E' : c.kind === 'add' ? '#2E9466' : C.muted3;
    return (
      <div key={c.id} onClick={() => select(c.id)} style={{ position: 'relative', background: '#fff', border: '1px solid #E8ECF1', borderRadius: 10, padding: '11px 12px 11px 16px', marginBottom: 8, cursor: 'pointer' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, borderRadius: '10px 0 0 10px', background: st.accent }} />
        {selected && <div style={{ position: 'absolute', inset: 0, border: `1.5px solid ${C.primary}`, borderRadius: 10, background: 'rgba(13,110,253,0.045)', pointerEvents: 'none' }} />}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap' }}>{clauseLabel(c.sectionNumber)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#F2F4F7', borderRadius: 6, padding: '2px 7px', fontSize: 10.5, fontWeight: 600, color: C.muted, whiteSpace: 'nowrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: cat.color, display: 'inline-block', flexShrink: 0 }} />{cat.label}
            </span>
          </div>
          {c.confidence != null && <span style={confStyle(Math.round(c.confidence * 100))}>{Math.round(c.confidence * 100)}%</span>}
        </div>
        <div dir="auto" style={arStyle({ fontWeight: 600, fontSize: 14, color: C.ink2, textAlign: ARABIC.test(c.title) ? 'right' : 'left', marginBottom: 9, lineHeight: 1.5, position: 'relative' })}>{c.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, position: 'relative' }}>
          <span style={{ background: st.bg, color: st.ink, padding: '2px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{statusLabel(statuses[c.id] ?? 'pending')}</span>
          <span style={{ fontSize: 11, fontWeight: c.kind === 'modify' ? 600 : 700, color: editsColor, whiteSpace: 'nowrap' }}>{editsLabel}</span>
        </div>
      </div>
    );
  }

  function railUnchangedRow(u: UnchangedItem) {
    return (
      <div key={u.id} onClick={() => select(u.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted2, whiteSpace: 'nowrap' }}>{clauseLabel(u.sectionNumber)}</span>
          <span dir="auto" style={arStyle({ fontSize: 12.5, color: '#9AA3AE', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{u.title}</span>
        </div>
        <span style={{ fontSize: 10.5, color: '#B3BAC4', fontWeight: 600, whiteSpace: 'nowrap' }}>{t('hostReview.noChanges')}</span>
      </div>
    );
  }

  function renderRail() {
    if (filter === 'changed') {
      return (
        <>
          {railHeader(t('hostReview.changedClauses'), total)}
          {changed.map(railClauseRow)}
          {unchanged.length > 0 && (
            <button onClick={() => setUnchangedOpen((o) => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'transparent', border: '1px dashed #D4DAE2', borderRadius: 9, padding: 10, margin: '8px 0 4px', fontSize: 12.5, fontWeight: 600, color: C.muted, cursor: 'pointer' }}>
              {unchangedOpen ? `▾  ${t('hostReview.hideUnchanged')}` : `▸  ${t('hostReview.showUnchanged', { count: unchanged.length })}`}
            </button>
          )}
          {unchangedOpen && unchanged.map(railUnchangedRow)}
        </>
      );
    }
    const merged = [
      ...changed.map((c) => ({ n: numOf(c.sectionNumber), node: railClauseRow(c) })),
      ...unchanged.map((u) => ({ n: numOf(u.sectionNumber), node: railUnchangedRow(u) })),
    ].sort((a, b) => a.n - b.n);
    return (
      <>
        {railHeader(t('hostReview.allClauses'), model!.totalClauses)}
        {merged.map((m) => m.node)}
      </>
    );
  }

  // ── clause pane ──
  function renderClausePane() {
    const sel = selById(selectedId);
    if (!sel) return null;
    if (isChanged(sel.id)) return renderChangedClause(sel as ReviewItem);
    return renderUnchangedClause(sel as UnchangedItem);
  }

  function renderChangedClause(item: ReviewItem) {
    const st = statuses[item.id] ?? 'pending';
    const sm = statusMeta(st);
    const km = kindMeta(item.kind);
    const cat = categoryMeta(item.category);
    const showBanner = st !== 'pending';
    const idx = changed.findIndex((c) => c.id === item.id);
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 26px 44px' }}>
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(16,24,40,.05)' }}>
          {showBanner && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 22px', background: sm.bg, color: sm.ink, borderBottom: '1px solid rgba(0,0,0,0.05)', fontSize: 13, fontWeight: 600 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 22, height: 22, borderRadius: 999, background: 'rgba(255,255,255,.6)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{st === 'accepted' ? '✓' : st === 'rejected' ? '✕' : '✎'}</span>
                {bannerText(item.kind, st)}
              </span>
              <button onClick={() => undo(item.id)} style={{ background: 'rgba(255,255,255,.72)', border: '1px solid rgba(0,0,0,.08)', color: 'inherit', fontWeight: 700, fontSize: 12, padding: '5px 12px', borderRadius: 9, cursor: 'pointer' }}>{t('hostReview.undo')}</button>
            </div>
          )}

          {/* header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '18px 22px', borderBottom: '1px solid #F0F2F5' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: BRICOLAGE, fontWeight: 700, fontSize: 18, color: C.ink }}>{clauseLabel(item.sectionNumber)}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F2F4F7', borderRadius: 7, padding: '3px 9px', fontSize: 11.5, fontWeight: 600, color: C.muted }}><span style={{ width: 7, height: 7, borderRadius: 999, background: cat.color, display: 'inline-block' }} />{cat.label}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: km.badgeBg, color: km.badgeInk, borderRadius: 7, padding: '3px 9px', fontSize: 11.5, fontWeight: 700 }}>{kindBadge(item)}</span>
              </div>
              <div dir="auto" style={arStyle({ fontWeight: 700, fontSize: 17, color: C.ink2, textAlign: ARABIC.test(item.title) ? 'right' : 'left' })}>{item.title}</div>
            </div>
            {item.confidence != null && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                <span style={confStyle(Math.round(item.confidence * 100))}>{Math.round(item.confidence * 100)}%</span>
                <span style={{ fontSize: 10.5, color: C.muted3, fontWeight: 600 }}>{t('hostReview.aiConfidence')}</span>
              </div>
            )}
          </div>

          {/* legend + diff / merge */}
          <div style={{ padding: '18px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
              <Legend swatch={{ background: '#D9F2E2', border: '1px solid #B6E3C6' }} label={t('hostReview.legendAdded')} />
              <Legend swatch={{ background: '#FBDCE0', border: '1px solid #F2BEC5' }} label={t('hostReview.legendRemoved')} />
              <div style={{ flex: 1 }} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: C.muted2, fontWeight: 600 }}><span style={{ width: 17, height: 17, borderRadius: 5, background: C.page, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: arabicStack, fontSize: 11, color: C.muted }}>ع</span>{t('hostReview.arabicRtl')}</span>
            </div>

            {merging ? renderMergeEditor(item) : renderDiffColumns(item)}
          </div>

          {!merging && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '15px 22px', borderTop: '1px solid #F0F2F5', background: '#FBFCFD', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <button onClick={() => setStatus(item.id, 'accepted')} style={{ background: C.accept, color: '#fff', border: 'none', fontSize: 13.5, padding: '10px 18px', borderRadius: 9, fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(21,160,90,.28)' }}>{acceptLabel(item.kind)}</button>
                  <button onClick={() => setStatus(item.id, 'rejected')} style={{ background: '#fff', border: '1px solid #D4DAE2', color: '#4B5563', fontSize: 13.5, padding: '10px 16px', borderRadius: 9, fontWeight: 600, cursor: 'pointer' }}>{t('hostReview.reject')}</button>
                  {item.kind !== 'remove' && (
                    <button onClick={startMerge} style={{ background: '#fff', border: `1px solid ${C.primary}`, color: C.primary, fontSize: 13.5, padding: '10px 16px', borderRadius: 9, fontWeight: 600, cursor: 'pointer' }}>{t('hostReview.mergeEdit')}</button>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: C.muted2, fontWeight: 600, whiteSpace: 'nowrap' }}>{t('hostReview.changeNofM', { n: idx + 1, total })}</span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button onClick={() => nav(-1)} style={navBtn}>‹</button>
                    <button onClick={() => nav(1)} style={navBtn}>›</button>
                  </div>
                </div>
              </div>
              <div style={{ padding: '0 22px 16px', background: '#FBFCFD' }}>
                <span style={{ fontSize: 11.5, color: '#9AA3AE' }}>{helperText(item.kind)}<span style={{ color: '#B3BAC4' }}> · {t('hostReview.shortcuts')}</span></span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderDiffColumns(item: ReviewItem) {
    return (
      <div dir="ltr" style={{ position: 'relative', display: 'flex', gap: 20, alignItems: 'stretch' }}>
        {/* Original */}
        <div style={{ flex: 1, minWidth: 0, border: '1px solid #ECEFF3', borderRadius: 11, background: '#FCFCFD', overflow: 'hidden', borderTop: '3px solid #D4DAE2' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid #ECEFF3', background: '#fff' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4B5563' }}>{t('hostReview.colOriginal')}</span>
            <span style={{ fontSize: 10.5, color: C.muted3, fontWeight: 600 }}>{t('hostReview.colCurrentContract')}</span>
          </div>
          {item.kind === 'add' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 108, padding: 22, textAlign: 'center' }}>
              <span style={{ width: 32, height: 32, borderRadius: 999, background: C.page, color: '#9AA3AE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>＋</span>
              <div><div style={{ fontSize: 13, color: '#6B7480', fontWeight: 700 }}>{t('hostReview.notInCurrent')}</div><div style={{ fontSize: 11.5, color: C.muted3, marginTop: 2 }}>{t('hostReview.newlyProposed')}</div></div>
            </div>
          ) : (
            <div dir="auto" style={arStyle({ padding: 17, fontSize: 17, lineHeight: 2.05, color: C.ink2, minHeight: 108, whiteSpace: 'pre-wrap' })}>{renderSide(item, 'orig')}</div>
          )}
        </div>
        {/* arrow */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 30, height: 30, borderRadius: 999, background: '#fff', border: `1px solid ${C.border}`, boxShadow: '0 2px 7px rgba(16,24,40,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: kindMeta(item.kind).arrowColor, fontSize: 15, fontWeight: 700, zIndex: 2 }}>{kindMeta(item.kind).arrow}</div>
        {/* Proposed */}
        <div style={{ flex: 1, minWidth: 0, border: '1px solid #D9E5FB', borderRadius: 11, background: '#fff', overflow: 'hidden', borderTop: `3px solid ${C.primary}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid #ECEFF3', background: '#F7FAFF' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.primaryDk }}>{t('hostReview.colProposed')}</span>
            <span style={{ fontSize: 10.5, color: C.muted, fontWeight: 600 }}>{t('hostReview.colGuestUpload')}</span>
          </div>
          {item.kind === 'remove' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 108, padding: 22, textAlign: 'center', background: 'repeating-linear-gradient(135deg,#FFF8F9,#FFF8F9 9px,#FCEAEC 9px,#FCEAEC 18px)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 999, background: '#FBDCE0', color: '#A81F2C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>✕</span>
              <div><div style={{ fontSize: 13, color: '#A81F2C', fontWeight: 700 }}>{t('hostReview.removedByGuest')}</div><div style={{ fontSize: 11.5, color: '#C2727B', marginTop: 2 }}>{t('hostReview.willBeDeleted')}</div></div>
            </div>
          ) : (
            <div dir="auto" style={arStyle({ padding: 17, fontSize: 17, lineHeight: 2.05, color: C.ink2, minHeight: 108, whiteSpace: 'pre-wrap' })}>{renderSide(item, 'prop')}</div>
          )}
        </div>
      </div>
    );
  }

  function renderMergeEditor(item: ReviewItem) {
    const chips: { label: string; text: string }[] = [];
    if (item.kind === 'modify') {
      chips.push({ label: t('hostReview.chipProposedWording'), text: item.proposedText ?? '' });
      chips.push({ label: t('hostReview.chipOriginalWording'), text: item.originalText ?? '' });
    } else if (item.kind === 'add') {
      chips.push({ label: t('hostReview.chipProposedNew'), text: item.proposedText ?? '' });
    }
    return (
      <div dir="ltr" style={{ display: 'flex', gap: 20, alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0, border: '1px solid #ECEFF3', borderRadius: 11, background: '#FCFCFD', overflow: 'hidden', borderTop: '3px solid #D4DAE2' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid #ECEFF3', background: '#fff' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4B5563' }}>{t('hostReview.colOriginal')}</span>
            <span style={{ fontSize: 10.5, color: C.muted3, fontWeight: 600 }}>{t('hostReview.colReference')}</span>
          </div>
          {item.kind === 'add' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 108, padding: 22, textAlign: 'center' }}>
              <span style={{ width: 30, height: 30, borderRadius: 999, background: C.page, color: '#9AA3AE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>＋</span>
              <span style={{ fontSize: 12, color: '#9AA3AE', fontWeight: 600 }}>{t('hostReview.newClauseNoOriginal')}</span>
            </div>
          ) : (
            <div dir="auto" style={arStyle({ padding: 17, fontSize: 16.5, lineHeight: 2.05, color: '#6B7480', minHeight: 108, whiteSpace: 'pre-wrap' })}>{item.originalText}</div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, border: '1px solid #D9E5FB', borderRadius: 11, background: '#fff', overflow: 'hidden', borderTop: `3px solid ${C.primary}`, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', borderBottom: '1px solid #ECEFF3', background: '#F7FAFF' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: C.primaryDk }}>{t('hostReview.yourEditedWording')}</span>
            <span style={{ fontSize: 10.5, color: C.primary, fontWeight: 700, background: C.primaryBg, padding: '2px 8px', borderRadius: 999 }}>{t('hostReview.editableRtl')}</span>
          </div>
          <div style={{ padding: 13 }}>
            {chips.length > 0 && (
              <div style={{ display: 'flex', gap: 7, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: C.muted2, fontWeight: 700 }}>{t('hostReview.startFrom')}</span>
                {chips.map((ch, i) => (
                  <button key={i} onClick={() => setDraft(ch.text)} style={{ background: '#F2F4F7', border: `1px solid ${C.border}`, borderRadius: 999, padding: '5px 11px', fontSize: 11.5, fontWeight: 600, color: '#4B5563', cursor: 'pointer' }}>{ch.label}</button>
                ))}
              </div>
            )}
            <textarea dir="auto" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: '100%', minHeight: 128, resize: 'vertical', border: '1px solid #D4DAE2', borderRadius: 9, padding: '13px 14px', fontFamily: arabicStack, fontSize: 16.5, lineHeight: 2, color: C.ink2, outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 9, marginTop: 12 }}>
              <button onClick={saveMerge} disabled={!draft.trim()} style={{ background: draft.trim() ? C.primary : '#9DBFF5', color: '#fff', border: 'none', fontSize: 13.5, padding: '10px 18px', borderRadius: 9, fontWeight: 600, cursor: draft.trim() ? 'pointer' : 'not-allowed', boxShadow: '0 1px 2px rgba(13,110,253,.25)' }}>{t('hostReview.saveEditedClause')}</button>
              <button onClick={() => setMerging(false)} style={{ background: '#fff', border: '1px solid #D4DAE2', color: '#4B5563', fontSize: 13.5, padding: '10px 16px', borderRadius: 9, fontWeight: 600, cursor: 'pointer' }}>{t('hostReview.cancel')}</button>
            </div>
            <div style={{ fontSize: 11.5, color: C.muted2, marginTop: 10, lineHeight: 1.5 }}>{t('hostReview.mergeHelper')}</div>
          </div>
        </div>
      </div>
    );
  }

  function renderUnchangedClause(u: UnchangedItem) {
    const cat = categoryMeta(u.category);
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 26px 44px' }}>
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(16,24,40,.05)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '18px 22px', borderBottom: '1px solid #F0F2F5' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                <span style={{ fontFamily: BRICOLAGE, fontWeight: 700, fontSize: 18, color: C.ink }}>{clauseLabel(u.sectionNumber)}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#F2F4F7', borderRadius: 7, padding: '3px 9px', fontSize: 11.5, fontWeight: 600, color: C.muted }}><span style={{ width: 7, height: 7, borderRadius: 999, background: cat.color, display: 'inline-block' }} />{cat.label}</span>
              </div>
              <div dir="auto" style={arStyle({ fontWeight: 700, fontSize: 17, color: C.ink2, textAlign: ARABIC.test(u.title) ? 'right' : 'left' })}>{u.title}</div>
            </div>
            <span style={{ fontSize: 11, color: C.muted2, fontWeight: 700, background: C.page, padding: '5px 11px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>{t('hostReview.noChanges')}</span>
          </div>
          <div style={{ padding: '18px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F4F6F8', border: '1px solid #E8ECF1', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
              <span style={{ width: 20, height: 20, borderRadius: 999, background: '#E1E6EC', color: C.muted2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>=</span>
              <span style={{ fontSize: 13, color: '#6B7480', fontWeight: 600 }}>{t('hostReview.unchangedIdentical')}</span>
            </div>
            <div style={{ border: '1px solid #ECEFF3', borderRadius: 11, background: '#FCFCFD', overflow: 'hidden' }}>
              <div style={{ padding: '9px 14px', borderBottom: '1px solid #ECEFF3', background: '#fff', fontSize: 12.5, fontWeight: 700, color: '#4B5563' }}>{t('hostReview.clauseText')}</div>
              <div dir="auto" style={arStyle({ padding: 17, fontSize: 17, lineHeight: 2.05, color: C.ink2, whiteSpace: 'pre-wrap' })}>{u.body}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── complete view ──
  function renderComplete() {
    const rejectedAll = tally.rejected === total && total > 0;
    const isApplied = !!applied;
    const title = isApplied ? (tally.applyCount > 0 ? t('hostReview.completeAppliedTitle') : t('hostReview.completeKeptTitle')) : rejectedAll ? t('hostReview.completeRejectedTitle') : t('hostReview.completeReviewTitle');
    const subtitle = isApplied ? (tally.applyCount > 0 ? t('hostReview.completeAppliedSubtitle') : t('hostReview.completeKeptSubtitle')) : rejectedAll ? t('hostReview.completeRejectedSubtitle') : t('hostReview.completeReviewSubtitle', { total });
    const iconBg = rejectedAll && !isApplied ? C.page : C.acceptBg;
    const iconColor = rejectedAll && !isApplied ? C.muted2 : C.accept;
    const icon = rejectedAll && !isApplied ? '✕' : '✓';
    return (
      <div style={{ maxWidth: 580, margin: '48px auto', padding: '0 24px' }}>
        <div style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 18, padding: '38px 36px', textAlign: 'center', boxShadow: '0 4px 22px rgba(16,24,40,.07)' }}>
          <div style={{ width: 60, height: 60, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 26, background: iconBg, color: iconColor }}>{icon}</div>
          <h2 style={{ fontFamily: BRICOLAGE, fontWeight: 700, fontSize: 24, color: C.ink, margin: '0 0 8px' }}>{title}</h2>
          <p style={{ fontSize: 14, color: C.muted, margin: '0 0 24px', lineHeight: 1.55 }}>{subtitle}</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 26 }}>
            {statCard(tally.accepted, t('hostReview.statAccepted'), '#F4FBF7', '#D6EEE0', '#0E7A43')}
            {statCard(tally.merged, t('hostReview.statEdited'), '#F6F8FF', '#DCE6FB', C.primaryDk)}
            {statCard(tally.rejected, t('hostReview.statRejected'), '#F6F7F9', '#E6E9ED', '#6B7480')}
          </div>
          {applyError && <div style={{ background: '#FBE3E6', color: C.delInk, fontSize: 13, fontWeight: 600, padding: 10, borderRadius: 10, marginBottom: 12 }}>{applyError}</div>}
          {!isApplied ? (
            <>
              <button onClick={requestApply} disabled={applying} style={{ ...primaryBtn(14), width: '100%', opacity: applying ? 0.7 : 1 }}>{tally.applyCount > 0 ? `${t('hostReview.applyNChanges', { count: tally.applyCount })} →` : t('hostReview.keepCurrentVersion')}</button>
              <button onClick={() => setView('clause')} style={{ ...ghostBtn(13.5), width: '100%', marginTop: 9 }}>{t('hostReview.backToClauses')}</button>
              <div style={{ fontSize: 11.5, color: '#9AA3AE', marginTop: 16, lineHeight: 1.6 }}>{t('hostReview.snapshotNote')}</div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: C.acceptBg, color: C.acceptInk, fontWeight: 700, fontSize: 13.5, padding: 12, borderRadius: 11, marginBottom: 4 }}>✓ {appliedNote()}</div>
              <button onClick={onClose} style={{ ...ghostBtn(13.5), width: '100%', marginTop: 9 }}>{t('hostReview.backToContract')}</button>
            </>
          )}
        </div>
      </div>
    );
  }

  function appliedNote() {
    if (!applied) return '';
    if (tally.applyCount > 0) {
      return applied.snapshot_version_number != null
        ? t('hostReview.appliedNoteVersioned', { version: applied.snapshot_version_number, count: tally.applyCount })
        : t('hostReview.appliedNote', { count: tally.applyCount });
    }
    return t('hostReview.contractUnchanged');
  }

  // ── confirm modal ──
  function renderConfirm() {
    const lines = [
      { n: changed.filter((c) => c.kind === 'modify' && statuses[c.id] === 'accepted').length, icon: '✓', bg: C.acceptBg, color: C.acceptInk, text: (n: number) => t('hostReview.applyLineUpdated', { count: n }) },
      { n: tally.merged, icon: '✎', bg: C.primaryBg, color: C.primaryDk, text: (n: number) => t('hostReview.applyLineEdited', { count: n }) },
      { n: changed.filter((c) => c.kind === 'add' && statuses[c.id] === 'accepted').length, icon: '＋', bg: '#DEF3E6', color: '#0B6E3B', text: (n: number) => t('hostReview.applyLineAdded', { count: n }) },
      { n: changed.filter((c) => c.kind === 'remove' && statuses[c.id] === 'accepted').length, icon: '✕', bg: '#FBE3E6', color: '#A81F2C', text: (n: number) => t('hostReview.applyLineRemoved', { count: n }) },
    ].filter((l) => l.n > 0);
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(22,26,32,.45)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: 524, maxHeight: 'calc(100vh - 48px)', background: '#fff', borderRadius: 18, boxShadow: '0 24px 60px rgba(16,24,40,.28)', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, padding: '22px 24px 16px', borderBottom: '1px solid #F0F2F5' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 36, height: 36, borderRadius: 10, background: C.primaryBg, color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>⤴</span>
              <div>
                <h3 style={{ fontFamily: BRICOLAGE, fontWeight: 700, fontSize: 18, color: C.ink, margin: 0 }}>{t('hostReview.applyDialogTitle')}</h3>
                <div style={{ fontSize: 12.5, color: C.muted2, marginTop: 1 }}>{t('hostReview.applyDialogSubtitle')}</div>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 24px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted2, marginBottom: 11 }}>{t('hostReview.yourReview', { count: total })}</div>
            <div style={{ display: 'flex', gap: 9, marginBottom: 18 }}>
              {statCard(tally.accepted, t('hostReview.statAccepted'), '#F4FBF7', '#D6EEE0', '#0E7A43', true)}
              {statCard(tally.merged, t('hostReview.statEdited'), '#F6F8FF', '#DCE6FB', C.primaryDk, true)}
              {statCard(tally.rejected, t('hostReview.statRejected'), '#F6F7F9', '#E6E9ED', '#6B7480', true)}
            </div>
            {lines.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: C.muted2, marginBottom: 10 }}>{t('hostReview.whatThisDoes')}</div>
                <div style={{ border: '1px solid #ECEFF3', borderRadius: 12, overflow: 'hidden' }}>
                  {lines.map((l, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderBottom: '1px solid #F0F2F5' }}>
                      <span style={{ width: 26, height: 26, borderRadius: 7, background: l.bg, color: l.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{l.icon}</span>
                      <span style={{ fontSize: 13.5, color: C.ink2, fontWeight: 600 }}>{l.text(l.n)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, background: '#F4F8FF', border: '1px solid #DCE8FB', borderRadius: 11, padding: '13px 14px', marginTop: 16 }}>
              <span style={{ width: 26, height: 26, borderRadius: 7, background: '#fff', border: '1px solid #D9E5FB', color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>↺</span>
              <div style={{ fontSize: 12.5, color: '#37506F', lineHeight: 1.55 }}><strong style={{ color: '#0A3C82' }}>{t('hostReview.snapshotReassuranceTitle')}</strong> {t('hostReview.snapshotReassuranceBody')}</div>
            </div>
          </div>
          <div style={{ flexShrink: 0, display: 'flex', gap: 10, padding: '16px 24px 20px', borderTop: '1px solid #F0F2F5' }}>
            <button onClick={() => setConfirming(false)} disabled={applying} style={{ background: '#fff', border: '1px solid #D4DAE2', color: '#4B5563', fontSize: 13.5, padding: '11px 18px', borderRadius: 9, fontWeight: 600, cursor: 'pointer' }}>{t('hostReview.cancel')}</button>
            <button onClick={apply} disabled={applying} style={{ flex: 1, background: C.primary, color: '#fff', border: 'none', fontSize: 13.5, padding: '11px 18px', borderRadius: 9, fontWeight: 600, cursor: 'pointer', boxShadow: '0 2px 6px rgba(13,110,253,.28)', opacity: applying ? 0.7 : 1 }}>{applying ? t('hostReview.applying') : t('hostReview.applyConfirm', { count: tally.applyCount })}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── small render helpers ──
  function renderSide(item: ReviewItem, side: 'orig' | 'prop') {
    if (item.kind === 'modify' && item.wordLevelDiff) {
      return item.wordLevelDiff.map((seg, i) => {
        if (side === 'orig' && seg.added) return null;
        if (side === 'prop' && seg.removed) return null;
        const style = side === 'orig' ? (seg.removed ? DEL_TOK : { unicodeBidi: 'isolate' as const }) : seg.added ? ADD_TOK : { unicodeBidi: 'isolate' as const };
        return <span key={i} style={style}>{seg.value}</span>;
      });
    }
    if (side === 'orig') return item.originalText ? <span style={item.kind === 'remove' ? WHOLE_DEL : undefined}>{item.originalText}</span> : null;
    return item.kind === 'add' && item.proposedText ? <span style={WHOLE_ADD}>{item.proposedText}</span> : item.proposedText ? <span>{item.proposedText}</span> : null;
  }

  function clauseLabel(section: string | null) {
    return section && section.trim() ? t('hostReview.clauseLabel', { num: section.trim() }) : t('hostReview.clauseLabelNoNum');
  }
  function statusLabel(s: ReviewStatus) {
    return { pending: t('hostReview.statusPending'), accepted: t('hostReview.statusAccepted'), rejected: t('hostReview.statusRejected'), merged: t('hostReview.statusEdited') }[s];
  }
  function kindBadge(item: ReviewItem) {
    return item.kind === 'modify' ? t('hostReview.kindModified', { count: item.editsCount }) : item.kind === 'remove' ? t('hostReview.kindRemoved') : t('hostReview.kindNew');
  }
  function acceptLabel(k: ReviewKind) {
    return k === 'remove' ? t('hostReview.acceptRemoval') : k === 'add' ? t('hostReview.acceptAndAdd') : t('hostReview.acceptProposed');
  }
  function helperText(k: ReviewKind) {
    return k === 'remove' ? t('hostReview.helperRemove') : k === 'add' ? t('hostReview.helperAdd') : t('hostReview.helperModify');
  }
  function bannerText(k: ReviewKind, s: ReviewStatus) {
    if (s === 'merged') return t('hostReview.bannerEdited');
    if (s === 'accepted') return k === 'remove' ? t('hostReview.bannerAcceptedRemove') : k === 'add' ? t('hostReview.bannerAcceptedAdd') : t('hostReview.bannerAcceptedModify');
    return k === 'remove' ? t('hostReview.bannerRejectedRemove') : k === 'add' ? t('hostReview.bannerRejectedAdd') : t('hostReview.bannerRejectedModify');
  }
}

// ── module-level style helpers ───────────────────────────────────────────────
const primaryBtn = (fs: number): CSSProperties => ({ background: '#0D6EFD', color: '#fff', border: 'none', fontWeight: 600, fontSize: fs, padding: '9px 16px', borderRadius: 9, cursor: 'pointer', boxShadow: '0 1px 2px rgba(13,110,253,.25)', whiteSpace: 'nowrap', fontFamily: "'DM Sans', sans-serif" });
const ghostBtn = (fs: number): CSSProperties => ({ background: '#fff', color: '#4B5563', border: '1px solid #D4DAE2', fontWeight: 600, fontSize: fs, padding: '9px 15px', borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'DM Sans', sans-serif" });
const navBtn: CSSProperties = { width: 32, height: 32, borderRadius: 8, border: '1px solid #D4DAE2', background: '#fff', color: '#5A636F', fontSize: 17, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 };
const seg = (active: boolean): CSSProperties => ({ border: 'none', cursor: 'pointer', fontSize: 12.5, fontFamily: "'DM Sans', sans-serif", padding: '6px 14px', borderRadius: 7, ...(active ? { background: '#fff', color: '#161A20', boxShadow: '0 1px 2px rgba(16,24,40,.12)', fontWeight: 700 } : { background: 'transparent', color: '#8A93A0', fontWeight: 600 }) });

function countChip(dot: string, ink: string, label: string) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff', border: '1px solid #E8ECF1', borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: ink }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: dot }} />{label}
    </span>
  );
}
function railHeader(label: string, count: number) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '6px 6px 10px' }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8A93A0' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#8A93A0', background: '#EDEFF2', borderRadius: 999, padding: '1px 9px' }}>{count}</span>
    </div>
  );
}
function Legend({ swatch, label }: { swatch: CSSProperties; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, ...swatch }} />
      <span style={{ fontSize: 11.5, color: '#5A636F', fontWeight: 600 }}>{label}</span>
    </div>
  );
}
function statCard(value: number, label: string, bg: string, border: string, color: string, compact = false) {
  return (
    <div style={{ flex: 1, maxWidth: compact ? undefined : 150, background: bg, border: `1px solid ${border}`, borderRadius: compact ? 11 : 12, padding: compact ? '11px 8px' : '14px 10px', textAlign: 'center' }}>
      <div style={{ fontFamily: BRICOLAGE, fontWeight: 700, fontSize: compact ? 23 : 26, color, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: compact ? 11 : 11.5, color: '#5A636F', fontWeight: 600, marginTop: compact ? 3 : 2 }}>{label}</div>
    </div>
  );
}
function numOf(section: string | null): number {
  if (!section) return 9999;
  const m = section.match(/\d+/);
  return m ? parseInt(m[0], 10) : 9999;
}
