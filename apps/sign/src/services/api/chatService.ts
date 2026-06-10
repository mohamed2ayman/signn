import api from './axios';

export interface ChatSession {
  id: string;
  contract_id: string | null;
  user_id: string;
  org_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageCitation {
  source: string;
  excerpt: string;
  [key: string]: any;
}

export type ChatMessageStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED';

export interface ChatMessage {
  id: string;
  session_id: string;
  contract_id: string | null;
  user_id: string;
  org_id: string;
  role: 'USER' | 'ASSISTANT';
  // Nullable while an async ASSISTANT message is still being generated.
  content: string | null;
  citations: ChatMessageCitation[] | null;
  // Async lifecycle (Phase 7.27). USER messages arrive COMPLETED; the
  // ASSISTANT message starts PENDING and is polled to COMPLETED/FAILED.
  status: ChatMessageStatus;
  job_id?: string | null;
  error_message?: string | null;
  created_at: string;
}

export interface SendMessageResponse {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export const chatService = {
  createSession: (contractId?: string) =>
    api
      .post<ChatSession>('/chat/sessions', {
        contract_id: contractId,
      })
      .then((r) => r.data),

  findSessionByContract: (contractId: string) =>
    api
      .get<ChatSession | null>('/chat/sessions/by-contract', {
        params: { contract_id: contractId },
      })
      .then((r) => r.data),

  getMessages: (sessionId: string) =>
    api
      .get<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`)
      .then((r) => r.data),

  sendMessage: (sessionId: string, message: string) =>
    api
      .post<SendMessageResponse>(
        `/chat/sessions/${sessionId}/messages`,
        { message },
        // Async chat (Phase 7.27): the backend now returns immediately with a
        // PENDING assistant message and the client polls getMessageStatus, so
        // this call is sub-second. The 60s override is kept as harmless
        // defense-in-depth; it should never trigger.
        { timeout: 60000 },
      )
      .then((r) => r.data),

  // Poll the assistant message until status is COMPLETED or FAILED. Each poll
  // is fast, so it uses the default (15s) axios timeout.
  getMessageStatus: (messageId: string) =>
    api
      .get<ChatMessage>(`/chat/messages/${messageId}/status`)
      .then((r) => r.data),
};
