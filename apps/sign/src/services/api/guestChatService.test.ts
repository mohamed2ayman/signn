import {
  classifyGuestChatError,
  createGuestChatSession,
  getGuestChatMessageStatus,
  getGuestChatSession,
  sendGuestChatMessage,
} from './guestChatService';
import { guestHttp } from './guestHttp';

// Service-level isolation: mock the ISOLATED guest client, never global axios
// (Phase 2.2 rule — axios.ts pulls the Redux store as a side effect).
vi.mock('./guestHttp', () => ({
  guestHttp: { post: vi.fn(), get: vi.fn() },
  GUEST_API_BASE_URL: 'http://test/api/v1',
}));

const mockedPost = vi.mocked(guestHttp.post);
const mockedGet = vi.mocked(guestHttp.get);

const axiosErr = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });

describe('guestChatService — endpoints + explicit guest JWT', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createGuestChatSession posts to the guest chat route with the Bearer JWT', async () => {
    mockedPost.mockResolvedValue({
      data: { id: 's1', contract_id: 'c1', created_at: 'now' },
    });
    const res = await createGuestChatSession('c1', 'jwt-1');
    expect(mockedPost).toHaveBeenCalledWith(
      '/guest/contracts/c1/chat/sessions',
      {},
      { headers: { Authorization: 'Bearer jwt-1' } },
    );
    expect(res.id).toBe('s1');
  });

  it('getGuestChatSession fetches history for resume', async () => {
    mockedGet.mockResolvedValue({
      data: { id: 's1', contract_id: 'c1', created_at: 'now', messages: [] },
    });
    await getGuestChatSession('c1', 's1', 'jwt-1');
    expect(mockedGet).toHaveBeenCalledWith(
      '/guest/contracts/c1/chat/sessions/s1',
      { headers: { Authorization: 'Bearer jwt-1' } },
    );
  });

  it('sendGuestChatMessage posts the question and returns {remaining, cap}', async () => {
    mockedPost.mockResolvedValue({
      data: {
        user_message: { id: 'u1' },
        assistant_message: { id: 'a1', status: 'PENDING' },
        remaining: 17,
        cap: 20,
      },
    });
    const res = await sendGuestChatMessage('c1', 's1', 'jwt-1', 'question?');
    expect(mockedPost).toHaveBeenCalledWith(
      '/guest/contracts/c1/chat/sessions/s1/messages',
      { message: 'question?' },
      { headers: { Authorization: 'Bearer jwt-1' } },
    );
    expect(res.remaining).toBe(17);
    expect(res.cap).toBe(20);
  });

  it('getGuestChatMessageStatus polls the status route', async () => {
    mockedGet.mockResolvedValue({ data: { id: 'a1', status: 'COMPLETED' } });
    await getGuestChatMessageStatus('c1', 'a1', 'jwt-1');
    expect(mockedGet).toHaveBeenCalledWith(
      '/guest/contracts/c1/chat/messages/a1/status',
      { headers: { Authorization: 'Bearer jwt-1' } },
    );
  });
});

describe('guestChatService — 429/401 classification (the UI contract)', () => {
  it('classifies the daily-cap 429 with cap + resets_at', () => {
    const err = axiosErr(429, {
      error: 'GUEST_AI_QUERY_DAILY_LIMIT',
      remaining: 0,
      cap: 20,
      resets_at: '2026-07-05T00:00:00.000Z',
    });
    expect(classifyGuestChatError(err)).toEqual({
      kind: 'daily-limit',
      cap: 20,
      resetsAt: '2026-07-05T00:00:00.000Z',
    });
  });

  it('classifies the burst-throttle 429 (named-throttler shape, no error code)', () => {
    const err = axiosErr(429, {
      error: 'Too Many Requests',
      retryAfter: 42,
    });
    expect(classifyGuestChatError(err)).toEqual({
      kind: 'throttled',
      retryAfter: 42,
    });
  });

  it('classifies 401 as session-expired and 404 as not-found', () => {
    expect(classifyGuestChatError(axiosErr(401, {})).kind).toBe(
      'session-expired',
    );
    expect(classifyGuestChatError(axiosErr(404, {})).kind).toBe('not-found');
  });

  it('falls back to generic for non-axios / other errors', () => {
    expect(classifyGuestChatError(new Error('boom')).kind).toBe('generic');
    expect(classifyGuestChatError(axiosErr(500, {})).kind).toBe('generic');
  });
});
