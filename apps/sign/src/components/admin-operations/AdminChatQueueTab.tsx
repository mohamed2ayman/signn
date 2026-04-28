import { useCallback, useEffect, useState } from 'react';
import {
  supportChatService,
  type QueueEntry,
} from '@/services/api/supportChatService';
import { useOpsQueueSocket } from './useOpsQueueSocket';

interface Props {
  /** Called when an ops member opens a chat (from queue or after claim). */
  onOpenChat: (chatId: string) => void;
}

/**
 * Live list of WAITING chats for the caller's org. Refetches whenever the
 * gateway emits `support:queue_update`. Each row offers a Claim button that
 * assigns the chat to the caller and pivots into the OpsChatWindow.
 */
export default function AdminChatQueueTab({ onOpenChat }: Props) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const refetch = useCallback(() => {
    supportChatService.ops
      .queue()
      .then(setQueue)
      .catch(() => setQueue([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useOpsQueueSocket(refetch);

  const handleClaim = async (id: string) => {
    setClaiming(id);
    try {
      await supportChatService.ops.claim(id);
      onOpenChat(id);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Could not claim chat');
    } finally {
      setClaiming(null);
    }
  };

  const formatWait = (ms: number) => {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 1) return '< 1 min';
    return `${minutes} min`;
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Waiting queue ({queue.length})
        </h3>
        <button
          onClick={refetch}
          className="text-xs text-primary hover:underline"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="p-6 text-center text-sm italic text-gray-500">
          No chats waiting. New chats will appear here in real time.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">User</th>
              <th className="px-4 py-2 text-left font-medium">Topic</th>
              <th className="px-4 py-2 text-left font-medium">Queued</th>
              <th className="px-4 py-2 text-left font-medium">Est. wait</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {queue.map((c) => (
              <tr key={c.id} className="border-t border-gray-100">
                <td className="px-4 py-2">
                  <div className="font-medium text-gray-900">
                    {c.user?.first_name} {c.user?.last_name}
                  </div>
                  <div className="text-xs text-gray-500">{c.user?.email}</div>
                </td>
                <td className="px-4 py-2 text-gray-700">
                  <div className="line-clamp-2 max-w-md">{c.topic}</div>
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {c.queued_at
                    ? new Date(c.queued_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </td>
                <td className="px-4 py-2 text-xs text-gray-700">
                  #{c.queue_position} · {formatWait(c.estimated_wait_ms)}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleClaim(c.id)}
                    disabled={claiming === c.id}
                    className="rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                  >
                    {claiming === c.id ? 'Claiming…' : 'Claim'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
