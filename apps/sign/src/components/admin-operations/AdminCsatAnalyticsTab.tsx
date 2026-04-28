import { useEffect, useState } from 'react';
import {
  supportChatService,
  type CsatStats,
} from '@/services/api/supportChatService';

const RATING_KEYS: Array<'1' | '2' | '3' | '4' | '5'> = ['5', '4', '3', '2', '1'];

export default function AdminCsatAnalyticsTab() {
  const [stats, setStats] = useState<CsatStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supportChatService.ops
      .csatStats()
      .then((s) => !cancelled && setStats(s))
      .catch(() => !cancelled && setStats(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }
  if (!stats) {
    return (
      <div className="p-6 text-sm italic text-gray-500">
        No CSAT data available.
      </div>
    );
  }

  const total = stats.total_responses;
  const max = Math.max(1, ...RATING_KEYS.map((k) => stats.distribution[k] ?? 0));

  return (
    <div className="space-y-4">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Metric
          label="Average rating"
          value={stats.average_rating != null ? stats.average_rating.toFixed(2) : '—'}
          suffix={stats.average_rating != null ? ' / 5' : ''}
        />
        <Metric label="Total responses" value={String(total)} />
        <Metric
          label="5-star responses"
          value={String(stats.distribution['5'] ?? 0)}
        />
      </div>

      {/* Histogram */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">
          Rating distribution
        </h3>
        <div className="space-y-2">
          {RATING_KEYS.map((k) => {
            const count = stats.distribution[k] ?? 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const barPct = (count / max) * 100;
            return (
              <div key={k} className="flex items-center gap-3 text-xs">
                <div className="w-8 text-right font-mono text-gray-700">
                  {k}★
                </div>
                <div className="h-3 flex-1 rounded bg-gray-100">
                  <div
                    className="h-3 rounded bg-primary"
                    style={{ width: `${barPct}%` }}
                  />
                </div>
                <div className="w-20 text-right text-gray-600">
                  {count} ({pct}%)
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent comments */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">
          Recent comments
        </h3>
        {stats.recent_comments.length === 0 ? (
          <div className="text-sm italic text-gray-500">No comments yet.</div>
        ) : (
          <ul className="space-y-3">
            {stats.recent_comments.map((c, i) => (
              <li
                key={`${c.chat_id}-${i}`}
                className="rounded border border-gray-200 px-3 py-2 text-sm"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-amber-500">
                    {'★'.repeat(c.rating)}
                    <span className="text-gray-300">
                      {'★'.repeat(5 - c.rating)}
                    </span>
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {new Date(c.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="text-gray-700">{c.comment}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-xs uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">
        {value}
        {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
      </div>
    </div>
  );
}
