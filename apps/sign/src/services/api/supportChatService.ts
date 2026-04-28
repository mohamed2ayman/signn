import api from './axios';

// ─── Types (mirroring backend entities, only fields the UI needs) ──────────

export type SupportChatStatus =
  | 'WAITING'
  | 'ACTIVE'
  | 'TRANSFERRED'
  | 'CLOSED';

export type SupportChatSenderRole = 'USER' | 'OPS' | 'SYSTEM';

export interface SupportChat {
  id: string;
  user_id: string;
  organization_id: string | null;
  status: SupportChatStatus;
  topic: string;
  assigned_ops_id: string | null;
  previous_ops_id: string | null;
  closed_by: string | null;
  closed_reason: string | null;
  csat_rating: number | null;
  csat_comment: string | null;
  converted_ticket_id: string | null;
  queued_at: string | null;
  assigned_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  user?: { id: string; email: string; first_name?: string; last_name?: string };
}

export interface SupportChatMessage {
  id: string;
  chat_id: string;
  sender_id: string | null;
  sender_role: SupportChatSenderRole;
  body: string;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  created_at: string;
}

export interface SupportChatNote {
  id: string;
  chat_id: string;
  ops_id: string;
  body: string;
  created_at: string;
  ops?: { id: string; email: string; first_name?: string; last_name?: string };
}

export interface CannedResponse {
  id: string;
  organization_id: string | null;
  shortcut: string;
  title: string;
  body: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface QueueEntry extends SupportChat {
  queue_position: number;
  estimated_wait_ms: number;
}

export interface CsatStats {
  total_responses: number;
  average_rating: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  recent_comments: Array<{
    chat_id: string;
    rating: number;
    comment: string;
    created_at: string;
  }>;
}

export interface OnlineOps {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: 'ONLINE' | 'AWAY';
}

// ─── User-side endpoints ───────────────────────────────────────────────────

export const supportChatService = {
  startChat: async (topic: string): Promise<SupportChat> => {
    const res = await api.post('/support/chat', { topic });
    return res.data;
  },

  getMyChats: async (): Promise<SupportChat[]> => {
    const res = await api.get('/support/chat/me');
    return res.data;
  },

  getChat: async (
    id: string,
  ): Promise<SupportChat & { messages: SupportChatMessage[] }> => {
    const res = await api.get(`/support/chat/${id}`);
    return res.data;
  },

  sendMessage: async (
    chatId: string,
    body: string,
    attachment?: File,
  ): Promise<SupportChatMessage> => {
    const fd = new FormData();
    if (body) fd.append('body', body);
    if (attachment) fd.append('attachment', attachment);
    const res = await api.post(`/support/chat/${chatId}/message`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  submitCsat: async (
    chatId: string,
    rating: number,
    comment?: string,
  ): Promise<SupportChat> => {
    const res = await api.post(`/support/chat/${chatId}/csat`, {
      rating,
      comment,
    });
    return res.data;
  },

  // ─── Ops-side endpoints ──────────────────────────────────────────────

  ops: {
    queue: async (): Promise<QueueEntry[]> => {
      const res = await api.get('/admin/support/chat/queue');
      return res.data;
    },
    activeForMe: async (): Promise<SupportChat[]> => {
      const res = await api.get('/admin/support/chat/active');
      return res.data;
    },
    csatStats: async (): Promise<CsatStats> => {
      const res = await api.get('/admin/support/chat/csat-stats');
      return res.data;
    },
    onlineOps: async (): Promise<OnlineOps[]> => {
      const res = await api.get('/admin/support/availability/online');
      return res.data;
    },
    getChat: async (
      id: string,
    ): Promise<SupportChat & { messages: SupportChatMessage[] }> => {
      const res = await api.get(`/admin/support/chat/${id}`);
      return res.data;
    },
    claim: async (id: string): Promise<SupportChat> => {
      const res = await api.post(`/admin/support/chat/${id}/claim`);
      return res.data;
    },
    transfer: async (
      id: string,
      toOpsId: string,
      reason?: string,
    ): Promise<SupportChat> => {
      const res = await api.post(`/admin/support/chat/${id}/transfer`, {
        to_ops_id: toOpsId,
        reason,
      });
      return res.data;
    },
    close: async (
      id: string,
      reason: 'resolved' | 'transferred_to_ticket' | 'user_left',
    ): Promise<SupportChat> => {
      const res = await api.post(`/admin/support/chat/${id}/close`, { reason });
      return res.data;
    },
    addNote: async (id: string, body: string): Promise<SupportChatNote> => {
      const res = await api.post(`/admin/support/chat/${id}/notes`, { body });
      return res.data;
    },
    listNotes: async (id: string): Promise<SupportChatNote[]> => {
      const res = await api.get(`/admin/support/chat/${id}/notes`);
      return res.data;
    },
    convertToTicket: async (
      id: string,
      data?: {
        priority?: 'low' | 'medium' | 'high' | 'urgent';
        subject?: string;
      },
    ): Promise<{ ticket_id: string; already_converted: boolean }> => {
      const res = await api.post(
        `/admin/support/chat/${id}/convert-to-ticket`,
        data ?? {},
      );
      return res.data;
    },
    listCanned: async (): Promise<CannedResponse[]> => {
      const res = await api.get('/admin/support/canned-responses');
      return res.data;
    },
    createCanned: async (
      shortcut: string,
      title: string,
      body: string,
    ): Promise<CannedResponse> => {
      const res = await api.post('/admin/support/canned-responses', {
        shortcut,
        title,
        body,
      });
      return res.data;
    },
    updateCanned: async (
      id: string,
      data: Partial<{ shortcut: string; title: string; body: string }>,
    ): Promise<CannedResponse> => {
      const res = await api.patch(
        `/admin/support/canned-responses/${id}`,
        data,
      );
      return res.data;
    },
    removeCanned: async (id: string): Promise<void> => {
      await api.delete(`/admin/support/canned-responses/${id}`);
    },
    getAvailability: async (): Promise<{
      ops_id: string;
      status: 'ONLINE' | 'AWAY' | 'OFFLINE';
      last_changed_at: string;
    }> => {
      const res = await api.get('/admin/support/availability');
      return res.data;
    },
    setAvailability: async (
      status: 'ONLINE' | 'AWAY' | 'OFFLINE',
    ): Promise<void> => {
      await api.put('/admin/support/availability', { status });
    },
  },
};
