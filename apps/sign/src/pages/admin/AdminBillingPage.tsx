import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Users,
  ChevronLeft,
  ChevronRight,
  Copy,
  Mail,
  Inbox,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import { adminService } from '@/services/api/adminService';
import type {
  BillingSummary,
  PaymentTransaction,
  PaymentTransactionListResponse,
  FailedPayment,
  TransactionsQueryParams,
} from '@/services/api/adminService';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const PLAN_PILL_COLORS = [
  { bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-200'    },
  { bg: 'bg-purple-50',  text: 'text-purple-700',  ring: 'ring-purple-200'  },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  { bg: 'bg-amber-50',   text: 'text-amber-800',   ring: 'ring-amber-200'   },
  { bg: 'bg-rose-50',    text: 'text-rose-700',    ring: 'ring-rose-200'    },
  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  ring: 'ring-indigo-200'  },
];

function planColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PLAN_PILL_COLORS[h % PLAN_PILL_COLORS.length];
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EGP: 'E£',
  SAR: '﷼',
  AED: 'د.إ',
  EUR: '€',
  GBP: '£',
};

function formatCurrency(amount: number, currency: string = 'USD'): string {
  const sym = CURRENCY_SYMBOLS[currency?.toUpperCase()] ?? (currency ? currency + ' ' : '');
  const formatted = amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sym}${formatted}`;
}

function formatCompactCurrency(amount: number, currency: string = 'USD'): string {
  const sym = CURRENCY_SYMBOLS[currency?.toUpperCase()] ?? '$';
  if (Math.abs(amount) >= 1_000_000) return `${sym}${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `${sym}${(amount / 1_000).toFixed(1)}K`;
  return `${sym}${amount.toFixed(0)}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return formatDistanceToNow(d, { addSuffix: true });
}

function statusBadge(status: string) {
  const s = status.toUpperCase();
  if (s === 'SUCCESS')
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (s === 'FAILED')
    return 'bg-red-50 text-red-700 ring-red-200';
  if (s === 'REFUNDED')
    return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-gray-100 text-gray-700 ring-gray-200';
}

async function copyToClipboard(text: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label);
  } catch {
    toast.error('Copy failed');
  }
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdminBillingPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<TransactionsQueryParams>({});
  const [draft, setDraft] = useState<TransactionsQueryParams>({});

  const appliedQuery: TransactionsQueryParams = useMemo(
    () => ({ ...filters, page, limit: PAGE_SIZE }),
    [filters, page],
  );

  const summaryQuery = useQuery<BillingSummary>({
    queryKey: ['admin', 'billing', 'summary'],
    queryFn: adminService.getBillingSummary,
    retry: 1,
  });

  const failedPaymentsQuery = useQuery<FailedPayment[]>({
    queryKey: ['admin', 'billing', 'failed-payments'],
    queryFn: adminService.getFailedPayments,
    retry: 1,
  });

  const txQuery = useQuery<PaymentTransactionListResponse>({
    queryKey: ['admin', 'billing', 'transactions', appliedQuery],
    queryFn: () => adminService.getTransactions(appliedQuery),
    retry: 1,
  });

  const summary = summaryQuery.data;
  const failedPayments = failedPaymentsQuery.data ?? [];
  const transactions = txQuery.data?.data ?? [];
  const total = txQuery.data?.total ?? 0;
  const totalPages = txQuery.data?.totalPages ?? 1;

  const primaryCurrency =
    summary?.revenueByCurrency?.[0]?.currency ?? 'USD';

  const applyFilters = () => {
    setFilters(draft);
    setPage(1);
  };

  const clearFilters = () => {
    setDraft({});
    setFilters({});
    setPage(1);
  };

  const handleExport = async () => {
    try {
      await adminService.exportTransactions(filters);
      toast.success('Export downloaded');
    } catch {
      toast.error('Export failed');
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Billing &amp; Payments</h1>
          <p className="mt-1 text-sm text-gray-500">
            Revenue overview and payment transaction management
          </p>
        </div>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Download className="h-4 w-4" />
          Export All
        </button>
      </div>

      {/* KPI Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryQuery.isLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : summaryQuery.isError || !summary ? (
          <div className="col-span-full rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Failed to load billing summary.{' '}
            <button
              onClick={() => summaryQuery.refetch()}
              className="font-medium underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <KpiCard
              icon={<DollarSign className="h-4 w-4 text-blue-600" />}
              iconBg="bg-blue-50"
              label="MRR"
              value={formatCurrency(summary.mrr, primaryCurrency)}
              changePercent={summary.mrrChange}
              subtitle="Monthly Recurring Revenue"
            />
            <KpiCard
              icon={<TrendingUp className="h-4 w-4 text-purple-600" />}
              iconBg="bg-purple-50"
              label="ARR"
              value={formatCurrency(summary.arr, primaryCurrency)}
              subtitle="Annual Recurring Revenue"
            />
            <KpiCard
              icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
              iconBg="bg-red-50"
              label="Failed Payments"
              value={
                <span className={summary.failedPaymentsCount > 0 ? 'text-red-600' : 'text-gray-500'}>
                  {summary.failedPaymentsCount}
                </span>
              }
              subtitle="Require follow-up"
              extra={
                summary.failedPaymentsCount > 0 ? (
                  <div className="text-xs text-red-600">
                    {formatCurrency(summary.failedPaymentsAmount, primaryCurrency)} total
                  </div>
                ) : null
              }
            />
            <KpiCard
              icon={<Users className="h-4 w-4 text-blue-600" />}
              iconBg="bg-blue-50"
              label="Active Subscriptions"
              value={<span className="text-blue-600">{summary.activeSubscriptions}</span>}
              subtitle="Paying organizations"
              extra={
                <div className="text-xs text-gray-500">
                  +{summary.newThisMonth} new · −{summary.churnedThisMonth} churned this month
                </div>
              }
            />
          </>
        )}
      </div>

      {/* Revenue panels */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Revenue by Plan">
          {summaryQuery.isLoading ? (
            <PanelSkeleton rows={3} />
          ) : !summary || summary.revenueByPlan.length === 0 ? (
            <div className="py-4 text-sm text-gray-500">No active subscriptions.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {summary.revenueByPlan.map((p) => {
                const pc = planColor(p.planName);
                return (
                  <li key={p.planName} className="flex items-center justify-between py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{p.planName}</div>
                      <div className="text-xs text-gray-500">
                        {p.subscribers} {p.subscribers === 1 ? 'subscriber' : 'subscribers'}
                      </div>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${pc.bg} ${pc.text} ${pc.ring}`}>
                      {formatCompactCurrency(p.revenue, primaryCurrency)}/mo
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Revenue by Currency">
          {summaryQuery.isLoading ? (
            <PanelSkeleton rows={3} />
          ) : !summary || summary.revenueByCurrency.length === 0 ? (
            <div className="py-4 text-sm text-gray-500">No revenue recorded.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {summary.revenueByCurrency.map((c) => (
                <li key={c.currency} className="flex items-center justify-between py-2.5">
                  <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-700">
                    {c.currency}
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    {formatCurrency(c.amount, c.currency)}/mo
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Failed Payments section — only when > 0 */}
      {summary && summary.failedPaymentsCount > 0 && failedPayments.length > 0 && (
        <div className="mb-6 overflow-hidden rounded-lg border border-amber-300 bg-amber-50">
          <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-100/60 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            <h2 className="text-sm font-semibold text-amber-900">
              Failed Payments Requiring Follow-up
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-amber-200 bg-white">
              <thead className="bg-amber-50/40 text-left text-xs font-medium uppercase tracking-wide text-amber-800">
                <tr>
                  <th className="px-4 py-2.5">Organization</th>
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Last Attempt</th>
                  <th className="px-4 py-2.5 text-center">Failures</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 text-sm">
                {failedPayments.map((f) => (
                  <tr key={f.organizationId} className="bg-white">
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {f.organizationName}
                    </td>
                    <td className="px-4 py-2.5">
                      {f.contactEmail ? (
                        <a
                          href={`mailto:${f.contactEmail}`}
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          <Mail className="h-3 w-3" />
                          {f.contactEmail}
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">No contact</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums text-red-700">
                      {formatCurrency(f.failedAmount, f.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {formatRelative(f.lastAttempt)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                        {f.failureCount}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {f.contactEmail ? (
                        <button
                          onClick={() => copyToClipboard(f.contactEmail!, 'Email copied')}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          <Copy className="h-3 w-3" />
                          Copy Email
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transactions section */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Transaction History</h2>
        </div>

        {/* Filter bar */}
        <div className="grid grid-cols-1 gap-3 border-b border-gray-200 px-4 py-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label className="mb-1 block text-xs font-medium text-gray-500">Organization ID</label>
            <input
              type="text"
              placeholder="UUID (optional)"
              value={draft.organizationId ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, organizationId: e.target.value || undefined }))}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Status</label>
            <select
              value={draft.status ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value || undefined }))}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILED">Failed</option>
              <option value="REFUNDED">Refunded</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Currency</label>
            <select
              value={draft.currency ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value || undefined }))}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All</option>
              <option value="USD">USD</option>
              <option value="EGP">EGP</option>
              <option value="SAR">SAR</option>
              <option value="AED">AED</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Start Date</label>
            <input
              type="date"
              value={draft.startDate ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value || undefined }))}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">End Date</label>
            <input
              type="date"
              value={draft.endDate ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value || undefined }))}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="col-span-full flex items-center gap-2">
            <button
              onClick={applyFilters}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Apply Filters
            </button>
            <button
              onClick={clearFilters}
              className="text-sm text-gray-500 underline hover:text-gray-700"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Table */}
        {txQuery.isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={6} />
          </div>
        ) : txQuery.isError ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <AlertTriangle className="h-8 w-8 text-red-500" />
            <p className="text-sm text-gray-700">Failed to load transactions.</p>
            <button
              onClick={() => txQuery.refetch()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        ) : transactions.length === 0 ? (
          <EmptyTransactions />
        ) : (
          <TransactionsTable transactions={transactions} />
        )}

        {/* Footer */}
        {!txQuery.isLoading && transactions.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-600">
              Showing{' '}
              <span className="font-medium text-gray-900">
                {(page - 1) * PAGE_SIZE + 1}-{(page - 1) * PAGE_SIZE + transactions.length}
              </span>{' '}
              of <span className="font-medium text-gray-900">{total}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExport}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Download className="h-3.5 w-3.5" />
                Export Filtered Results
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40 enabled:hover:bg-gray-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40 enabled:hover:bg-gray-50"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: React.ReactNode;
  subtitle: string;
  changePercent?: number;
  extra?: React.ReactNode;
}

