import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import adminSecurityService, { type AuditRow } from '@/services/api/adminSecurityService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

const PAGE_SIZE = 50;

/**
 * /admin/security/audit — security.* audit log (login successes/failures,
 * MFA changes, password resets, settings changes, GDPR actions).
 */
export default function AdminSecurityAuditPage() {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-security-audit', search, actionFilter, offset],
    queryFn: () =>
      adminSecurityService.listAudit({
        search: search || undefined,
        action: actionFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Security Audit Log</h1>
        <p className="mt-1 text-sm text-gray-600">
          Append-only feed of all security-grade events on the platform.
        </p>
      </header>

      <div className="mb-4 flex gap-3">
        <input
          type="text"
          placeholder="Search action or IP…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value);
            setOffset(0);
          }}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All actions</option>
          <option value="security.login_success">Login success</option>
          <option value="security.login_failed">Login failed</option>
          <option value="security.suspicious_login">Suspicious login</option>
          <option value="security.account_locked">Account locked</option>
          <option value="security.mfa_reset">MFA reset</option>
          <option value="security.mfa_enabled">MFA enabled</option>
          <option value="security.password_changed">Password changed</option>
          <option value="security.session_revoked">Session revoked</option>
          <option value="security.ip_blocked">IP blocked</option>
          <option value="security.settings_changed">Settings changed</option>
          <option value="security.gdpr_export">GDPR export</option>
          <option value="security.gdpr_delete">GDPR delete</option>
        </select>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="p-12">
            <LoadingSpinner />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">No matching events.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">IP</th>
                <th className="px-4 py-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.rows.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= data.total}
              className="rounded border border-gray-300 px-3 py-1 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ row }: { row: AuditRow }) {
  const actionPill = badgeFor(row.action);
  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-2 text-gray-500" title={format(new Date(row.created_at), 'PPpp')}>
        {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
      </td>
      <td className="px-4 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${actionPill}`}>
          {row.action.replace(/^security\./, '')}
        </span>
      </td>
      <td className="px-4 py-2 text-gray-700">{row.actor?.email ?? 'system'}</td>
      <td className="px-4 py-2 font-mono text-xs text-gray-600">{row.ip_address ?? '—'}</td>
      <td className="px-4 py-2 max-w-[260px] truncate text-xs text-gray-600">
        {row.metadata ? JSON.stringify(row.metadata) : '—'}
      </td>
    </tr>
  );
}

function badgeFor(action: string) {
  if (action.includes('failed') || action.includes('locked') || action.includes('blocked') || action.includes('suspicious')) {
    return 'bg-red-100 text-red-700';
  }
  if (action.includes('mfa') || action.includes('password')) {
    return 'bg-indigo-100 text-indigo-700';
  }
  if (action.includes('login_success')) {
    return 'bg-green-100 text-green-700';
  }
  if (action.includes('settings')) {
    return 'bg-yellow-100 text-yellow-700';
  }
  return 'bg-gray-100 text-gray-700';
}
