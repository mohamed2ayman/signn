import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock at the service-level axios instance (./axios imports the Redux store as
// a side effect, so we never mock the raw `axios` package — see CLAUDE.md).
vi.mock('./axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({
      data: {
        userMessage: { id: 'u1', role: 'USER', status: 'COMPLETED' },
        assistantMessage: { id: 'a1', role: 'ASSISTANT', status: 'PENDING' },
      },
    }),
    get: vi.fn().mockResolvedValue({
      data: { id: 'a1', role: 'ASSISTANT', status: 'COMPLETED', content: 'hi' },
    }),
  },
}));

import api from './axios';
import { chatService } from './chatService';

describe('chatService — async chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sendMessage returns { userMessage, assistantMessage } and keeps the 60s timeout', async () => {
    const res = await chatService.sendMessage('sess-1', 'force majeure?');

    expect(api.post).toHaveBeenCalledWith(
      '/chat/sessions/sess-1/messages',
      { message: 'force majeure?' },
      { timeout: 60000 },
    );
    expect(res.assistantMessage.status).toBe('PENDING');
  });

  it('getMessageStatus polls the message-status endpoint', async () => {
    const res = await chatService.getMessageStatus('a1');

    expect(api.get).toHaveBeenCalledWith('/chat/messages/a1/status');
    expect(res.status).toBe('COMPLETED');
  });
});
