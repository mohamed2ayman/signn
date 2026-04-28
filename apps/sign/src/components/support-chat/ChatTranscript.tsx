import { useEffect, useRef } from 'react';
import type { SupportChatMessage } from '@/services/api/supportChatService';

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
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.map((m) => {
        if (m.sender_role === 'SYSTEM') {
          return (
            <div
              key={m.id}
              className="text-center text-xs italic text-gray-500"
            >
              {m.body}
            </div>
          );
        }
        const isMine = m.sender_id === currentUserId;
        return (
          <div
            key={m.id}
            className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                isMine
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-900'
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
                  isMine ? 'text-white/70' : 'text-gray-500'
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
        <div className="flex justify-start">
          <div className="rounded-lg bg-gray-100 px-3 py-2">
            <span className="mr-2 text-xs text-gray-500">{typingLabel}</span>
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500" />
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500"
                style={{ animationDelay: '0.15s' }}
              />
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-500"
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
