import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  adminService,
  type OperationsReviewAsset,
  type OperationsReviewStats,
} from '@/services/api/adminService';

/* ═══════════════════════════════════════════════════════════════════════════
 *  AdminOperationsReviewPage
 *  /admin/operations-review — SYSTEM_ADMIN + OPERATIONS
 *
 *  Four stat cards + pending-review queue table, with individual row
 *  approve/reject, batch approve modal, and a threshold settings popover.
 * ═══════════════════════════════════════════════════════════════════════════ */

const QUERY_KEY_STATS = ['operations-review-stats'] as const;
const QUERY_KEY_QUEUE = ['operations-review-queue'] as const;

const PAGE_SIZE = 20;

/** Fallback when the backend has no AI-reviewed data yet (matches spec). */
const DEFAULT_AI_ACCURACY = 94.2;

// ─── Small helpers ─────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = d.toLocaleString('en-US', { month: 'short' });
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm} ${dd}, ${yyyy} ${hh}:${min}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ─── Category badge mapping ────────────────────────────────────────────────

type CategoryTone = {
  bg: string;
  text: string;
  label: string;
};

function categoryFromAsset(a: OperationsReviewAsset): CategoryTone {
  const raw = (a.tags && a.tags.length > 0 ? a.tags[0] : a.asset_type) || 'UNKNOWN';
  const key = String(raw).toUpperCase().replace(/[\s-]/g, '_');

  const map: Record<string, CategoryTone> = {
    LAW:                    { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Law' },
    INTERNATIONAL_STANDARD: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'International Standard' },
    RULE:                   { bg: 'bg-amber-100',  text: 'text-amber-700',  label: 'Rule' },
    TEMPLATE:               { bg: 'bg-teal-100',   text: 'text-teal-700',   label: 'Template' },
    CONTRACT_TEMPLATE:      { bg: 'bg-teal-100',   text: 'text-teal-700',   label: 'Template' },
    REGULATION:             { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Regulation' },
    SAFETY:                 { bg: 'bg-red-100',    text: 'text-red-700',    label: 'Safety' },
  };

  if (map[key]) return map[key];

  // Fall-back: humanize whatever we got.
  const label = key
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { bg: 'bg-gray-100', text: 'text-gray-700', label };
}

// ─── Confidence color dot ──────────────────────────────────────────────────

function confidenceTone(score: number | null): { dot: string; text: string } {
  if (score === null || Number.isNaN(score)) return { dot: 'bg-gray-300', text: 'text-gray-400' };
  if (score >= 95) return { dot: 'bg-green-500', text: 'text-green-700' };
  if (score >= 80) return { dot: 'bg-amber-500', text: 'text-amber-700' };
  return { dot: 'bg-red-500', text: 'text-red-700' };
}

// ─── Stat cards ────────────────────────────────────────────────────────────

type StatColor = 'amber' | 'green' | 'red' | 'blue';

const statRing: Record<StatColor, string> = {
  amber: 'bg-amber-50 text-amber-600',
  green: 'bg-green-50 text-green-600',
  red:   'bg-red-50 text-red-600',
  blue:  'bg-blue-50 text-blue-600',
};

const statText: Record<StatColor, string> = {
  amber: 'text-amber-600',
  green: 'text-green-600',
  red:   'text-red-600',
  blue:  'text-blue-600',
};

function StatCard({
  label,
  value,
  subtitle,
  color,
  icon,
  isLoading,
}: {
  label: string;
  value: string | number;
  subtitle: string;
  color: StatColor;
  icon: React.ReactNode;
  isLoading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-200/70 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${statRing[color]}`}>
          {icon}
        </div>
      </div>
      <p className={`mt-3 text-3xl font-bold ${statText[color]}`}>
        {isLoading ? '—' : value}
      </p>
      <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
    </div>
  );
}

// ─── Icons (inline SVG) ────────────────────────────────────────────────────

const IconClock = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const IconCheck = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12l5 5 9-11" />
  </svg>
);

const IconX = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

const IconChart = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 20h18M7 16V9m5 7V5m5 11v-6" />
  </svg>
);

const IconEye = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.25 12s3.75-7.5 9.75-7.5S21.75 12 21.75 12 18 19.5 12 19.5 2.25 12 2.25 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconGear = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.08a1.7 1.7 0 00-1-1.55 1.7 1.7 0 00-1.87.34l-.06.06A2 2 0 113.22 16.94l.06-.06a1.7 1.7 0 00.34-1.87 1.7 1.7 0 00-1.55-1H2a2 2 0 110-4h.08a1.7 1.7 0 001.55-1 1.7 1.7 0 00-.34-1.87l-.06-.06A2 2 0 117.06 3.22l.06.06a1.7 1.7 0 001.87.34H9a1.7 1.7 0 001-1.55V2a2 2 0 114 0v.08a1.7 1.7 0 001 1.55 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.87V9c.19.4.53.74 1 .97.26.12.55.18.84.18H22a2 2 0 110 4h-.08a1.7 1.7 0 00-1.55 1z" />
  </svg>
);

// ═══ MAIN PAGE ═══════════════════════════════════════════════════════════════

export default function AdminOperationsReviewPage() {
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showThreshold, setShowThreshold] = useState(false);
  const [drawerAsset, setDrawerAsset] = useState<OperationsReviewAsset | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  // ── Data queries ────────────────────────────────────────────────────────
  const statsQuery = useQuery<OperationsReviewStats>({
    queryKey: QUERY_KEY_STATS,
    queryFn: adminService.getOperationsReviewStats,
    refetchInterval: 30_000,
    retry: 1,
  });

  const queueQuery = useQuery({
    queryKey: [...QUERY_KEY_QUEUE, page],
    queryFn: () => adminService.getOperationsReviewQueue({ page, limit: PAGE_SIZE }),
    refetchInterval: 30_000,
    retry: 1,
  });

  const stats    = statsQuery.data;
  const queue    = queueQuery.data;
  const assets   = queue?.data ?? [];
  const total    = queue?.total ?? 0;
  const pending  = stats?.pendingCount ?? 0;

  // ── Actions ──────────────────────────────────────────────────────────────
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: QUERY_KEY_STATS });
    qc.invalidateQueries({ queryKey: QUERY_KEY_QUEUE });
  };

  const handleApprove = async (id: string) => {
    setRowBusy(id);
    try {
      await adminService.approveAsset(id);
      toast.success('Asset approved');
      invalidateAll();
    } catch {
      toast.error('Approval failed');
    } finally {
      setRowBusy(null);
    }
  };

  const openReject = (id: string) => {
    setRejectId(id);
    setRejectReason('');
  };

  const confirmReject = async () => {
    if (!rejectId) return;
    setRowBusy(rejectId);
    try {
      await adminService.rejectAsset(rejectId, rejectReason || undefined);
      toast.success('Asset rejected');
      setRejectId(null);
      setRejectReason('');
      invalidateAll();
    } catch {
      toast.error('Rejection failed');
    } finally {
      setRowBusy(null);
    }
  };

  // ── Pagination math ──────────────────────────────────────────────────────
  const totalPages = queue?.totalPages ?? 1;
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd   = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Operations Review Queue</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review and approve or reject AI-detected knowledge assets
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-600">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {pending} Pending Review
          </span>

          <button
            type="button"
            onClick={() => setShowBatchModal(true)}
            disabled={assets.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {IconCheck}
            Batch Review
          </button>

          <div className="relative">
            <button
              type="button"
              aria-label="Threshold settings"
              onClick={() => setShowThreshold((s) => !s)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50"
            >
              {IconGear}
            </button>
            {showThreshold && (
              <ThresholdPopover onClose={() => setShowThreshold(false)} />
            )}
          </div>
        </div>
      </div>

      {/* ─── Stat cards ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Pending Review"
          value={stats?.pendingCount ?? 0}
          subtitle="Assets awaiting review"
          color="amber"
          icon={IconClock}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="Approved Today"
          value={stats?.approvedToday ?? 0}
          subtitle="Assets approved"
          color="green"
          icon={IconCheck}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="Rejected Today"
          value={stats?.rejectedToday ?? 0}
          subtitle="Assets rejected"
          color="red"
          icon={IconX}
          isLoading={statsQuery.isLoading}
        />
        <StatCard
          label="AI Accuracy"
          value={`${(
            typeof stats?.aiAccuracyRate === 'number'
              ? stats.aiAccuracyRate
              : DEFAULT_AI_ACCURACY
          ).toFixed(1)}%`}
          subtitle="Detection accuracy"
          color="blue"
          icon={IconChart}
          isLoading={statsQuery.isLoading}
        />
      </div>

      {/* ─── Queue table ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200/70 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Assets Pending Review</h2>
          <span className="text-xs text-gray-500">
            {total > 0 ? `Showing ${rangeStart}-${rangeEnd} of ${total} assets` : ''}
          </span>
        </div>

        {queueQuery.isLoading ? (
          <QueueSkeleton />
        ) : queueQuery.isError ? (
          <ErrorState
            error={queueQuery.error}
            onRetry={() => queueQuery.refetch()}
          />
        ) : assets.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50/50">
                <tr>
                  <Th>Asset Title</Th>
                  <Th>Suggested Category</Th>
                  <Th>Confidence</Th>
                  <Th>Detection Date</Th>
                  <Th>Source</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assets.map((a) => (
                  <QueueRow
                    key={a.id}
                    asset={a}
                    isBusy={rowBusy === a.id}
                    onView={() => setDrawerAsset(a)}
                    onApprove={() => handleApprove(a.id)}
                    onReject={() => openReject(a.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-500">
              Showing {rangeStart}-{rangeEnd} of {total} assets
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs text-gray-500">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Detail drawer ────────────────────────────────────────────── */}
      {drawerAsset && (
        <AssetDrawer
          asset={drawerAsset}
          onClose={() => setDrawerAsset(null)}
          onApprove={async () => {
            await handleApprove(drawerAsset.id);
            setDrawerAsset(null);
          }}
          onReject={() => {
            openReject(drawerAsset.id);
            setDrawerAsset(null);
          }}
        />
      )}

      {/* ─── Reject-reason inline modal ──────────────────────────────── */}
      {rejectId && (
        <RejectModal
          reason={rejectReason}
          setReason={setRejectReason}
          busy={rowBusy === rejectId}
          onCancel={() => { setRejectId(null); setRejectReason(''); }}
          onConfirm={confirmReject}
        />
      )}

      {/* ─── Batch review modal ──────────────────────────────────────── */}
      {showBatchModal && (
        <BatchReviewModal
          assets={assets}
          onClose={() => setShowBatchModal(false)}
          onDone={() => {
            setShowBatchModal(false);
            invalidateAll();
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 ${className}`}>
      {children}
    </th>
  );
}

