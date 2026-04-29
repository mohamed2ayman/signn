import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { supportChatService } from '@/services/api/supportChatService';
import {
  appendMessage,
  setShowCsat,
} from '@/store/slices/supportChatSlice';
import { WhiteBloomIcon } from '@/components/common/SignLogo';
import ChatTranscript from './ChatTranscript';
import AttachmentButton from './AttachmentButton';
import CsatPrompt from './CsatPrompt';
import { useTypingEmitter } from './useTypingEmitter';

interface Props {
  onClose: () => void;
}

export default function LiveChatWindow({ onClose }: Props) {
  const dispatch = useDispatch();
  const { user } = useSelector((s: RootState) => s.auth);
  const { activeChat, messages, typingUserIds, showCsat, connectionState } =
    useSelector((s: RootState) => s.supportChat);

  const [draft, setDraft] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const onKeystroke = useTypingEmitter(activeChat?.id ?? null);

  if (!activeChat || !user) return null;

  const isClosed = activeChat.status === 'CLOSED';
  const isWaiting = activeChat.status === 'WAITING';

  // Show "Ops is typing…" — anyone other than the current user counts.
  const someoneElseTyping = typingUserIds.some((id) => id !== user.id);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text && !pendingFile) return;
    setSending(true);
    try {
      const msg = await supportChatService.sendMessage(
        activeChat.id,
        text,
        pendingFile ?? undefined,
      );
      // Optimistic-ish: also append locally; the server will socket-broadcast,
      // and the slice dedupes by id.
      dispatch(appendMessage(msg));
      setDraft('');
      setPendingFile(null);
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleSubmitCsat = async (rating: number, comment?: string) => {
    try {
      await supportChatService.submitCsat(activeChat.id, rating, comment);
      dispatch(setShowCsat(false));
    } catch (err: any) {
      alert(err?.response?.data?.message ?? 'Failed to submit feedback');
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header — branded, matches start-form header */}
      <div className="flex items-center justify-between bg-navy-900 px-4 py-3 text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10">
            <WhiteBloomIcon size={20} />
          </span>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              SIGN Support
              {!isClosed && activeChat.status === 'ACTIVE' && (
                <>
                  <span className="relative inline-flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-300">
                    Online
                  </span>
                </>
              )}
            </div>
            <div className="text-[11px] text-white/70">
              {isWaiting && 'Waiting for an agent…'}
              {activeChat.status === 'ACTIVE' && 'Connected — we typically reply in minutes'}
              {activeChat.status === 'TRANSFERRED' && 'Transferring to another agent…'}
              {isClosed && 'Chat ended'}
              {connectionState !== 'connected' && ` · ${connectionState}`}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Close chat"
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

      <ChatTranscript
        messages={messages}
        currentUserId={user.id}
        typingLabel={someoneElseTyping ? 'Agent is typing' : null}
      />

      {showCsat && (
        <CsatPrompt
          onSubmit={handleSubmitCsat}
          onDismiss={() => dispatch(setShowCsat(false))}
        />
      )}

      {/* Composer */}
      {!isClosed && (
        <div className="border-t border-gray-200 bg-white p-3">
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
              className="flex-1 resize-none rounded border border-gray-300 p-2 text-sm focus:border-primary focus:outline-none"
              rows={2}
              placeholder={
                isWaiting
                  ? 'Type a message — an agent will reply soon'
                  : 'Type your message…'
              }
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
  );
}
