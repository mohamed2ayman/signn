import { useEffect, useRef } from 'react';
import type { SupportChatMessage } from '@/services/api/supportChatService';
import { WhiteBloomIcon } from '@/components/common/SignLogo';

interface Props {
  messages: SupportChatMessage[];
  /** ID of the *current viewer* — their messages render right-aligned. */
  currentUserId: string;
  typingLabel?: string | null;
}

/**
 * Bubble-style transcript renderer. SYSTEM messages render as a centered
 * italic note (no bubble). USER vs OPS bubbles are distinguished by side
 * relative to the current viewer.
 *
 * Typing-indicator dot pattern matches the AI ChatPanel.tsx (animate-bounce).
 */
export default function ChatTranscript({
  messages,
  currentUserId,
  typingLabel,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, typingLabel]);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50/40 p-4">
      {messages.map((m) => {
        if (m.sender_role === 'SYSTEM') {
          return (
            <div
              key={m.id}
              className="sign-chat-message-in text-center text-xs italic text-gray-500"
            >
              {m.body}
            </div>
          );
        }
        const isMine = m.sender_id === currentUserId;
        return (
          <div
            key={m.id}
            className={`sign-chat-message-in flex items-end gap-2 ${
              isMine ? 'justify-end' : 'justify-start'
            }`}
          >
            {!isMine && (
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm"
                aria-hidden="true"
              >
                <WhiteBloomIcon size={16} />
              </span>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                isMine
                  ? 'rounded-br-md bg-primary text-white'
                  : 'rounded-bl-md bg-white text-gray-900 ring-1 ring-gray-100'
              }`}
            >
              {m.body && <div className="whitespace-pre-wrap">{m.body}</div>}
              {m.attachment_url && (
                <a
                  href={m.attachment_url}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-1 block text-xs underline ${
                    isMine ? 'text-white/90' : 'text-primary'
                  }`}
                >
                  📎 {m.attachment_name ?? 'attachment'}
                </a>
              )}
              <div
                className={`mt-1 text-[10px] ${
                  isMine ? 'text-white/70' : 'text-gray-400'
                }`}
              >
                {new Date(m.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          </div>
        );
      })}

      {typingLabel && (
        <div className="flex items-end gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm"
            aria-hidden="true"
          >
            <WhiteBloomIcon size={16} />
          </span>
          <div className="rounded-2xl rounded-bl-md bg-white px-3 py-2 shadow-sm ring-1 ring-gray-100">
            <span className="mr-2 text-xs text-gray-500">{typingLabel}</span>
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                style={{ animationDelay: '0.15s' }}
              />
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
                style={{ animationDelay: '0.3s' }}
              />
            </span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
