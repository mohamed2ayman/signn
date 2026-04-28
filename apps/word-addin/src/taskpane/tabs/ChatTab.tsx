import * as React from 'react';
import type { AuthState } from '../lib/auth';
import { api } from '../lib/api';
import {
  pollJob,
  JobTimeoutError,
  JobFailedError,
} from '../lib/jobs';
import { readSelection, insertAtSelection } from '../lib/word';
import type {
  AsyncJobResponse,
  ChatTurn,
  NegotiationEvent,
} from '../lib/types';

interface Props {
  auth: AuthState;
  onAuthLost: () => void;
  /** Active clause context, when the user is reviewing a specific clause.
   *  When set, "Copy to document" suggestions are logged as
   *  AI_SUGGESTION_APPLIED NegotiationEvents. */
  activeClauseRef?: string;
  activeContractId?: string;
}

const SESSION_KEY = 'sign.chat_history';

interface ChatResult {
  reply?: string;
  message?: string;
  content?: string;
}

export function ChatTab({
  onAuthLost,
  activeClauseRef,
  activeContractId,
}: Props) {
  const [history, setHistory] = React.useState<ChatTurn[]>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as ChatTurn[]) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = React.useState('');
  const [selection, setSelection] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(history));
    } catch {
      /* quota */
    }
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const refreshSelection = React.useCallback(async () => {
    try {
      const text = await readSelection();
      setSelection(text);
    } catch {
      setSelection('');
    }
  }, []);

  React.useEffect(() => {
    refreshSelection();
  }, [refreshSelection]);

  const send = async () => {
    const userMessage = input.trim();
    if (!userMessage || busy) return;
    setError(null);

    // Snapshot the selection at submission time so the assistant
    // sees the same thing the user saw when typing the question.
    let systemContext: string | undefined;
    try {
      const fresh = await readSelection();
      if (fresh && fresh.trim().length > 0) systemContext = fresh.trim();
    } catch {
      systemContext = selection || undefined;
    }

    const nextHistory: ChatTurn[] = [
      ...history,
      { role: 'user', content: userMessage },
    ];
    setHistory(nextHistory);
    setInput('');
    setBusy(true);

    try {
      const job = await api<AsyncJobResponse>('/ai/chat', {
        method: 'POST',
        body: {
          messages: nextHistory,
          system_context: systemContext,
          contract_id: activeContractId,
        },
      });
      const result = await pollJob<ChatResult | string>(job.job_id);
      const reply =
        typeof result === 'string'
          ? result
          : result.reply ?? result.message ?? result.content ?? '';
      setHistory((h) => [...h, { role: 'assistant', content: reply }]);
    } catch (e) {
      if (e instanceof Error && e.name === 'AuthRequiredError') {
        onAuthLost();
        return;
      }
      if (e instanceof JobTimeoutError) {
        setError('Chat is taking longer than 60s. Try again.');
      } else if (e instanceof JobFailedError) {
        setError(`AI failed: ${e.reason}`);
      } else {
        setError(e instanceof Error ? e.message : 'Chat failed');
      }
      setHistory((h) => h.slice(0, -1));
    } finally {
      setBusy(false);
    }
  };

  const copyToDocument = async (content: string) => {
    try {
      await insertAtSelection(content);
      if (activeClauseRef && activeContractId) {
        api<NegotiationEvent>('/negotiation/events', {
          method: 'POST',
          body: {
            contract_id: activeContractId,
            clause_ref: activeClauseRef,
            event_type: 'AI_SUGGESTION_APPLIED',
            new_text: content,
          },
        }).catch(() => {});
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AuthRequiredError') onAuthLost();
    }
  };

  const clearHistory = () => {
    setHistory([]);
    sessionStorage.removeItem(SESSION_KEY);
  };

  return (
    <div className="sign-chat">
      <div className="sign-chat-context-bar">
        {selection ? (
          <div className="sign-chat-context">
            <div style={{ fontSize: 10, color: '#4f6ef7', marginBottom: 2 }}>
              Selection sent as context:
            </div>
            <div className="sign-chat-context-text">
              {truncate(selection, 220)}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: '#888' }}>
            Select text in the document to give the assistant focused context.
          </div>
        )}
        <button
          className="sign-button sign-button--ghost"
          style={{ fontSize: 11, padding: '3px 8px', marginTop: 4 }}
          onClick={refreshSelection}
        >
          Refresh selection
        </button>
      </div>

      <div className="sign-chat-history" ref={scrollRef}>
        {history.length === 0 && (
          <div className="sign-card" style={{ fontSize: 12, color: '#666' }}>
            Ask anything about the open contract — clause meaning, FIDIC
            equivalents, redline suggestions. Select text first to focus the
            answer on a specific clause.
          </div>
        )}
        {history.map((turn, i) => (
          <div
            key={i}
            className={`sign-chat-msg sign-chat-msg--${turn.role}`}
          >
            <div className="sign-chat-msg-role">
              {turn.role === 'user' ? 'You' : 'SIGN AI'}
            </div>
            <div className="sign-chat-msg-content">{turn.content}</div>
            {turn.role === 'assistant' && (
              <button
                className="sign-button sign-button--ghost"
                style={{ fontSize: 11, padding: '3px 8px', marginTop: 4 }}
                onClick={() => copyToDocument(turn.content)}
              >
                Copy to document
              </button>
            )}
          </div>
        ))}
        {busy && <div className="sign-progress">Thinking…</div>}
        {error && <div className="sign-error">{error}</div>}
      </div>

      <div className="sign-chat-input-row">
        <textarea
          className="sign-input sign-chat-input"
          placeholder="Ask about a clause, FIDIC equivalent, redline…"
          value={input}
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            className="sign-button"
            onClick={send}
            disabled={busy || !input.trim()}
            style={{ flex: 1 }}
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
          {history.length > 0 && (
            <button
              className="sign-button sign-button--ghost"
              onClick={clearHistory}
              disabled={busy}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
