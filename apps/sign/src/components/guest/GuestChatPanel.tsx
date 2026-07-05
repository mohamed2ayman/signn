import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BloomIcon } from '@/components/common/SignLogo';
import AIDisclaimer from '@/components/common/AIDisclaimer';
import {
  classifyGuestChatError,
  createGuestChatSession,
  getGuestChatMessageStatus,
  getGuestChatSession,
  sendGuestChatMessage,
  type GuestChatMessage,
} from '@/services/api/guestChatService';
import {
  buildGuestCitations,
  scrollToGuestClause,
  type GuestChatClauseRef,
  type GuestCitationTarget,
} from './guestChatCitations';

/**
 * Guest AI Assistant drawer (Feature #6, Slice 2 — frontend).
 *
 * A FORK of the host ChatPanel (apps/sign/src/components/chat/ChatPanel.tsx)
 * — same 380px drawer, bubbles, markdown-lite, 1.5s/90s poll lifecycle —
 * with the guest-specific deltas:
 *   • guestHttp service layer (explicit guest JWT; never the managing client)
 *   • RTL-aware (the host panel is LTR-only): drawer pins LEFT in Arabic,
 *     bubbles/input/chips mirror, Cairo comes from the global [dir='rtl'] rule
 *   • fully i18n'd copy (the host's strings are hardcoded English)
 *   • quota pill from the REAL {remaining, cap} on each send
 *   • daily-cap amber card + disabled composer (429 GUEST_AI_QUERY_DAILY_LIMIT)
 *   • burst-throttle transient notice (plain 429)
 *   • session-expired notice (401 → onSessionExpired, mirrors GuestComments)
 *   • citation chips parsed from §refs in the answer, matched against the
 *     REAL clause list, tap → scroll-and-highlight the clause card
 *
 * The host ChatPanel is deliberately NOT touched (fork, don't mutate).
 */

/* ── Markdown-lite renderer (forked verbatim from ChatPanel) ── */
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

    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      elements.push(
        <div key={i} className="flex gap-2 py-0.5 pl-1 rtl:pl-0 rtl:pr-1">
          <span className="flex-shrink-0 text-gray-400">{numMatch[1]}.</span>
          <span>{inlineFormat(numMatch[2])}</span>
        </div>,
      );
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} className="flex gap-2 py-0.5 pl-1 rtl:pl-0 rtl:pr-1">
          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
          <span>{inlineFormat(line.slice(2))}</span>
        </div>,
      );
      continue;
    }

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

