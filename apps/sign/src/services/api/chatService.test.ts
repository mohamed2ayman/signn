import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock at the service-level axios instance (./axios imports the Redux store as
// a side effect, so we never mock the raw `axios` package — see CLAUDE.md).
vi.mock('./axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({
      data: { userMessage: {}, assistantMessage: {} },
    }),
  },
}));

import api from './axios';
import { chatService } from './chatService';

describe('chatService.sendMessage — timeout override', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends with a 60s per-request timeout to absorb legal-grounded latency', async () => {
    await chatService.sendMessage('sess-1', 'force majeure?');

    expect(api.post).toHaveBeenCalledWith(
      '/chat/sessions/sess-1/messages',
      { message: 'force majeure?' },
      { timeout: 60000 },
    );
  });
});
