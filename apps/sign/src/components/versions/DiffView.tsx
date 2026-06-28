import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { VersionDiffChange } from '@/types';

/**
 * Shared presentational diff modal (extracted in 2b from DiffViewerModal so the
 * version-vs-version compare AND the guest proposed-vs-current compare reuse the
 * exact same side-by-side + word-highlight rendering).
 *
 * RTL (NET-NEW in 2b): clause CONTENT is auto-directional (`dir="auto"` +
 * `unicodeBidi: plaintext`) so Arabic reads right-to-left and Latin stays LTR
 * with no flag. When the diff is predominantly Arabic, the two content columns
 * MIRROR (the grid goes `dir="rtl"`, so the "A" column sits on the right where
 * an RTL reader starts) and an "Arabic · right-to-left" indicator shows. The
 * chrome (header, filters, buttons) always stays LTR. Pure-Latin diffs render
 * byte-identically to the pre-2b viewer.
 */
export interface DiffViewData {
  summary: { added: number; removed: number; modified: number; unchanged: number };
  changes: VersionDiffChange[];
}

interface Props {
  title: string;
  subtitle?: string;
  /** Column sub-label for the A / left ("previous"/current) side. */
  colLabelA: string;
  /** Column sub-label for the B / right ("current"/proposed) side. */
  colLabelB: string;
  data: DiffViewData | null;
  loading?: boolean;
  error?: string | null;
  /** Localized "Arabic · reads right-to-left" hint shown when RTL is detected. */
  rtlIndicator?: string;
  onClose: () => void;
}

type FilterKey = 'ALL' | 'CHANGES' | 'ADDED' | 'REMOVED' | 'MODIFIED';

const ARABIC = /[؀-ۿ]/;
const hasArabic = (s: string | null | undefined) => !!s && ARABIC.test(s);

