import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import TopBar from '@/components/layout/TopBar';
import { notificationService } from '@/services/api/notificationService';
import authReducer from '@/store/slices/authSlice';

// ── Service mock ──────────────────────────────────────────────────
vi.mock('@/services/api/notificationService', () => ({
  notificationService: {
    getUnreadCount: vi.fn(),
  },
}));

// ── useAuth mock — TopBar only consumes `logout` ──────────────────
vi.mock('@/hooks/useAuth', () => ({
  default: () => ({ logout: vi.fn() }),
}));

// ── i18n mock ─────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string) => fallback ?? k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// LanguageToggle reaches into i18next at module load — stub it out.
vi.mock('@/components/common/LanguageToggle', () => ({
  default: () => null,
}));
vi.mock('@/components/common/ManagexLogo', () => ({
  ManagexMark: () => null,
}));

function makeStore(authState: Record<string, unknown> = {}) {
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        user: { id: 'u-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
        isAuthenticated: true,
        isLoading: false,
        mfaRequired: false,
        mfaMethod: null,
        mfaEmail: null,
        mfaSetupRequired: false,
        ...authState,
      } as unknown as ReturnType<typeof authReducer>,
    },
  });
}

function renderTopBar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <Provider store={makeStore()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TopBar />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
}

describe('TopBar bell badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing in the badge when unread count is zero', async () => {
    vi.mocked(notificationService.getUnreadCount).mockResolvedValue({ count: 0 });
    renderTopBar();
    // Give React Query a tick to settle
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('9+')).not.toBeInTheDocument();
    // No bare digit badge child
    expect(screen.queryByText(/^[1-9]$/)).not.toBeInTheDocument();
  });

  it('renders the unread count when fetch returns a value', async () => {
    vi.mocked(notificationService.getUnreadCount).mockResolvedValue({ count: 4 });
    renderTopBar();
    await screen.findByText('4');
    expect(notificationService.getUnreadCount).toHaveBeenCalled();
  });

  it('caps the badge display at 9+ when count > 9', async () => {
    vi.mocked(notificationService.getUnreadCount).mockResolvedValue({ count: 23 });
    renderTopBar();
    await screen.findByText('9+');
  });

  it('keeps the badge at 0 (hidden) when the query is undefined (default)', () => {
    vi.mocked(notificationService.getUnreadCount).mockReturnValue(
      new Promise(() => {
        /* never resolves — simulates initial render before data lands */
      }),
    );
    renderTopBar();
    // No badge digits should appear yet
    expect(screen.queryByText('9+')).not.toBeInTheDocument();
  });
});