function QueueRow({
  asset,
  isBusy,
  onView,
  onApprove,
  onReject,
}: {
  asset: OperationsReviewAsset;
  isBusy: boolean;
  onView: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const cat = categoryFromAsset(asset);
  const tone = confidenceTone(asset.confidence_score);

  const subtitle =
    asset.page_count != null
      ? `${asset.page_count} pages • ${asset.language}`
      : asset.language;

  return (
    <tr className={`${isBusy ? 'opacity-50' : ''} transition`}>
      <td className="px-5 py-3">
        <p className="text-sm font-semibold text-gray-900">{asset.title}</p>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </td>

      <td className="px-5 py-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cat.bg} ${cat.text}`}>
          {cat.label}
        </span>
      </td>

      <td className="px-5 py-3">
        {asset.confidence_score === null ? (
          <span className="text-sm text-gray-400">—</span>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
            <span className={`font-medium ${tone.text}`}>
              {asset.confidence_score.toFixed(1)}%
            </span>
          </span>
        )}
      </td>

      <td className="px-5 py-3 text-sm text-gray-600">
        {formatDate(asset.created_at)}
      </td>

      <td className="px-5 py-3 text-sm text-gray-600">
        {asset.source ? truncate(asset.source, 30) : '—'}
      </td>

      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onView}
            disabled={isBusy}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="View details"
          >
            {IconEye}
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={isBusy}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {IconCheck}
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={isBusy}
            className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {IconX}
            Reject
          </button>
        </div>
      </td>
    </tr>
  );
}

