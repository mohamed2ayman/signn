import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import {
  adminService,
  type AuditLogEntry,
  type AuditLogQuery,
} from '@/services/api/adminService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function httpMethod(action: string): string {
  return action.split(' ')[0] ?? action;
}

function actionBadge(action: string) {
  const method = httpMethod(action);
  const cfg: Record<string, { bg: string; text: string; label: string }> = {
    POST:   { bg: 'bg-green-100',  text: 'text-green-700',  label: 'CREATE' },
    PUT:    { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'UPDATE' },
    PATCH:  { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'UPDATE' },
    DELETE: { bg: 'bg-red-100',    text: 'text-red-700',    label: 'DELETE' },
    GET:    { bg: 'bg-gray-100',   text: 'text-gray-600',   label: 'READ'   },
  };
  const c = cfg[method] ?? { bg: 'bg-gray-100', text: 'text-gray-600', label: method };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function initials(user: AuditLogEntry['user']): string {
  if (!user) return '?';
  return `${user.first_name?.[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase() || '?';
}

function truncateId(id: string | null): string {
  if (!id) return '—';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function formatTs(iso: string) {
  const d = new Date(iso);
  return formatDistanceToNow(d, { addSuffix: true });
}

function fullTs(iso: string) {
  return format(new Date(iso), 'dd MMM yyyy, HH:mm:ss');
}

// ─── JSON Diff Viewer ─────────────────────────────────────────────────────────

function JsonDiffViewer({
  oldValues,
  newValues,
}: {
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}) {
  if (!oldValues && !newValues) {
    return <p className="text-sm text-gray-400 italic">No change data recorded.</p>;
  }

  const allKeys = Array.from(
    new Set([
      ...Object.keys(oldValues ?? {}),
      ...Object.keys(newValues ?? {}),
    ]),
  ).sort();

  const changed = (key: string) =>
    JSON.stringify((oldValues ?? {})[key]) !==
    JSON.stringify((newValues ?? {})[key]);

  const renderVal = (v: unknown) => {
    if (v === undefined) return <span className="italic text-gray-300">—</span>;
    if (v === null) return <span className="italic text-gray-400">null</span>;
    const s = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    return <span className="break-all font-mono text-[11px]">{s}</span>;
  };

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      {/* Header */}
      <div className="grid grid-cols-[1fr_1fr_1fr] border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
        <span>Field</span>
        <span className="border-l border-gray-200 pl-3">Before</span>
        <span className="border-l border-gray-200 pl-3">After</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-gray-100">
        {allKeys.map((key) => {
          const isChanged = changed(key);
          return (
            <div
              key={key}
              className={`grid grid-cols-[1fr_1fr_1fr] px-3 py-2 text-xs ${
                isChanged ? 'bg-amber-50' : ''
              }`}
            >
              <span className={`font-medium ${isChanged ? 'text-amber-700' : 'text-gray-600'}`}>
                {key}
                {isChanged && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
                )}
              </span>
              <div className={`border-l border-gray-200 pl-3 ${isChanged ? 'text-red-700 line-through decoration-red-300' : 'text-gray-500'}`}>
                {renderVal((oldValues ?? {})[key])}
              </div>
              <div className={`border-l border-gray-200 pl-3 ${isChanged ? 'text-green-700 font-medium' : 'text-gray-500'}`}>
                {renderVal((newValues ?? {})[key])}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function AuditDrawer({
  log,
  onClose,
}: {
  log: AuditLogEntry;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-[480px] flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Audit Log Detail</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{log.id}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {/* Meta */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Event</h3>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Timestamp</dt>
                <dd className="text-gray-900 font-medium">{fullTs(log.created_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Action</dt>
                <dd className="font-mono text-xs text-gray-700 break-all text-right max-w-[260px]">
                  {log.action}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Entity Type</dt>
                <dd className="text-gray-900">{log.entity_type ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-gray-500">Entity ID</dt>
                <dd className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-gray-700">
                    {log.entity_id ?? '—'}
                  </span>
                  {log.entity_id && (
                    <button
                      onClick={() => copyToClipboard(log.entity_id!)}
                      className="text-gray-400 hover:text-gray-600"
                      title="Copy"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  )}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">IP Address</dt>
                <dd className="font-mono text-xs text-gray-700">{log.ip_address ?? '—'}</dd>
              </div>
            </dl>
          </section>

          {/* Actor */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Actor</h3>
            {log.user ? (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Name</dt>
                  <dd className="text-gray-900">{log.user.first_name} {log.user.last_name}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Email</dt>
                  <dd className="text-gray-700">{log.user.email}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500">User ID</dt>
                  <dd className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-gray-500">{log.user_id}</span>
                    <button
                      onClick={() => copyToClipboard(log.user_id!)}
                      className="text-gray-400 hover:text-gray-600"
                      title="Copy"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-gray-400 italic">System / unauthenticated</p>
            )}
          </section>

          {/* Organization */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Organization</h3>
            {log.organization ? (
              <p className="text-sm text-gray-900">{log.organization.name}</p>
            ) : (
              <p className="text-sm text-gray-400 italic">—</p>
            )}
          </section>

          {/* Changes diff */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Changes
              {log.old_values || log.new_values ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Diff
                </span>
              ) : null}
            </h3>
            <JsonDiffViewer oldValues={log.old_values} newValues={log.new_values} />
          </section>
        </div>
      </div>
    </>
  );
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function toCsv(rows: AuditLogEntry[]): string {
  const headers = [
    'Timestamp', 'User Email', 'User Name', 'Organization',
    'Action', 'Entity Type', 'Entity ID', 'IP Address',
  ];
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((r) => [
    r.created_at,
    r.user?.email ?? '',
    r.user ? `${r.user.first_name} ${r.user.last_name}` : '',
    r.organization?.name ?? '',
    r.action,
    r.entity_type ?? '',
    r.entity_id ?? '',
    r.ip_address ?? '',
  ].map(escape).join(','));
  return [headers.map(escape).join(','), ...lines].join('\n');
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

const EMPTY_FILTERS: AuditLogQuery = {
  organizationId: undefined,
  userId: undefined,
  action: undefined,
  entityType: undefined,
  startDate: undefined,
  endDate: undefined,
  page: 1,
  limit: 50,
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminAuditLogPage() {
  const [filters, setFilters] = useState<AuditLogQuery>(EMPTY_FILTERS);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [exporting, setExporting] = useState(false);

  // ── Local (uncommitted) filter state so we don't fire on every keystroke
  const [draft, setDraft] = useState<AuditLogQuery>(EMPTY_FILTERS);

  const applyFilters = useCallback(() => {
    setFilters({ ...draft, page: 1 });
  }, [draft]);

  const clearFilters = useCallback(() => {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  }, []);

  // ── Filter options
  const { data: filterOptions } = useQuery({
    queryKey: ['admin', 'audit-log-filters'],
    queryFn: adminService.getAuditLogFilters,
    staleTime: 5 * 60_000,
  });

  // ── Main data
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'audit-logs', filters],
    queryFn: () => adminService.getAuditLogs(filters),
    placeholderData: (prev) => prev,
  });

  const logs    = data?.data ?? [];
  const total   = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const currentPage = filters.page ?? 1;

  // ── Export
  const handleExport = async () => {
    setExporting(true);
    try {
      const allRows = await adminService.exportAuditLogs({
        organizationId: filters.organizationId,
        userId:         filters.userId,
        action:         filters.action,
        entityType:     filters.entityType,
        startDate:      filters.startDate,
        endDate:        filters.endDate,
      });
      const csv = toCsv(allRows);
      const ts  = format(new Date(), 'yyyyMMdd-HHmmss');
      downloadCsv(csv, `audit-log-${ts}.csv`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="mt-1 text-sm text-gray-500">
            Full history of all system actions across all organizations.
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || total === 0}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {exporting ? (
            <LoadingSpinner size="sm" />
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          )}
          Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">

          {/* Organization */}
          <div className="flex min-w-[180px] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Organization</label>
            <select
              value={draft.organizationId ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, organizationId: e.target.value || undefined }))}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All organizations</option>
              {filterOptions?.organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          {/* User ID */}
          <div className="flex min-w-[160px] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">User ID</label>
            <input
              type="text"
              placeholder="Paste UUID…"
              value={draft.userId ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, userId: e.target.value || undefined }))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Action */}
          <div className="flex min-w-[150px] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Action</label>
            <select
              value={draft.action ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value || undefined }))}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All actions</option>
              {filterOptions?.actions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* Entity type */}
          <div className="flex min-w-[150px] flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Entity Type</label>
            <select
              value={draft.entityType ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, entityType: e.target.value || undefined }))}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All types</option>
              {filterOptions?.entityTypes.map((et) => (
                <option key={et} value={et}>{et}</option>
              ))}
            </select>
          </div>

          {/* Start date */}
          <div className="flex min-w-[140px] flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">From</label>
            <input
              type="date"
              value={draft.startDate ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value || undefined }))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* End date */}
          <div className="flex min-w-[140px] flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">To</label>
            <input
              type="date"
              value={draft.endDate ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value || undefined }))}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={applyFilters}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
            >
              Apply
            </button>
            <button
              onClick={clearFilters}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Result count */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          {isLoading ? 'Loading…' : `${total.toLocaleString()} event${total !== 1 ? 's' : ''}`}
        </span>
        {totalPages > 1 && (
          <span>Page {currentPage} of {totalPages}</span>
        )}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <LoadingSpinner size="lg" />
          </div>
        ) : isError ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-red-500">
            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm font-medium">Failed to load audit logs</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-1 text-gray-400">
            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
            <p className="text-sm">No audit log entries found.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity Type</th>
                <th className="px-4 py-3">Entity ID</th>
                <th className="px-4 py-3">Organization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className="cursor-pointer hover:bg-primary/[0.03] transition-colors"
                  onClick={() => setSelectedLog(log)}
                >
                  {/* Timestamp */}
                  <td className="px-4 py-3">
                    <span
                      className="text-sm text-gray-700"
                      title={fullTs(log.created_at)}
                    >
                      {formatTs(log.created_at)}
                    </span>
                  </td>

                  {/* User */}
                  <td className="px-4 py-3">
                    {log.user ? (
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                          {initials(log.user)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {log.user.first_name} {log.user.last_name}
                          </p>
                          <p className="truncate text-xs text-gray-400">{log.user.email}</p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm italic text-gray-400">System</span>
                    )}
                  </td>

                  {/* Action */}
                  <td className="px-4 py-3">
                    {actionBadge(log.action)}
                  </td>

                  {/* Entity type */}
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-700">{log.entity_type ?? '—'}</span>
                  </td>

                  {/* Entity ID */}
                  <td className="px-4 py-3">
                    <button
                      title={log.entity_id ?? undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (log.entity_id) copyToClipboard(log.entity_id);
                      }}
                      className="font-mono text-xs text-gray-500 hover:text-primary"
                    >
                      {truncateId(log.entity_id)}
                    </button>
                  </td>

                  {/* Organization */}
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-700">
                      {log.organization?.name ?? '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            disabled={currentPage <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Previous
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              // Show pages around current page
              let p: number;
              if (totalPages <= 7) {
                p = i + 1;
              } else if (currentPage <= 4) {
                p = i + 1;
              } else if (currentPage >= totalPages - 3) {
                p = totalPages - 6 + i;
              } else {
                p = currentPage - 3 + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => setFilters((f) => ({ ...f, page: p }))}
                  className={`h-8 w-8 rounded-lg text-sm font-medium transition-colors ${
                    p === currentPage
                      ? 'bg-primary text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <button
            disabled={currentPage >= totalPages}
            onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Detail drawer */}
      {selectedLog && (
        <AuditDrawer log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </div>
  );
}