export function DiffView({
  title,
  subtitle,
  colLabelA,
  colLabelB,
  data,
  loading = false,
  error = null,
  rtlIndicator,
  onClose,
}: Props) {
  const [filter, setFilter] = useState<FilterKey>('CHANGES');
  const [inline, setInline] = useState(false);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === 'ALL') return data.changes;
    if (filter === 'CHANGES') return data.changes.filter((c) => c.changeType !== 'UNCHANGED');
    return data.changes.filter((c) => c.changeType === filter);
  }, [data, filter]);

  // RTL when the diff content is predominantly Arabic (any clause text/title).
  const rtl = useMemo(
    () =>
      !!data &&
      data.changes.some(
        (c) => hasArabic(c.originalText) || hasArabic(c.newText) || hasArabic(c.clauseTitle),
      ),
    [data],
  );

  return (
    // Chrome is explicitly LTR; only the clause-content columns flip.
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="ltr">
      <div className="bg-white rounded-xl shadow-2xl max-w-7xl w-full max-h-[92vh] flex flex-col">
        {/* Header (LTR chrome) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-md hover:bg-slate-100 text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary + filters (LTR chrome) */}
        {data && (
          <div className="px-6 py-3 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-sm">
                <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-700">
                  +{data.summary.added} added
                </span>
                <span className="px-2 py-1 rounded bg-red-100 text-red-700">
                  -{data.summary.removed} removed
                </span>
                <span className="px-2 py-1 rounded bg-amber-100 text-amber-700">
                  ~{data.summary.modified} modified
                </span>
                <span className="px-2 py-1 rounded bg-slate-200 text-slate-600">
                  {data.summary.unchanged} unchanged
                </span>
                {rtl && rtlIndicator && (
                  <span className="px-2 py-1 rounded bg-violet-100 text-violet-700">
                    {rtlIndicator}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {(['ALL', 'CHANGES', 'ADDED', 'REMOVED', 'MODIFIED'] as FilterKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    className={`px-3 py-1 text-xs rounded-md border ${
                      filter === k
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {k === 'CHANGES' ? 'Changes Only' : k.charAt(0) + k.slice(1).toLowerCase()}
                  </button>
                ))}
                <label className="inline-flex items-center gap-1 text-xs text-slate-600 ml-2 cursor-pointer">
                  <input type="checkbox" checked={inline} onChange={(e) => setInline(e.target.checked)} />
                  Inline
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {loading && <div className="text-center text-slate-500 py-10">Loading diff…</div>}
          {error && <div className="text-center text-red-600 py-10">{error}</div>}
          {data && !filtered.length && (
            <div className="text-center text-slate-500 py-10">No changes to display.</div>
          )}
          <div className="space-y-5">
            {filtered.map((c) => (
              <ClauseDiff
                key={c.clauseId}
                change={c}
                inline={inline}
                rtl={rtl}
                colLabelA={colLabelA}
                colLabelB={colLabelB}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ClauseDiff({
  change,
  inline,
  rtl,
  colLabelA,
  colLabelB,
}: {
  change: VersionDiffChange;
  inline: boolean;
  rtl: boolean;
  colLabelA: string;
  colLabelB: string;
}) {
  const headerColor =
    change.changeType === 'ADDED'
      ? 'bg-emerald-50 border-emerald-200'
      : change.changeType === 'REMOVED'
        ? 'bg-red-50 border-red-200'
        : change.changeType === 'MODIFIED'
          ? 'bg-amber-50 border-amber-200'
          : 'bg-slate-50 border-slate-200';

  // Auto-directional clause content: Arabic → RTL, Latin → LTR, mixed-safe.
  const contentDir = 'auto' as const;
  const contentStyle = { unicodeBidi: 'plaintext' as const };

  return (
    <div className={`border rounded-lg ${headerColor}`}>
      {/* Card header stays LTR chrome. */}
      <div className="px-4 py-2 border-b border-current/10 flex items-center gap-2" dir="ltr">
        <span className="text-xs font-semibold uppercase tracking-wide">{change.changeType}</span>
        {change.clauseNumber && <span className="text-xs text-slate-500">§ {change.clauseNumber}</span>}
        <span className="font-semibold text-slate-900 truncate" dir="auto" style={contentStyle}>
          {change.clauseTitle}
        </span>
      </div>

      {inline && change.wordLevelDiff ? (
        <div
          className="p-4 text-sm leading-relaxed bg-white whitespace-pre-wrap"
          dir={contentDir}
          style={contentStyle}
        >
          {change.wordLevelDiff.map((p, i) => (
            <span
              key={i}
              className={
                p.added
                  ? 'bg-emerald-100 text-emerald-800'
                  : p.removed
                    ? 'bg-red-100 text-red-700 line-through'
                    : ''
              }
            >
              {p.value}
            </span>
          ))}
        </div>
      ) : (
        // Side-by-side. Under RTL the grid mirrors (A column sits on the right,
        // where an RTL reader starts); under LTR it is unchanged (A left).
        <div
          className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 bg-white"
          dir={rtl ? 'rtl' : 'ltr'}
        >
          <div className="p-4 text-sm whitespace-pre-wrap" dir={contentDir} style={contentStyle}>
            <div className="text-xs uppercase text-slate-400 mb-1" dir="ltr">
              {colLabelA}
            </div>
            {change.changeType === 'MODIFIED' && change.wordLevelDiff ? (
              <span>
                {change.wordLevelDiff.map((p, i) =>
                  p.added ? null : (
                    <span key={i} className={p.removed ? 'bg-red-100 text-red-700 line-through' : ''}>
                      {p.value}
                    </span>
                  ),
                )}
              </span>
            ) : (
              <span className={change.changeType === 'REMOVED' ? 'text-red-700 line-through' : ''}>
                {change.originalText || <em className="text-slate-400">—</em>}
              </span>
            )}
          </div>
          <div className="p-4 text-sm whitespace-pre-wrap" dir={contentDir} style={contentStyle}>
            <div className="text-xs uppercase text-slate-400 mb-1" dir="ltr">
              {colLabelB}
            </div>
            {change.changeType === 'MODIFIED' && change.wordLevelDiff ? (
              <span>
                {change.wordLevelDiff.map((p, i) =>
                  p.removed ? null : (
                    <span key={i} className={p.added ? 'bg-emerald-100 text-emerald-800' : ''}>
                      {p.value}
                    </span>
                  ),
                )}
              </span>
            ) : (
              <span className={change.changeType === 'ADDED' ? 'text-emerald-700' : ''}>
                {change.newText || <em className="text-slate-400">—</em>}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default DiffView;