function QueueSkeleton() {
  return (
    <div className="divide-y divide-gray-100">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-4 flex-1 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-16 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
          <div className="h-7 w-40 animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-600">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5 9-11" />
        </svg>
      </div>
      <h3 className="mt-4 text-base font-semibold text-gray-900">All caught up!</h3>
      <p className="mt-1 text-sm text-gray-500">No assets are pending review at this time.</p>
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  // Surface the real cause (HTTP status + server message) so transient 401/403
  // or network issues are debuggable rather than showing a generic banner.
  const detail = describeError(error);
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-sm font-semibold text-red-600">Failed to load review queue</p>
      {detail && (
        <p className="mt-1 max-w-md text-xs text-gray-500">{detail}</p>
      )}
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
      >
        Retry
      </button>
    </div>
  );
}

function describeError(err: unknown): string {
  if (!err) return '';
  // Axios shape — response.status + response.data.message
  const maybeAxios = err as {
    response?: { status?: number; data?: { message?: string } };
    message?: string;
  };
  const status = maybeAxios.response?.status;
  const serverMsg = maybeAxios.response?.data?.message;
  if (status && serverMsg) return `HTTP ${status} — ${serverMsg}`;
  if (status)              return `HTTP ${status}`;
  return maybeAxios.message ?? 'Unknown error';
}

