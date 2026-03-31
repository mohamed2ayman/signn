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

export interface ChatMessage {
  id: string;
  session_id: string;
  contract_id: string | null;
  user_id: string;
  org_id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  citations: ChatMessageCitation[] | null;
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
      )
      .then((r) => r.data),
};
