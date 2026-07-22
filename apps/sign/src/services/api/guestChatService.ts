import axios from 'axios';
import { guestHttp } from './guestHttp';

/**
 * Guest AI Assistant service (Feature #6, Slice 2 frontend).
 *
 * Mirrors the guestService.ts grain: standalone functions on the ISOLATED
 * `guestHttp` instance, with the guest JWT passed EXPLICITLY per request
 * (`Authorization: Bearer <guest_jwt>`). Never the managing api client —
 * a guest call must never pick up the Redux Bearer token or trigger the
 * app's 401 refresh/redirect interceptor.
 *
 * Backend contract (PR #124, merged 3a1658c):
 *   POST /guest/contracts/:id/chat/sessions            → { id, contract_id, created_at }
 *   GET  /guest/contracts/:id/chat/sessions/:sid       → { …, messages: GuestChatMessage[] }
 *   POST /guest/contracts/:id/chat/sessions/:sid/messages
 *        → { user_message, assistant_message, remaining, cap }
 *   GET  /guest/contracts/:id/chat/messages/:mid/status → GuestChatMessage
 *
 * 429 shapes:
 *   daily cap  → { statusCode: 429, error: 'GUEST_AI_QUERY_DAILY_LIMIT',
 *                  message, remaining: 0, cap, resets_at }
 *   burst      → { statusCode: 429, error: 'Too Many Requests', message,
 *                  retryAfter }   (named-throttler filter shape)
 */

export type GuestChatMessageStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export interface GuestChatMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string | null;
  citations: unknown[] | null;
  status: GuestChatMessageStatus;
  error_message?: string | null;
  created_at: string;
}

export interface GuestChatSessionSummary {
  id: string;
  contract_id: string;
  created_at: string;
}

export interface GuestChatSessionView extends GuestChatSessionSummary {
  messages: GuestChatMessage[];
}

/**
 * Sanitized session-list item (#8c chat-resume). Enough to rediscover + adopt
 * a prior conversation when the localStorage pointer is gone (fresh device /
 * cleared storage); never message bodies. The list is most-recent-first.
 */
export interface GuestChatSessionListItem {
  id: string;
  contract_id: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface GuestChatSendResult {
  user_message: GuestChatMessage;
  assistant_message: GuestChatMessage;
  /** Questions left today for this contract, AFTER this send. */
  remaining: number;
  /** The daily cap (20 in Slice 1 — read it from here, never hardcode). */
  cap: number;
}

/** Classified send/poll failure the panel renders distinct states for. */
export type GuestChatError =
  | { kind: 'daily-limit'; cap: number; resetsAt: string | null }
  | { kind: 'throttled'; retryAfter: number }
  | { kind: 'session-expired' }
  | { kind: 'not-found' }
  | { kind: 'generic' };

export function classifyGuestChatError(err: unknown): GuestChatError {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as
      | {
          error?: string;
          cap?: number;
          resets_at?: string;
          retryAfter?: number;
        }
      | undefined;
    if (status === 401) return { kind: 'session-expired' };
    if (status === 404) return { kind: 'not-found' };
    if (status === 429 && data?.error === 'GUEST_AI_QUERY_DAILY_LIMIT') {
      return {
        kind: 'daily-limit',
        cap: typeof data.cap === 'number' ? data.cap : 20,
        resetsAt: typeof data.resets_at === 'string' ? data.resets_at : null,
      };
    }
    if (status === 429) {
      return {
        kind: 'throttled',
        retryAfter:
          typeof data?.retryAfter === 'number' && data.retryAfter > 0
            ? data.retryAfter
            : 60,
      };
    }
  }
  return { kind: 'generic' };
}

const authHeader = (guestJwt: string) => ({
  headers: { Authorization: `Bearer ${guestJwt}` },
});

export async function createGuestChatSession(
  contractId: string,
  guestJwt: string,
): Promise<GuestChatSessionSummary> {
  const res = await guestHttp.post<GuestChatSessionSummary>(
    `/guest/contracts/${contractId}/chat/sessions`,
    {},
    authHeader(guestJwt),
  );
  return res.data;
}

/**
 * List the guest's chat sessions for this contract (#8c chat-resume),
 * most-recent-first. Powers server-side rediscovery when the localStorage
 * pointer is gone — mirrors the host's findSessionByContract.
 */
export async function listGuestChatSessions(
  contractId: string,
  guestJwt: string,
): Promise<GuestChatSessionListItem[]> {
  const res = await guestHttp.get<GuestChatSessionListItem[]>(
    `/guest/contracts/${contractId}/chat/sessions`,
    authHeader(guestJwt),
  );
  return res.data;
}

export async function getGuestChatSession(
  contractId: string,
  sessionId: string,
  guestJwt: string,
): Promise<GuestChatSessionView> {
  const res = await guestHttp.get<GuestChatSessionView>(
    `/guest/contracts/${contractId}/chat/sessions/${sessionId}`,
    authHeader(guestJwt),
  );
  return res.data;
}

export async function sendGuestChatMessage(
  contractId: string,
  sessionId: string,
  guestJwt: string,
  message: string,
): Promise<GuestChatSendResult> {
  const res = await guestHttp.post<GuestChatSendResult>(
    `/guest/contracts/${contractId}/chat/sessions/${sessionId}/messages`,
    { message },
    // Dispatch returns immediately with a PENDING assistant row (async
    // pipeline) — sub-second normally; the isolated client's 15s default is
    // plenty. The poll below drives it to terminal.
    authHeader(guestJwt),
  );
  return res.data;
}

export async function getGuestChatMessageStatus(
  contractId: string,
  messageId: string,
  guestJwt: string,
): Promise<GuestChatMessage> {
  const res = await guestHttp.get<GuestChatMessage>(
    `/guest/contracts/${contractId}/chat/messages/${messageId}/status`,
    authHeader(guestJwt),
  );
  return res.data;
}
