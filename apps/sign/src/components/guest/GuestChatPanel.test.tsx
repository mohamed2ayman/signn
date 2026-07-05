import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import GuestChatPanel from '@/components/guest/GuestChatPanel';
import {
  createGuestChatSession,
  getGuestChatMessageStatus,
  getGuestChatSession,
  sendGuestChatMessage,
  type GuestChatMessage,
} from '@/services/api/guestChatService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
// Keep the REAL classifyGuestChatError (it drives the state machine under
// test); mock only the network calls.
vi.mock('@/services/api/guestChatService', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/services/api/guestChatService')
  >()),
  createGuestChatSession: vi.fn(),
  getGuestChatSession: vi.fn(),
  sendGuestChatMessage: vi.fn(),
  getGuestChatMessageStatus: vi.fn(),
}));
vi.mock('@/components/common/AIDisclaimer', () => ({ default: () => null }));
vi.mock('@/components/common/SignLogo', () => ({
  BloomIcon: () => null,
}));

const mockCreate = vi.mocked(createGuestChatSession);
const mockGetSession = vi.mocked(getGuestChatSession);
const mockSend = vi.mocked(sendGuestChatMessage);
const mockStatus = vi.mocked(getGuestChatMessageStatus);

const axiosErr = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });

const SESSION = { id: 'sid-1', contract_id: 'c-1', created_at: 'now' };

const userMsg = (content: string): GuestChatMessage => ({
  id: `u-${content}`,
  role: 'USER',
  content,
  citations: null,
  status: 'COMPLETED',
  created_at: new Date().toISOString(),
});

const assistantMsg = (
  over: Partial<GuestChatMessage> = {},
): GuestChatMessage => ({
  id: 'a-1',
  role: 'ASSISTANT',
  content: null,
  citations: null,
  status: 'PENDING',
  error_message: null,
  created_at: new Date().toISOString(),
  ...over,
});

const CLAUSES = [
  { section_number: '14', title: 'Payment', content: 'Payment clause body' },
];

function renderPanel(over: Record<string, unknown> = {}) {
  const onSessionExpired = vi.fn();
  const utils = render(
    <GuestChatPanel
      contractId="c-1"
      clauses={CLAUSES}
      guestJwt="jwt-1"
      isOpen
      onClose={vi.fn()}
      onSessionExpired={onSessionExpired}
      {...over}
    />,
  );
  return { ...utils, onSessionExpired };
}

const sendOk = (remaining = 17, cap = 20, question = 'q') =>
  mockSend.mockResolvedValue({
    user_message: userMsg(question),
    assistant_message: assistantMsg(),
    remaining,
    cap,
  });

async function typeAndSend(question = 'q') {
  fireEvent.change(screen.getByPlaceholderText('guest.assistant.placeholder'), {
    target: { value: question },
  });
  fireEvent.click(screen.getByLabelText('guest.assistant.send'));
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  mockCreate.mockResolvedValue(SESSION);
  // Default poll response: still in flight (tests override per scenario).
  mockStatus.mockResolvedValue(assistantMsg());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GuestChatPanel — empty state / first open', () => {
  it('shows the welcome + the 4 suggested questions when no prior session exists', () => {
    renderPanel();
    expect(screen.getByText('guest.assistant.welcomeTitle')).toBeInTheDocument();
    expect(screen.getByText('guest.assistant.suggested1')).toBeInTheDocument();
    expect(screen.getByText('guest.assistant.suggested4')).toBeInTheDocument();
    expect(mockGetSession).not.toHaveBeenCalled(); // nothing stored
  });

  it('a suggested-question tap creates the session and dispatches the send', async () => {
    sendOk();
    renderPanel();
    fireEvent.click(screen.getByText('guest.assistant.suggested1'));
    await act(async () => {});
    expect(mockCreate).toHaveBeenCalledWith('c-1', 'jwt-1');
    expect(mockSend).toHaveBeenCalledWith(
      'c-1',
      'sid-1',
      'jwt-1',
      'guest.assistant.suggested1',
    );
  });
});

describe('GuestChatPanel — send → thinking → answered lifecycle', () => {
  it('renders the thinking dots for the PENDING assistant message', async () => {
    sendOk();
    renderPanel();
    await typeAndSend('What is §14?');
    expect(
      screen.getByLabelText('guest.assistant.thinking'),
    ).toBeInTheDocument();
  });

  it('polls every 1.5s and renders the answer + a §citation chip on completion', async () => {
    vi.useFakeTimers();
    sendOk();
    mockStatus.mockResolvedValue(
      assistantMsg({ status: 'COMPLETED', content: 'Payment is due per §14.' }),
    );
    renderPanel();
    await typeAndSend('When do I get paid?');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(screen.getByText(/Payment is due per/)).toBeInTheDocument();
    // Chip = matched against the REAL clause list (section 14 exists).
    expect(screen.getByText('§14 — Payment')).toBeInTheDocument();

    // Polling stops after the terminal status.
    const calls = mockStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockStatus.mock.calls.length).toBe(calls);
  });

  it('caps polling at 90s and swaps to the still-working hint', async () => {
    vi.useFakeTimers();
    sendOk();
    mockStatus.mockResolvedValue(assistantMsg()); // forever PENDING
    renderPanel();
    await typeAndSend('slow one');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(92_000);
    });
    expect(screen.getByText('guest.assistant.stillWorking')).toBeInTheDocument();
  });

  it('updates the quota pill from the REAL {remaining, cap} on each send', async () => {
    sendOk(17, 20);
    renderPanel();
    await typeAndSend('q1');
    expect(
      screen.getByTestId('guest-chat-quota-pill').textContent,
    ).toContain('{"n":17,"limit":20}');
  });
});

