import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import adminSecurityService from '@/services/api/adminSecurityService';
import LoadingSpinner from '@/components/common/LoadingSpinner';

/**
 * /admin/security/overview — at-a-glance security posture for system admins.
 *
 * Three cards:
 *   1. Security Score (0-100 with grade + components + recommendations)
 *   2. Active Suspicious Sessions banner
 *   3. Recent Blocked IP attempts
 */
export default function AdminSecurityDashboardPage() {
  const score = useQuery({
    queryKey: ['admin-security-score'],
    queryFn: adminSecurityService.getScore,
    refetchInterval: 60_000,
  });
  const suspicious = useQuery({
    queryKey: ['admin-security-suspicious'],
    queryFn: adminSecurityService.listSuspicious,
    refetchInterval: 30_000,
  });
  const blocked = useQuery({
    queryKey: ['admin-security-blocked'],
    queryFn: () => adminSecurityService.listBlocked(20),
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Security Overview</h1>
        <p className="mt-1 text-sm text-gray-600">
          Real-time view of platform security posture, threats in flight, and blocked traffic.
        </p>
      </header>

      {suspicious.data && suspicious.data.count > 0 && (
        <div className="mb-6 rounded-xl border-l-4 border-red-500 bg-red-50 p-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h2 className="text-sm font-bold text-red-900">
                {suspicious.data.count} active suspicious session
                {suspicious.data.count === 1 ? '' : 's'}
              </h2>
              <p className="mt-0.5 text-xs text-red-700">
                Review the list below and revoke anything that looks unsafe.
              </p>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Security Score</h2>
          {score.data && (
            <span className="text-xs text-gray-500">
              Recomputed {formatDistanceToNow(new Date(score.data.computed_at), { addSuffix: true })}
            </span>
          )}
        </div>
        {score.isLoading || !score.data ? (
          <LoadingSpinner />
        ) : (
          <>
            <div className="mb-6 flex items-center gap-6">
              <div
                className={`flex h-24 w-24 items-center justify-center rounded-full text-3xl font-bold ${gradeColor(
                  score.data.grade,
                )}`}
              >
                {score.data.score}
              </div>
              <div>
                <div className={`text-2xl font-bold ${gradeText(score.data.grade)}`}>
                  Grade {score.data.grade}
                </div>
                <p className="text-sm text-gray-600">out of 100</p>
              </div>
            </div>
            <ul className="divide-y divide-gray-100">
              {score.data.components.map((c) => {
                const earned = Math.round(c.score * c.weight);
                return (
                  <li key={c.key} className="py-3">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-sm font-semibold text-gray-900">{c.label}</h3>
                      <span className="text-xs font-medium text-gray-500">
                        {earned} / {c.weight} pts
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={c.score >= 1 ? 'bg-green-500' : c.score >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}
                        style={{ width: `${Math.round(c.score * 100)}%`, height: '100%' }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-gray-600">{c.detail}</p>
                    {c.recommendation && (
                      <p className="mt-0.5 text-xs italic text-indigo-700">→ {c.recommendation}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Suspicious sessions ({suspicious.data?.count ?? 0})
        </h2>
        {suspicious.isLoading ? (
          <LoadingSpinner />
        ) : !suspicious.data || suspicious.data.sessions.length === 0 ? (
          <p className="text-sm text-gray-500">No active suspicious sessions.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {suspicious.data.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {s.user?.email ?? s.user_id}
                  </div>
                  <div className="text-xs text-gray-500">
                    {(s.suspicious_reason ?? 'flagged').replace(/_/g, ' ').toLowerCase()} · {s.location ?? 'unknown'} · {s.ip_address}
                  </div>
                </div>
                <span className="text-xs text-gray-400">
                  {format(new Date(s.created_at), 'dd MMM HH:mm')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent blocked IPs</h2>
        {blocked.isLoading ? (
          <LoadingSpinner />
        ) : !blocked.data || blocked.data.length === 0 ? (
          <p className="text-sm text-gray-500">No blocked traffic in the last 24h.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-4">When</th>
                <th className="py-2 pr-4">IP</th>
                <th className="py-2 pr-4">Reason</th>
                <th className="py-2 pr-4">Email attempted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {blocked.data.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-4 text-gray-500">
                    {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-900">{row.ip_address}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                      {row.reason}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{row.attempted_email ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function gradeColor(g: 'A' | 'B' | 'C' | 'D' | 'F') {
  switch (g) {
    case 'A':
      return 'bg-green-100 text-green-700';
    case 'B':
      return 'bg-emerald-100 text-emerald-700';
    case 'C':
      return 'bg-yellow-100 text-yellow-700';
    case 'D':
      return 'bg-orange-100 text-orange-700';
    default:
      return 'bg-red-100 text-red-700';
  }
}
function gradeText(g: 'A' | 'B' | 'C' | 'D' | 'F') {
  switch (g) {
    case 'A':
      return 'text-green-700';
    case 'B':
      return 'text-emerald-700';
    case 'C':
      return 'text-yellow-700';
    case 'D':
      return 'text-orange-700';
    default:
      return 'text-red-700';
  }
}