function KpiCard({ icon, iconBg, label, value, subtitle, changePercent, extra }: KpiCardProps) {
  const showChange = typeof changePercent === 'number';
  const positive = (changePercent ?? 0) >= 0;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${iconBg}`}>{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
      {showChange && (
        <div className={`mt-1 flex items-center gap-1 text-xs font-medium ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
          {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {Math.abs(changePercent!).toFixed(1)}% vs last month
        </div>
      )}
      <div className="mt-1 text-xs text-gray-500">{subtitle}</div>
      {extra && <div className="mt-1">{extra}</div>}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-4">
      <div className="h-3 w-20 rounded bg-gray-200" />
      <div className="mt-3 h-7 w-28 rounded bg-gray-200" />
      <div className="mt-2 h-3 w-32 rounded bg-gray-200" />
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </div>
  );
}

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <div className="animate-pulse space-y-3 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <div>
            <div className="h-3 w-24 rounded bg-gray-200" />
            <div className="mt-1 h-2.5 w-16 rounded bg-gray-200" />
          </div>
          <div className="h-5 w-16 rounded-full bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

function TransactionsTable({ transactions }: { transactions: PaymentTransaction[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2.5">Date</th>
            <th className="px-4 py-2.5">Organization</th>
            <th className="px-4 py-2.5">Plan</th>
            <th className="px-4 py-2.5 text-right">Amount</th>
            <th className="px-4 py-2.5">Currency</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Transaction ID</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white text-sm text-gray-700">
          {transactions.map((t) => (
            <tr key={t.id} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(t.created_at)}</td>
              <td className="px-4 py-2.5 font-medium text-gray-900">{t.organizationName}</td>
              <td className="px-4 py-2.5">{t.plan_name || '—'}</td>
              <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                {formatCurrency(Number(t.amount), t.currency)}
              </td>
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-700">
                  {t.currency}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadge(t.status)}`}>
                  {t.status}
                </span>
              </td>
              <td className="px-4 py-2.5">
                {t.paymob_transaction_id ? (
                  <button
                    onClick={() => copyToClipboard(t.paymob_transaction_id!, 'Transaction ID copied')}
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs text-gray-600 hover:bg-gray-100"
                    title={`Click to copy: ${t.paymob_transaction_id}`}
                  >
                    <Copy className="h-3 w-3" />
                    {t.paymob_transaction_id.length > 12
                      ? t.paymob_transaction_id.slice(0, 12) + '…'
                      : t.paymob_transaction_id}
                  </button>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 rounded bg-gray-100" />
      ))}
    </div>
  );
}

function EmptyTransactions() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
        <Inbox className="h-6 w-6 text-blue-600" />
      </div>
      <p className="text-sm font-medium text-gray-900">No payment transactions recorded yet</p>
      <p className="max-w-sm text-xs text-gray-500">
        Transactions will appear here once organizations start subscribing via Paymob.
      </p>
    </div>
  );
}
