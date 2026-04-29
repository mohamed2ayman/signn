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
import { WhiteBloomIcon } from '@/components/common/SignLogo';
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

  // Pulse the bubble whenever we don't have an in-flight chat — i.e. nudge
  // first-time visitors. Once a chat is active, the bubble is calm.
  const showBubblePulse = !activeChat && !isOpen;

  return (
    <>
      {/* Floating launcher (always visible) */}
      <button
        type="button"
        onClick={() => dispatch(setOpen(!isOpen))}
        className={`fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-elevated transition-transform hover:scale-105 hover:bg-primary-600 focus:outline-none focus:ring-4 focus:ring-primary/30 ${
          showBubblePulse ? 'sign-chat-bubble-pulse' : ''
        }`}
        aria-label={isOpen ? 'Close live chat' : 'Open live chat'}
      >
        {isOpen ? (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <WhiteBloomIcon size={24} />
        )}
      </button>

      {isOpen && (
        <div className="fixed bottom-24 right-5 z-40 flex h-[560px] w-[380px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-elevated">
          {activeChat ? (
            <LiveChatWindow onClose={() => dispatch(setOpen(false))} />
          ) : (
            <>
              {/* Branded header (matches LiveChatWindow header for visual continuity) */}
              <div className="flex items-center justify-between bg-navy-900 px-4 py-3 text-white">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10">
                    <WhiteBloomIcon size={20} />
                  </span>
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      SIGN Support
                      <span className="relative inline-flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                        Online
                      </span>
                    </div>
                    <div className="text-[11px] text-white/70">
                      We typically reply in a few minutes
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => dispatch(setOpen(false))}
                  className="rounded p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
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
