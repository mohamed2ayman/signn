import { useEffect, useState } from 'react';
import AvailabilityToggle from '@/components/admin-operations/AvailabilityToggle';
import AdminChatQueueTab from '@/components/admin-operations/AdminChatQueueTab';
import AdminActiveChatsTab from '@/components/admin-operations/AdminActiveChatsTab';
import AdminCsatAnalyticsTab from '@/components/admin-operations/AdminCsatAnalyticsTab';
import OpsChatWindow from '@/components/admin-operations/OpsChatWindow';
import { supportSocketService } from '@/services/supportSocketService';

type Tab = 'queue' | 'active' | 'csat';

const TABS: { id: Tab; label: string }[] = [
  { id: 'queue', label: 'Chat queue' },
  { id: 'active', label: 'My active chats' },
  { id: 'csat', label: 'CSAT analytics' },
];

/**
 * Admin Operations dashboard — the home of live-chat support for ops
 * members. Three tabs (Queue / Active / CSAT) plus a global ONLINE/AWAY/
 * OFFLINE pill in the header.
 *
 * When ops opens a specific chat (via Claim or "Open" on Active tab),
 * the page swaps to a full-bleed OpsChatWindow until the user backs out.
 */
export default function AdminOperationsPage() {
  const [tab, setTab] = useState<Tab>('queue');
  const [openChatId, setOpenChatId] = useState<string | null>(null);

  // Connect the support socket on mount so ops auto-joins ops:queue:{orgId}
  // and starts receiving queue updates / note-added events. The user-side
  // widget will not be visible for ops users (LiveChatWidget hides for
  // SYSTEM_ADMIN/OPERATIONS), so this is the authoritative connection.
  useEffect(() => {
    try {
      supportSocketService.connect();
    } catch {
      /* token might still be loading — connect attempts retry on next nav */
    }
    return () => {
      supportSocketService.disconnect();
    };
  }, []);

  if (openChatId) {
    return (
      <div
        className="fixed inset-0 left-16 top-12 z-30 bg-white"
        // left=16 (64px sidebar) + top=12 (48px topbar) — matches AdminLayout offsets
      >
        <OpsChatWindow
          chatId={openChatId}
          onLeave={() => setOpenChatId(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Operations</h1>
          <p className="text-sm text-gray-500">
            Live support queue, your active chats, and CSAT analytics.
          </p>
        </div>
        <AvailabilityToggle />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div>
        {tab === 'queue' && <AdminChatQueueTab onOpenChat={setOpenChatId} />}
        {tab === 'active' && <AdminActiveChatsTab onOpenChat={setOpenChatId} />}
        {tab === 'csat' && <AdminCsatAnalyticsTab />}
      </div>
    </div>
  );
}