/* ── Guest citation chip: expand excerpt + scroll-highlight the clause ── */
function GuestCitationChip({ target }: { target: GuestCitationTarget }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const label = target.title
    ? `§${target.section} — ${target.title}`
    : `§${target.section}`;

  const handleTap = () => {
    // Design: the chip both reveals the excerpt AND points at the clause.
    // Tap = scroll-and-highlight (panel stays open) + toggle the excerpt.
    scrollToGuestClause(target.section);
    setExpanded((v) => !v);
  };

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={handleTap}
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
        <span dir="auto" style={{ unicodeBidi: 'plaintext' }}>
          {label}
        </span>
      </button>
      {expanded && target.excerpt && (
        <div className="mt-1 rounded-lg border border-blue-100 bg-blue-50/50 p-2.5 text-xs text-gray-700">
          <span dir="auto" style={{ unicodeBidi: 'plaintext' }}>
            {target.excerpt}
          </span>
          <button
            type="button"
            onClick={() => scrollToGuestClause(target.section)}
            className="mt-1.5 block text-[11px] font-medium text-blue-700 hover:text-blue-800"
          >
            {t('guest.assistant.viewInContract')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Message bubble (RTL-aware fork) ─────────────────────────── */
interface BubbleMessage extends GuestChatMessage {
  /** Question text a failed assistant bubble can be retried with. */
  _retryText?: string;
}

function GuestMessageBubble({
  msg,
  capped,
  isRtl,
  clauses,
  onRetry,
}: {
  msg: BubbleMessage;
  capped?: boolean;
  isRtl: boolean;
  clauses: GuestChatClauseRef[];
  onRetry?: (text: string) => void;
}) {
  const { t } = useTranslation();
  const time = new Date(msg.created_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (msg.role === 'USER') {
    // The bubble sits on the guest's side: inline-end (right in LTR, left in
    // RTL — flex `items-end` under dir handles it); the "tail" corner follows.
    return (
      <div className="flex flex-col items-end px-4 py-2">
        <div
          className={`max-w-[85%] bg-primary px-4 py-2.5 text-sm leading-relaxed text-white ${
            isRtl ? 'rounded-2xl rounded-bl-md' : 'rounded-2xl rounded-br-md'
          }`}
          dir="auto"
          style={{ unicodeBidi: 'plaintext' }}
        >
          {msg.content}
        </div>
        <span className="mt-1 text-[10px] text-gray-400" dir="ltr">
          {time}
        </span>
      </div>
    );
  }

  const inFlight = msg.status === 'PENDING' || msg.status === 'PROCESSING';
  const failed = msg.status === 'FAILED';
  const citations =
    !inFlight && !failed ? buildGuestCitations(msg.content, clauses) : [];

  return (
    <div className="flex items-start gap-3 px-4 py-2">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
        <BloomIcon size={16} />
      </div>
      <div className="max-w-[85%]">
        {inFlight && !msg.content ? (
          capped ? (
            <div className="text-xs italic text-gray-400">
              {t('guest.assistant.stillWorking')}
            </div>
          ) : (
            <div
              className="flex items-center gap-1 pt-1"
              role="status"
              aria-live="polite"
              aria-label={t('guest.assistant.thinking')}
            >
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
            </div>
          )
        ) : failed ? (
          <div>
            <div className="text-sm leading-relaxed text-red-600" dir="auto">
              {msg.error_message || t('guest.assistant.errorText')}
            </div>
            {onRetry && msg._retryText && (
              <button
                type="button"
                onClick={() => onRetry(msg._retryText as string)}
                className="mt-1 text-xs font-medium text-primary hover:text-primary-600"
              >
                {t('guest.assistant.retry')}
              </button>
            )}
          </div>
        ) : (
          <>
            <div
              className="text-sm leading-relaxed text-gray-700"
              dir="auto"
              style={{ unicodeBidi: 'plaintext' }}
            >
              {renderMarkdown(msg.content || '')}
            </div>
            {citations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {citations.map((c, i) => (
                  <GuestCitationChip key={`${c.section}-${i}`} target={c} />
                ))}
              </div>
            )}
          </>
        )}
        <span className="mt-1 block text-[10px] text-gray-400" dir="ltr">
          {time}
        </span>
      </div>
    </div>
  );
}

/* ── Session persistence (refresh-resume, guest-upload grain) ── */
const sessionKey = (contractId: string) => `guest-chat-session:${contractId}`;

function readStoredSession(contractId: string): string | null {
  try {
    return localStorage.getItem(sessionKey(contractId));
  } catch {
    return null;
  }
}

function writeStoredSession(contractId: string, sessionId: string): void {
  try {
    localStorage.setItem(sessionKey(contractId), sessionId);
  } catch {
    // localStorage unavailable — resume degrades gracefully.
  }
}

function clearStoredSession(contractId: string): void {
  try {
    localStorage.removeItem(sessionKey(contractId));
  } catch {
    // ignore
  }
}

/* ── Main panel ──────────────────────────────────────────────── */
interface GuestChatPanelProps {
  contractId: string;
  clauses: GuestChatClauseRef[];
  guestJwt: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** Mirrors GuestComments: fired once when a call comes back 401. */
  onSessionExpired: () => void;
}

const SUGGESTED_KEYS = [
  'guest.assistant.suggested1',
  'guest.assistant.suggested2',
  'guest.assistant.suggested3',
  'guest.assistant.suggested4',
] as const;

export default function GuestChatPanel({
  contractId,
  clauses,
  guestJwt,
  isOpen,
  onClose,
  onSessionExpired,
}: GuestChatPanelProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BubbleMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [pollMessageId, setPollMessageId] = useState<string | null>(null);
  const [cappedId, setCappedId] = useState<string | null>(null);
  // Quota pill — real values from the last send; unknown until the first send
  // (the history endpoint doesn't carry them).
  const [remaining, setRemaining] = useState<number | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  // Daily-cap-reached state (429 GUEST_AI_QUERY_DAILY_LIMIT).
  const [capReached, setCapReached] = useState<{ resetsAt: string | null } | null>(
    null,
  );
  // Burst-throttle transient notice (seconds to wait); auto-clears.
  const [throttled, setThrottled] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const throttleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiredRef = useRef(false);

  const markExpired = useCallback(() => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    setExpired(true);
    setPollMessageId(null);
    onSessionExpired();
  }, [onSessionExpired]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  /* Load history (refresh-resume) when the panel opens. */
  useEffect(() => {
    if (!isOpen || !guestJwt) return;
    let cancelled = false;

    const init = async () => {
      const storedSid = readStoredSession(contractId);
      if (!storedSid) return;
      setLoadingHistory(true);
      try {
        const session = await getGuestChatSession(
          contractId,
          storedSid,
          guestJwt,
        );
        if (cancelled) return;
        setSessionId(session.id);
        setMessages(session.messages);
        // Resume polling if a prior turn is still in-flight (refresh mid-turn).
        const inFlight = [...session.messages]
          .reverse()
          .find(
            (m) =>
              m.role === 'ASSISTANT' &&
              (m.status === 'PENDING' || m.status === 'PROCESSING'),
          );
        if (inFlight) setPollMessageId(inFlight.id);
      } catch (err) {
        if (cancelled) return;
        const kind = classifyGuestChatError(err).kind;
        if (kind === 'session-expired') {
          markExpired();
        } else if (kind === 'not-found') {
          // Stale stored session (revoked / different contract) — start clean.
          clearStoredSession(contractId);
          setSessionId(null);
          setMessages([]);
        }
        // generic → empty state; the guest can still start a conversation.
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [isOpen, contractId, guestJwt, markExpired]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending, scrollToBottom]);

  /* Poll the in-flight assistant message — 1.5s cadence, 90s cap. */
  useEffect(() => {
    if (!pollMessageId || !guestJwt) return;
    const startedAt = Date.now();
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (Date.now() - startedAt > 90_000) {
        setCappedId(pollMessageId);
        setPollMessageId(null);
        return;
      }
      try {
        const updated = await getGuestChatMessageStatus(
          contractId,
          pollMessageId,
          guestJwt,
        );
        // Malformed/empty poll payload → skip this tick, keep polling.
        if (stopped || !updated?.id) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === updated.id ? { ...updated, _retryText: m._retryText } : m,
          ),
        );
        if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
          setPollMessageId(null);
        }
      } catch (err) {
        const kind = classifyGuestChatError(err).kind;
        if (kind === 'session-expired') {
          if (!stopped) markExpired();
          return;
        }
        if (kind === 'not-found') {
          if (!stopped) setPollMessageId(null);
          return;
        }
        // Transient poll error — keep trying until the 90s cap.
      }
    };

    void tick();
    const interval = setInterval(tick, 1500);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [pollMessageId, contractId, guestJwt, markExpired]);

  /* Auto-grow the textarea (host behavior). */
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  useEffect(
    () => () => {
      if (throttleTimer.current) clearTimeout(throttleTimer.current);
    },
    [],
  );

  const ensureSession = async (jwt: string): Promise<string> => {
    if (sessionId) return sessionId;
    const session = await createGuestChatSession(contractId, jwt);
    setSessionId(session.id);
    writeStoredSession(contractId, session.id);
    return session.id;
  };

  const handleSend = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || sending || !guestJwt || capReached || expired) return;

    setInput('');
    setSending(true);
    setThrottled(null);

    const optimisticMsg: BubbleMessage = {
      id: `temp-${Date.now()}`,
      role: 'USER',
      content: message,
      citations: null,
      status: 'COMPLETED',
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const sid = await ensureSession(guestJwt);
      const res = await sendGuestChatMessage(contractId, sid, guestJwt, message);

      setRemaining(res.remaining);
      setCap(res.cap);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== optimisticMsg.id),
        res.user_message,
        { ...res.assistant_message, _retryText: message },
      ]);
      if (res.assistant_message.status !== 'FAILED') {
        setCappedId(null);
        setPollMessageId(res.assistant_message.id);
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      const classified = classifyGuestChatError(err);
      switch (classified.kind) {
        case 'daily-limit':
          setRemaining(0);
          setCap(classified.cap);
          setCapReached({ resetsAt: classified.resetsAt });
          break;
        case 'throttled': {
          // Transient: restore the question so nothing typed is lost.
          setInput(message);
          setThrottled(classified.retryAfter);
          if (throttleTimer.current) clearTimeout(throttleTimer.current);
          throttleTimer.current = setTimeout(
            () => setThrottled(null),
            Math.min(classified.retryAfter, 60) * 1000,
          );
          break;
        }
        case 'session-expired':
          markExpired();
          break;
        default:
          // Dispatch failed — render an in-thread error bubble with Retry
          // (design §6.5), keeping the guest's question visible above it.
          setMessages((prev) => [
            ...prev,
            optimisticMsg,
            {
              id: `local-fail-${Date.now()}`,
              role: 'ASSISTANT',
              content: null,
              citations: null,
              status: 'FAILED',
              error_message: null,
              created_at: new Date().toISOString(),
              _retryText: message,
            },
          ]);
      }
    } finally {
      setSending(false);
    }
  };

  const handleRetry = (text: string) => {
    // Drop the failed local bubble pair before resending.
    setMessages((prev) =>
      prev.filter(
        (m) =>
          !(m.status === 'FAILED' && m._retryText === text) &&
          !(m.role === 'USER' && m.id.startsWith('temp-') && m.content === text),
      ),
    );
    void handleSend(text);
  };

  const handleNewConversation = async () => {
    if (!guestJwt || expired) return;
    try {
      const session = await createGuestChatSession(contractId, guestJwt);
      setSessionId(session.id);
      writeStoredSession(contractId, session.id);
      setMessages([]);
      setPollMessageId(null);
      setCappedId(null);
      // NOTE: the daily quota is per contract per day — a new chat does NOT
      // reset it, so the pill and any cap-reached state persist.
    } catch (err) {
      if (classifyGuestChatError(err).kind === 'session-expired') markExpired();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const composerDisabled = !!capReached || expired || !guestJwt;
  const lowQuota = remaining != null && remaining <= 5;

  const resetsAtLabel = capReached?.resetsAt
    ? new Date(capReached.resetsAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <>
      {/* Backdrop (small screens) */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px] lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Drawer — pinned to the inline-end edge: right in LTR, LEFT in RTL. */}
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        data-testid="guest-chat-panel"
        className={`fixed top-0 z-50 flex h-full w-[380px] flex-col bg-white shadow-elevated transition-transform duration-300 ease-in-out ${
          isRtl
            ? `left-0 border-r-2 border-primary/20 ${
                isOpen ? 'translate-x-0' : '-translate-x-full'
              }`
            : `right-0 border-l-2 border-primary/20 ${
                isOpen ? 'translate-x-0' : 'translate-x-full'
              }`
        }`}
      >
        {/* ── Header ─────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BloomIcon size={24} />
            <div>
              <h2 className="text-sm font-bold text-gray-900">
                {t('guest.assistant.title')}
              </h2>
              <p className="text-[11px] text-gray-400">
                {t('guest.assistant.subline')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleNewConversation}
              disabled={composerDisabled && !capReached}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('guest.assistant.newChat')}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
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

        {/* ── Messages ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {loadingHistory ? (
            <div
              className="flex h-full items-center justify-center"
              role="status"
              aria-label={t('guest.assistant.loadingHistory')}
            >
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : messages.length === 0 ? (
            /* Empty / first-open — welcome + suggested questions */
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <BloomIcon size={48} className="mb-4 opacity-60" />
              <h3 className="mb-1 text-base font-semibold text-gray-900">
                {t('guest.assistant.welcomeTitle')}
              </h3>
              <p className="mb-6 text-xs text-gray-400">
                {t('guest.assistant.welcomeBody')}
              </p>
              <p className="mb-2 w-full max-w-[260px] text-start text-[11px] font-medium uppercase tracking-wide text-gray-400">
                {t('guest.assistant.tryAsking')}
              </p>
              <div className="flex w-full max-w-[260px] flex-col gap-2">
                {SUGGESTED_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void handleSend(t(key))}
                    disabled={sending || composerDisabled}
                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-start text-sm text-gray-700 transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-3">
              {messages.map((msg) => (
                <GuestMessageBubble
                  key={msg.id}
                  msg={msg}
                  capped={msg.id === cappedId}
                  isRtl={isRtl}
                  clauses={clauses}
                  onRetry={handleRetry}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Daily-cap card (amber, persistent, above the composer) ── */}
        {capReached && (
          <div
            className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50 p-4"
            role="status"
            aria-live="polite"
            data-testid="guest-chat-cap-card"
          >
            <p className="text-sm font-medium text-amber-800">
              {t('guest.assistant.rateTitle')}
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              {t('guest.assistant.rateBody', { limit: cap ?? 20 })}
              {resetsAtLabel && (
                <>
                  {' '}
                  {t('guest.assistant.rateResets', { time: resetsAtLabel })}
                </>
              )}
            </p>
          </div>
        )}

        {/* ── Session-expired notice ─────────────────────── */}
        {expired && (
          <div
            className="mx-4 mb-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-center text-xs text-gray-500"
            role="status"
            data-testid="guest-chat-expired"
          >
            {t('guest.assistant.sessionExpired')}
          </div>
        )}

        {/* ── Input area ─────────────────────────────────── */}
        <div className="border-t border-gray-100 px-4 py-3">
          <div
            className={`flex items-end gap-2 rounded-xl border border-gray-200 px-3 py-2 ${
              composerDisabled
                ? 'bg-gray-100 opacity-70'
                : 'bg-gray-50/50 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20'
            }`}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                capReached
                  ? t('guest.assistant.placeholderCapped')
                  : t('guest.assistant.placeholder')
              }
              rows={1}
              disabled={composerDisabled}
              dir="auto"
              className="flex-1 resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
              style={{ maxHeight: 120, unicodeBidi: 'plaintext' }}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!input.trim() || sending || composerDisabled}
              aria-label={t('guest.assistant.send')}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-white transition hover:bg-primary-600 disabled:bg-gray-200 disabled:text-gray-400"
            >
              {/* Paper-plane points in the reading direction. */}
              <svg
                className={`h-4 w-4 ${isRtl ? '-scale-x-100' : ''}`}
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

          {/* Burst-throttle transient notice */}
          {throttled != null && (
            <p
              className="mt-1.5 text-[11px] text-amber-600"
              role="alert"
              data-testid="guest-chat-throttle-notice"
            >
              {t('guest.assistant.throttleNotice')}
            </p>
          )}

          {/* Quota pill — real {remaining, cap} from the last send. */}
          {remaining != null && cap != null && !capReached && (
            <p
              className={`mt-1.5 text-center text-[10px] ${
                lowQuota ? 'font-medium text-amber-600' : 'text-gray-400'
              }`}
              data-testid="guest-chat-quota-pill"
            >
              {t('guest.assistant.remaining', { n: remaining, limit: cap })}
            </p>
          )}

          <p className="mt-1.5 text-center text-[10px] text-gray-400">
            {t('guest.assistant.helper')}
          </p>
          <AIDisclaimer compact />
        </div>
      </div>
    </>
  );
}