describe('GuestChatPanel — rate limits', () => {
  it('429 GUEST_AI_QUERY_DAILY_LIMIT → amber cap card + disabled composer + capped placeholder', async () => {
    mockSend.mockRejectedValue(
      axiosErr(429, {
        error: 'GUEST_AI_QUERY_DAILY_LIMIT',
        remaining: 0,
        cap: 20,
        resets_at: '2026-07-05T00:00:00.000Z',
      }),
    );
    renderPanel();
    await typeAndSend('one too many');

    expect(screen.getByTestId('guest-chat-cap-card')).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(
      'guest.assistant.placeholderCapped',
    );
    expect(textarea).toBeDisabled();
  });

  it('plain 429 (burst throttle) → transient notice, input restored, composer stays enabled', async () => {
    vi.useFakeTimers();
    mockSend.mockRejectedValue(
      axiosErr(429, { error: 'Too Many Requests', retryAfter: 2 }),
    );
    renderPanel();
    await typeAndSend('too fast');

    expect(
      screen.getByTestId('guest-chat-throttle-notice'),
    ).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText('guest.assistant.placeholder');
    expect(textarea).not.toBeDisabled();
    expect((textarea as HTMLTextAreaElement).value).toBe('too fast');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(
      screen.queryByTestId('guest-chat-throttle-notice'),
    ).not.toBeInTheDocument();
  });
});

describe('GuestChatPanel — errors + retry', () => {
  it('dispatch failure renders an in-thread error bubble; Retry resends the question', async () => {
    mockSend.mockRejectedValueOnce(new Error('network down'));
    renderPanel();
    await typeAndSend('flaky');

    expect(screen.getByText('guest.assistant.errorText')).toBeInTheDocument();

    sendOk(16, 20, 'flaky');
    fireEvent.click(screen.getByText('guest.assistant.retry'));
    await act(async () => {});
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText('guest.assistant.errorText'),
    ).not.toBeInTheDocument();
  });

  it('401 on send → session-expired notice + disabled composer + onSessionExpired fired once', async () => {
    mockSend.mockRejectedValue(axiosErr(401, {}));
    const { onSessionExpired } = renderPanel();
    await typeAndSend('expired');

    expect(screen.getByTestId('guest-chat-expired')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('guest.assistant.placeholder'),
    ).toBeDisabled();
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

describe('GuestChatPanel — refresh-resume + New Chat', () => {
  it('resumes a stored session: renders history and re-polls the in-flight turn', async () => {
    localStorage.setItem('guest-chat-session:c-1', 'sid-1');
    mockGetSession.mockResolvedValue({
      ...SESSION,
      messages: [
        userMsg('earlier question'),
        assistantMsg({ id: 'a-old', status: 'PENDING' }),
      ],
    });
    mockStatus.mockResolvedValue(
      assistantMsg({ id: 'a-old', status: 'COMPLETED', content: 'done now' }),
    );
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText('earlier question')).toBeInTheDocument(),
    );
    expect(mockGetSession).toHaveBeenCalledWith('c-1', 'sid-1', 'jwt-1');
    // The immediate first poll of the resumed in-flight message.
    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
  });

  it('clears a stale stored session on 404 and falls back to the empty state', async () => {
    localStorage.setItem('guest-chat-session:c-1', 'sid-stale');
    mockGetSession.mockRejectedValue(axiosErr(404, {}));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText('guest.assistant.welcomeTitle')).toBeInTheDocument(),
    );
    expect(localStorage.getItem('guest-chat-session:c-1')).toBeNull();
  });

  it('New Chat starts a fresh server session and keeps the quota pill (no reset exploit)', async () => {
    sendOk(12, 20);
    renderPanel();
    await typeAndSend('q1');
    expect(screen.getByTestId('guest-chat-quota-pill')).toBeInTheDocument();

    mockCreate.mockResolvedValue({ ...SESSION, id: 'sid-2' });
    fireEvent.click(screen.getByText('guest.assistant.newChat'));
    await act(async () => {});

    // Thread cleared, but the daily quota display persists.
    expect(screen.getByText('guest.assistant.welcomeTitle')).toBeInTheDocument();
    expect(screen.getByTestId('guest-chat-quota-pill')).toBeInTheDocument();
    expect(localStorage.getItem('guest-chat-session:c-1')).toBe('sid-2');
  });
});
