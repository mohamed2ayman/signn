import { useCallback, useEffect, useState } from 'react';
import {
  supportChatService,
  type SupportChat,
} from '@/services/api/supportChatService';

interface Props {
  onOpenChat: (chatId: string) => void;
}

/**
 * Caller's currently ACTIVE chats. Polled (no socket needed — assignments
 * arrive via REST claim/transfer responses, and the user-facing message
 * volume is the live signal once a chat is open).
 */
export default function AdminActiveChatsTab({ onOpenChat }: Props) {
  const [chats, setChats] = useState<SupportChat[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    supportChatService.ops
      .activeForMe()
      .then(setChats)
      .catch(() => setChats([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 15_000);
    return () => clearInterval(interval);
  }, [refetch]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          My active chats ({chats.length})
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
      ) : chats.length === 0 ? (
        <div className="p-6 text-center text-sm italic text-gray-500">
          No active chats. Claim one from the queue to get started.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {chats.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
            >
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {c.user?.first_name} {c.user?.last_name}
                </div>
                <div className="text-xs text-gray-500">
                  {c.user?.email} · {c.status}
                </div>
                <div className="mt-0.5 line-clamp-1 max-w-2xl text-xs text-gray-600">
                  {c.topic}
                </div>
              </div>
              <button
                onClick={() => onOpenChat(c.id)}
                className="rounded border border-primary bg-white px-3 py-1 text-xs font-medium text-primary hover:bg-primary/5"
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