// ─── Reject modal (reason is optional) ─────────────────────────────────────

function RejectModal({
  reason,
  setReason,
  busy,
  onCancel,
  onConfirm,
}: {
  reason: string;
  setReason: (s: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">Reject Asset</h3>
        <p className="mt-1 text-sm text-gray-500">
          Optionally, provide a reason. This will be visible to the uploader.
        </p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Reason (optional)"
          className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Detail drawer ─────────────────────────────────────────────────────────

function AssetDrawer({
  asset,
  onClose,
  onApprove,
  onReject,
}: {
  asset: OperationsReviewAsset;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const cat = categoryFromAsset(asset);
  const tone = confidenceTone(asset.confidence_score);
  const langs = asset.detected_languages ?? [asset.language];

  return (
    <div className="fixed inset-0 z-[90] flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-lg overflow-y-auto bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">Asset Details</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            {IconX}
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div>
            <h4 className="text-lg font-semibold text-gray-900">{asset.title}</h4>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cat.bg} ${cat.text}`}>
                {cat.label}
              </span>
              {asset.jurisdiction && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-700">
                  {asset.jurisdiction}
                </span>
              )}
            </div>
          </div>

          <DetailRow label="Type" value={asset.asset_type} />
          <DetailRow
            label="Tags"
            value={asset.tags && asset.tags.length > 0 ? asset.tags.join(', ') : '—'}
          />
          <DetailRow
            label="Source"
            value={asset.source ?? '—'}
          />
          <DetailRow
            label="Confidence"
            value={
              asset.confidence_score === null ? (
                '—'
              ) : (
                <span className="inline-flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                  <span className={`font-medium ${tone.text}`}>
                    {asset.confidence_score.toFixed(1)}%
                  </span>
                </span>
              )
            }
          />

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Languages</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {langs.map((l) => (
                <span key={l} className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                  {l}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">AI Flags</p>
            <div className="mt-1.5 space-y-1.5 text-sm">
              <div className="flex items-center gap-2">
                <FlagDot on={asset.include_in_risk_analysis} />
                <span className="text-gray-700">Include in Risk Analysis</span>
              </div>
              <div className="flex items-center gap-2">
                <FlagDot on={asset.include_in_citations} />
                <span className="text-gray-700">Include in Chat Citations</span>
              </div>
            </div>
          </div>

          {asset.file_url && (
            <DetailRow
              label="File"
              value={
                <a
                  href={asset.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-primary-600 hover:underline"
                >
                  Open file
                </a>
              }
            />
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-gray-100 bg-white px-5 py-3">
          <button
            type="button"
            onClick={onReject}
            className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            {IconX}
            Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
          >
            {IconCheck}
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm text-gray-800">{value}</p>
    </div>
  );
}

function FlagDot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${
        on ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${on ? 'bg-green-500' : 'bg-gray-300'}`} />
    </span>
  );
}

// ─── Batch review modal ────────────────────────────────────────────────────

function BatchReviewModal({
  assets,
  onClose,
  onDone,
}: {
  assets: OperationsReviewAsset[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [threshold, setThreshold] = useState(90);
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(
    () => assets.filter((a) => (a.confidence_score ?? 0) >= threshold),
    [assets, threshold],
  );

  const handleConfirm = async () => {
    if (filtered.length === 0) return;
    setSubmitting(true);
    try {
      const res = await adminService.batchReviewAssets({
        assetIds: filtered.map((a) => a.id),
        action: 'APPROVE',
      });
      toast.success(
        `${res.processed} approved${res.failed > 0 ? `, ${res.failed} failed` : ''}`,
      );
      onDone();
    } catch {
      toast.error('Batch approval failed');
    } finally {
      setSubmitting(false);
    }
  };

  const preview = filtered.slice(0, 5);
  const extra   = filtered.length - preview.length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-900">Batch Review Assets</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            {IconX}
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Select assets with confidence above{' '}
              <span className="font-semibold text-primary-600">{threshold}%</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="mt-2 w-full"
            />
            <p className="mt-1 text-xs text-gray-500">
              {filtered.length} {filtered.length === 1 ? 'asset' : 'assets'} will be approved
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            {preview.length === 0 ? (
              <p className="text-xs text-gray-500">No assets match this threshold.</p>
            ) : (
              <ul className="space-y-1.5">
                {preview.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-xs">
                    <span className="truncate text-gray-700">{a.title}</span>
                    <span className="ml-2 font-medium text-gray-500">
                      {a.confidence_score !== null ? `${a.confidence_score.toFixed(1)}%` : '—'}
                    </span>
                  </li>
                ))}
                {extra > 0 && (
                  <li className="text-xs text-gray-500">+ {extra} more</li>
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-200 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || filtered.length === 0}
            className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Approving…' : `Approve ${filtered.length} Assets`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Threshold popover ─────────────────────────────────────────────────────

function ThresholdPopover({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['confidence-threshold'],
    queryFn: adminService.getConfidenceThreshold,
  });

  const [value, setValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const current = data?.threshold ?? 90;
  const effectiveValue = value ?? current;

  const save = async () => {
    setSaving(true);
    try {
      await adminService.setConfidenceThreshold(effectiveValue);
      toast.success('Threshold saved');
      qc.invalidateQueries({ queryKey: ['confidence-threshold'] });
      onClose();
    } catch {
      toast.error('Failed to save threshold');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute right-0 top-full z-[70] mt-2 w-72 rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
      <h4 className="text-sm font-semibold text-gray-900">Auto-approve Threshold</h4>
      <p className="mt-1 text-xs text-gray-500">
        Assets detected with confidence above this percentage will be flagged for priority review.
      </p>
      <div className="mt-3">
        <input
          type="number"
          min={0}
          max={100}
          value={effectiveValue}
          onChange={(e) => setValue(Number(e.target.value))}
          disabled={isLoading}
          className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
        />
        <p className="mt-1 text-[11px] text-gray-400">
          Current: {current}%
        </p>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || isLoading}
          className="rounded-md bg-primary-600 px-3 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
