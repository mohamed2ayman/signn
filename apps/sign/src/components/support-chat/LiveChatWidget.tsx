import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@/store';
import {
  setOpen,
  setActiveChat,
  setMessages,
  appendMessage,
} from '@/store/slices/supportChatSlice';
import { supportChatService } from '@/services/api/supportChatService';
import { supportSocketService } from '@/services/supportSocketService';
import { useSupportChatSocket } from './useSupportChatSocket';
import LiveChatStartForm from './LiveChatStartForm';
import LiveChatWindow from './LiveChatWindow';

const OPS_ROLES = new Set(['SYSTEM_ADMIN', 'OPERATIONS']);

/**
 * Floating bottom-right Live Chat launcher mounted on every /app/* page.
 *
 * Hidden for ops users — they reach support chats via /admin/operations.
 * Hidden when there is no auth token.
 *
 * Behavior:
 *   - Click the bubble → expand into the chat window.
 *   - If there is no active chat, render the topic form.
 *   - On submit, create the chat (status WAITING) and join its socket room.
 *   - Existing live socket events flow into Redux via useSupportChatSocket.
 */
export default function LiveChatWidget() {
  const dispatch = useDispatch();
  const { user, token } = useSelector((s: RootState) => s.auth);
  const { isOpen, activeChat } = useSelector((s: RootState) => s.supportChat);

  // Always wire socket lifecycle to the active chat (no-op if null).
  useSupportChatSocket(activeChat?.id ?? null);

  // On mount, look for an in-flight chat (WAITING/ACTIVE) so refresh restores it.
  useEffect(() => {
    if (!token || !user) return;
    if (OPS_ROLES.has(user.role)) return;

    let cancelled = false;
    (async () => {
      try {
        const mine = await supportChatService.getMyChats();
        const live = mine.find(
          (c) => c.status === 'WAITING' || c.status === 'ACTIVE',
        );
        if (cancelled || !live) return;
        const full = await supportChatService.getChat(live.id);
        if (cancelled) return;
        dispatch(setActiveChat(full));
        dispatch(setMessages(full.messages));
      } catch {
        /* ignore — widget is non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, user, dispatch]);

  // Disconnect socket on logout / unmount.
  useEffect(() => {
    return () => {
      supportSocketService.disconnect();
    };
  }, []);

  if (!token || !user) return null;
  if (OPS_ROLES.has(user.role)) return null;

  const handleStart = async (topic: string) => {
    try {
      const chat = await supportChatService.startChat(topic);
      // Insert a synthetic local welcome bubble while we wait.
      dispatch(setActiveChat(chat));
      dispatch(setMessages([]));
      dispatch(
        appendMessage({
          id: `local-${chat.id}`,
          chat_id: chat.id,
          sender_id: null,
          sender_role: 'SYSTEM',
          body: 'You are in the queue. An agent will be with you shortly.',
          attachment_url: null,
          attachment_name: null,
          attachment_mime: null,
          attachment_size: null,
          created_at: new Date().toISOString(),
        }),
      );
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Could not start chat');
    }
  };

  return (
    <>
      {/* Floating launcher (always visible) */}
      <button
        type="button"
        onClick={() => dispatch(setOpen(!isOpen))}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl text-white shadow-lg transition-transform hover:scale-105"
        aria-label={isOpen ? 'Close live chat' : 'Open live chat'}
      >
        {isOpen ? '✕' : '💬'}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-5 z-40 flex h-[520px] w-[360px] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl">
          {activeChat ? (
            <LiveChatWindow onClose={() => dispatch(setOpen(false))} />
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-gray-200 bg-primary px-4 py-3 text-white">
                <div className="text-sm font-semibold">Live Support</div>
                <button
                  onClick={() => dispatch(setOpen(false))}
                  className="rounded p-1 text-white/80 hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <LiveChatStartForm
                onStart={handleStart}
                onCancel={() => dispatch(setOpen(false))}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
