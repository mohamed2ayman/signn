import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@/store';
import {
  supportChatService,
  type CannedResponse,
  type SupportChat,
  type SupportChatMessage,
} from '@/services/api/supportChatService';
import {
  appendMessage,
  setActiveChat,
  setMessages,
  patchActiveChat,
} from '@/store/slices/supportChatSlice';
import { useSupportChatSocket } from '@/components/support-chat/useSupportChatSocket';
import { useTypingEmitter } from '@/components/support-chat/useTypingEmitter';
import ChatTranscript from '@/components/support-chat/ChatTranscript';
import AttachmentButton from '@/components/support-chat/AttachmentButton';
import CannedResponsePicker from './CannedResponsePicker';
import OpsNotesTab from './OpsNotesTab';
import OpsUserContextPanel from './OpsUserContextPanel';
import TransferModal from './TransferModal';
import CloseChatModal from './CloseChatModal';

interface Props {
  chatId: string;
  /** Called after the chat is closed/converted, so the parent can drop it. */
  onLeave: () => void;
}

/**
 * Full-screen ops view of a single chat:
 *
 *   ┌────────────────────┬──────────────┐
 *   │ transcript         │              │
 *   │   or notes tab     │ user context │
 *   │                    │              │
 *   │ composer + actions │              │
 *   └────────────────────┴──────────────┘
 *
 * Reuses ChatTranscript / AttachmentButton from the user-side widget so
 * the bubble styling stays identical; ops-only affordances (Transfer,
 * End, Convert to Ticket, canned responses, notes tab) are layered on top.
 */
