import { useEffect, useState } from 'react';
import { adminService, type AuditLogEntry } from '@/services/api/adminService';

interface Props {
  user: {
    id: string;
    email: string;
    first_name?: string;
    last_name?: string;
  } | null | undefined;
  topic: string;
}

/**
 * Right-side panel shown next to an OpsChatWindow. Surfaces useful
 * context about the user the ops member is talking to:
 *   – last 5 audit-log actions (read via existing /admin/audit-logs API)
 *   – topic of the chat (echoed for quick recall when scrolled)
 *
 * Project / contract counts intentionally omitted in v1: there is no
 * existing endpoint that returns "count of active projects/contracts
 * for an arbitrary user_id", and adding one is out-of-scope for this
 * iteration. The audit-log feed gives ops enough behavioral context to
 * triage most issues.
 */
export default function OpsUserContextPanel({ user, topic }: Props) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    adminService
      .getAuditLogs({ userId: user.id, limit: 5, page: 1 })
      .then((r) => !cancelled && setLogs(r.data))
      .catch(() => !cancelled && setLogs([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (!user) return null;

  const fullName =
    [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;

  return (
    <aside className="flex h-full w-72 flex-col border-l border-gray-200 bg-gray-50">
      {/* User card */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          User
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-900">
          {fullName}
        </div>
        <div className="text-xs text-gray-500">{user.email}</div>
      </div>

      {/* Topic */}
      <div className="border-b border-gray-200 bg-white px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Topic
        </div>
        <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
          {topic}
        </div>
      </div>

      {/* Recent activity */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Recent activity
        </div>
        {loading ? (
          <div className="text-xs text-gray-500">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="text-xs italic text-gray-500">No recorded activity.</div>
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => (
              <li
                key={log.id}
                className="rounded border border-gray-200 bg-white px-3 py-2 text-xs"
              >
                <div className="font-mono font-medium text-gray-800">
                  {log.action}
                </div>
                {log.entity_type && (
                  <div className="mt-0.5 text-gray-500">
                    {log.entity_type}
                    {log.entity_id ? ` · ${log.entity_id.slice(0, 8)}` : ''}
                  </div>
                )}
                <div className="mt-1 text-[10px] text-gray-400">
                  {new Date(log.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
