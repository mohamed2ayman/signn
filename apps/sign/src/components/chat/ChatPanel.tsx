import { useState, useEffect, useRef, useCallback } from 'react';
import { BloomIcon } from '@/components/common/SignLogo';
import {
  chatService,
  type ChatMessage,
  type ChatMessageCitation,
} from '@/services/api/chatService';

/* ── Suggested prompts for empty state ──────────────────────── */
const SUGGESTED_PROMPTS = [
  'Summarize this contract',
  'What are the key risks?',
  'List all obligations and deadlines',
];

/* ── Markdown-lite renderer ─────────────────────────────────── */
function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${codeKey++}`}
            className="my-2 overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-800"
          >
            <code>{codeLines.join('\n')}</code>
          </pre>,
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      elements.push(<div key={i} className="h-2" />);
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={i} className="mt-3 mb-1 text-sm font-bold text-gray-900">
          {inlineFormat(line.slice(4))}
        </h4>,
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={i} className="mt-3 mb-1 text-sm font-bold text-gray-900">
          {inlineFormat(line.slice(3))}
        </h3>,
      );
      continue;
    }

    // Numbered lists
    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      elements.push(
        <div key={i} className="flex gap-2 py-0.5 pl-1">
          <span className="flex-shrink-0 text-gray-400">{numMatch[1]}.</span>
          <span>{inlineFormat(numMatch[2])}</span>
        </div>,
      );
      continue;
    }

    // Bullet lists
    if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-2 py-0.5 pl-1">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
          <span>{inlineFormat(line.slice(2))}</span>
        </div>,
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="py-0.5">
        {inlineFormat(line)}
      </p>,
    );
  }

  return elements;
}

function inlineFormat(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  // Bold: **text** or __text__
  const regex = /(\*\*|__)(.*?)\1|(`)(.*?)\3/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1]) {
      parts.push(
        <strong key={match.index} className="font-semibold text-gray-900">
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      parts.push(
        <code
          key={match.index}
          className="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-gray-800"
        >
          {match[4]}
        </code>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length ? parts : [text];
}

/* ── Citation Chip ──────────────────────────────────────────── */
function CitationChip({ citation }: { citation: ChatMessageCitation }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="inline-block">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
        {citation.source || 'Source'}
      </button>
      {expanded && citation.excerpt && (
        <div className="mt-1 rounded-lg border border-blue-100 bg-blue-50/50 p-2.5 text-xs text-gray-700">
          {citation.excerpt}
        </div>
      )}
    </div>
  );
}

/* ── Typing Indicator ───────────────────────────────────────── */
function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
        <BloomIcon size={16} />
      </div>
      <div className="flex items-center gap-1 pt-2">
        <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
      </div>
    </div>
  );
}

/* ── Message Bubble ─────────────────────────────────────────── */
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'USER';
  const time = new Date(msg.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isUser) {
    return (
      <div className="flex flex-col items-end px-4 py-2">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-white">
          {msg.content}
        </div>
        <span className="mt-1 text-[10px] text-gray-400">{time}</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 px-4 py-2">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
        <BloomIcon size={16} />
      </div>
      <div className="max-w-[85%]">
        <div className="text-sm leading-relaxed text-gray-700">
          {renderMarkdown(msg.content)}
        </div>
        {msg.citations && msg.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {msg.citations.map((c, i) => (
              <CitationChip key={i} citation={c} />
            ))}
          </div>
        )}
        <span className="mt-1 block text-[10px] text-gray-400">{time}</span>
      </div>
    </div>
  );
}

/* ── Main Chat Panel ────────────────────────────────────────── */
interface ChatPanelProps {
  contractId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatPanel({
  contractId,
  isOpen,
  onClose,
}: ChatPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load or create session for this contract (or general session)
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const init = async () => {
      setLoadingHistory(true);
      try {
        if (contractId) {
          // Check for existing session scoped to this contract
          const existing =
            await chatService.findSessionByContract(contractId);
          if (cancelled) return;

          if (existing) {
            setSessionId(existing.id);
            const msgs = await chatService.getMessages(existing.id);
            if (!cancelled) setMessages(msgs);
          } else {
            setSessionId(null);
            setMessages([]);
          }
        } else {
          // No contract context — start with empty state
          setSessionId(null);
          setMessages([]);
        }
      } catch {
        // silently fail — user will see empty state
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [isOpen, contractId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const session = await chatService.createSession(contractId);
    setSessionId(session.id);
    return session.id;
  };

  const handleSend = async (text?: string) => {
    const message = (text || input).trim();
    if (!message || sending) return;

    setInput('');
    setSending(true);

    // Optimistically show user message
    const optimisticMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      session_id: sessionId || '',
      contract_id: contractId || null,
      user_id: '',
      org_id: '',
      role: 'USER',
      content: message,
      citations: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const sid = await ensureSession();
      const { userMessage, assistantMessage } =
        await chatService.sendMessage(sid, message);

      // Replace optimistic message with real ones
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticMsg.id),
        userMessage,
        assistantMessage,
      ]);
    } catch {
      // Remove optimistic message on error
      setMessages((prev) =>
        prev.filter((m) => m.id !== optimisticMsg.id),
      );
    } finally {
      setSending(false);
    }
  };

  const handleNewConversation = async () => {
    const session = await chatService.createSession(contractId);
    setSessionId(session.id);
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-[380px] flex-col border-l-2 border-primary/20 bg-white shadow-elevated transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BloomIcon size={24} />
            <div>
              <h2 className="text-sm font-bold text-gray-900">
                SIGN AI Assistant
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleNewConversation}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50"
            >
              New Chat
            </button>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Messages Area ──────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {loadingHistory ? (
            <div className="flex h-full items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : messages.length === 0 ? (
            /* Empty state */
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <BloomIcon size={48} className="mb-4 opacity-60" />
              <h3 className="mb-1 text-base font-semibold text-gray-900">
                How can I help you with this contract?
              </h3>
              <p className="mb-6 text-xs text-gray-400">
                Ask questions, analyze risks, or get summaries
              </p>
              <div className="flex flex-col gap-2 w-full max-w-[260px]">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSend(prompt)}
                    disabled={sending}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-left text-sm text-gray-700 transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-3">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              {sending && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Input Area ─────────────────────────────────── */}
        <div className="border-t border-gray-100 px-4 py-3">
          <div className="flex items-end gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything about this contract..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
              style={{ maxHeight: 120 }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sending}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-white transition hover:bg-primary-600 disabled:bg-gray-200 disabled:text-gray-400"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                />
              </svg>
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-gray-400">
            AI responses are based on your contract content and knowledge
            base
          </p>
        </div>
      </div>
    </>
  );
}