export default function OpsChatWindow({ chatId, onLeave }: Props) {
  const dispatch = useDispatch();
  const { user } = useSelector((s: RootState) => s.auth);
  const { activeChat, messages, typingUserIds } = useSelector(
    (s: RootState) => s.supportChat,
  );

  const [tab, setTab] = useState<'chat' | 'notes'>('chat');
  const [draft, setDraft] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [converting, setConverting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Wire socket lifecycle to this chat (joins room, listens for events).
  useSupportChatSocket(chatId);
  const onKeystroke = useTypingEmitter(chatId);

  // Load chat + canned responses on mount / chat change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const full = await supportChatService.ops.getChat(chatId);
        if (cancelled) return;
        // Strip messages out of the chat object the slice stores.
        const { messages: msgs, ...chatOnly } = full as SupportChat & {
          messages: SupportChatMessage[];
        };
        dispatch(setActiveChat(chatOnly as SupportChat));
        dispatch(setMessages(msgs));
      } catch (err: any) {
        alert(err?.response?.data?.message ?? 'Could not load chat');
        onLeave();
      }
    })();
    supportChatService.ops
      .listCanned()
      .then((rows) => !cancelled && setCanned(rows))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const isClosed = activeChat?.status === 'CLOSED';
  const isWaiting = activeChat?.status === 'WAITING';

  const someoneElseTyping = useMemo(
    () => typingUserIds.some((id) => id !== user?.id),
    [typingUserIds, user?.id],
  );

  const showCannedPicker =
    tab === 'chat' && draft.startsWith('/') && !draft.includes('\n');

  const handleSend = async () => {
    const text = draft.trim();
    if (!text && !pendingFile) return;
    setSending(true);
    try {
      const msg = await supportChatService.sendMessage(
        chatId,
        text,
        pendingFile ?? undefined,
      );
      dispatch(appendMessage(msg));
      setDraft('');
      setPendingFile(null);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const pickCanned = (cr: CannedResponse) => {
    setDraft(cr.body);
    // Bring focus back to the textarea so the ops member can edit/send.
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleClaim = async () => {
    try {
      const updated = await supportChatService.ops.claim(chatId);
      dispatch(patchActiveChat(updated));
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Could not claim chat');
    }
  };

  const handleConvert = async () => {
    if (!isClosed) return;
    setConverting(true);
    try {
      const result = await supportChatService.ops.convertToTicket(chatId);
      alert(
        result.already_converted
          ? 'This chat was already converted to a ticket.'
          : 'Ticket created.',
      );
      // Reload the chat so converted_ticket_id is reflected in state.
      const full = await supportChatService.ops.getChat(chatId);
      const { messages: msgs, ...chatOnly } = full as SupportChat & {
        messages: SupportChatMessage[];
      };
      dispatch(patchActiveChat(chatOnly as SupportChat));
      dispatch(setMessages(msgs));
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Convert failed');
    } finally {
      setConverting(false);
    }
  };

  if (!activeChat) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Loading chat…
      </div>
    );
  }

  const showComposer = tab === 'chat' && !isClosed && !isWaiting;

  return (
    <div className="flex h-full">
      {/* Left: chat or notes */}
      <div className="flex h-full flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {activeChat.user?.first_name} {activeChat.user?.last_name}{' '}
              <span className="text-xs font-normal text-gray-500">
                · {activeChat.status}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {activeChat.user?.email}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isWaiting && (
              <button
                onClick={handleClaim}
                className="rounded bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary-600"
              >
                Claim
              </button>
            )}
            {activeChat.status === 'ACTIVE' && (
              <>
                <button
                  onClick={() => setShowTransfer(true)}
                  className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Transfer
                </button>
                <button
                  onClick={() => setShowClose(true)}
                  className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                >
                  End
                </button>
              </>
            )}
            {isClosed && (
              <button
                onClick={handleConvert}
                disabled={converting || !!activeChat.converted_ticket_id}
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {activeChat.converted_ticket_id
                  ? 'Already converted'
                  : converting
                  ? 'Converting…'
                  : 'Convert to ticket'}
              </button>
            )}
            <button
              onClick={onLeave}
              className="ml-1 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200 bg-gray-50 px-4">
          <button
            onClick={() => setTab('chat')}
            className={`border-b-2 px-3 py-2 text-xs font-semibold ${
              tab === 'chat'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setTab('notes')}
            className={`border-b-2 px-3 py-2 text-xs font-semibold ${
              tab === 'notes'
                ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Internal notes
          </button>
        </div>

        {/* Body */}
        {tab === 'chat' ? (
          <ChatTranscript
            messages={messages}
            currentUserId={user?.id ?? ''}
            typingLabel={someoneElseTyping ? 'User is typing' : null}
          />
        ) : (
          <OpsNotesTab chatId={chatId} />
        )}

        {/* Composer (chat tab only, when chat is ACTIVE) */}
        {showComposer && (
          <div className="relative border-t border-gray-200 bg-white p-3">
            {showCannedPicker && (
              <CannedResponsePicker
                query={draft}
                responses={canned}
                onPick={pickCanned}
              />
            )}
            {pendingFile && (
              <div className="mb-2 flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-xs">
                <span className="truncate">📎 {pendingFile.name}</span>
                <button
                  type="button"
                  onClick={() => setPendingFile(null)}
                  className="ml-2 text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <AttachmentButton onPick={setPendingFile} disabled={sending} />
              <textarea
                ref={textareaRef}
                className="flex-1 resize-none rounded border border-gray-300 p-2 text-sm focus:border-primary focus:outline-none"
                rows={2}
                placeholder="Reply… start with / for canned responses"
                value={draft}
                maxLength={10_000}
                onChange={(e) => {
                  setDraft(e.target.value);
                  onKeystroke();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || (!draft.trim() && !pendingFile)}
                className="rounded bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: user context */}
      <OpsUserContextPanel
        user={activeChat.user ?? null}
        topic={activeChat.topic}
      />

      {/* Modals */}
      {showTransfer && user && (
        <TransferModal
          chatId={chatId}
          currentOpsId={user.id}
          onClose={() => setShowTransfer(false)}
          onTransferred={() => {
            // Once transferred, this ops member is no longer assigned —
            // drop the panel.
            onLeave();
          }}
        />
      )}
      {showClose && (
        <CloseChatModal
          chatId={chatId}
          onClose={() => setShowClose(false)}
          onClosed={() => {
            // Reload chat so the CLOSED status is reflected.
            supportChatService.ops
              .getChat(chatId)
              .then((full) => {
                const { messages: msgs, ...chatOnly } = full as SupportChat & {
                  messages: SupportChatMessage[];
                };
                dispatch(patchActiveChat(chatOnly as SupportChat));
                dispatch(setMessages(msgs));
              })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
