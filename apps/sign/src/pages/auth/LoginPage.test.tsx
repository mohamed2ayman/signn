import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import LoginPage from '@/pages/auth/LoginPage';
import { useAuth } from '@/hooks/useAuth';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be at the top
// ─────────────────────────────────────────────────────────────────────────────

// react-i18next: t() returns the key string — matches fallback behaviour
// i18n object needed by LanguageToggle (calls i18n.language / i18n.changeLanguage)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Mock the useAuth hook entirely — avoids axios → Redux store side-effect chain
vi.mock('@/hooks/useAuth');

// ─────────────────────────────────────────────────────────────────────────────
// Default mock return — unauthenticated, idle
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_AUTH = {
  user: null,
  isAuthenticated: false,
  isLoading: false,
  mfaRequired: false,
  mfaMethod: null as null,
  mfaEmail: null as null,
  mfaSetupRequired: false,
  login: vi.fn().mockResolvedValue({}),
  register: vi.fn().mockResolvedValue({}),
  verifyMfa: vi.fn().mockResolvedValue({}),
  verifyRecovery: vi.fn().mockResolvedValue({}),
  refreshUserProfile: vi.fn().mockResolvedValue(undefined),
  completeMfaSetup: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  cancelMfa: vi.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Render helper
// ─────────────────────────────────────────────────────────────────────────────

const renderLoginPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('LoginPage', () => {
  beforeEach(() => {
    // authSlice.initialState reads localStorage — clear to keep tests isolated
    localStorage.clear();
    // Reset to unauthenticated state before each test
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Renders without crashing ─────────────────────────────────────────

  it('renders without crashing', () => {
    renderLoginPage();
    expect(document.body).toBeTruthy();
  });

  // ── 2. Email input is present ───────────────────────────────────────────
  // FormInput renders <label htmlFor="email">{t('auth.email')}<span>*</span></label>
  // Full accessible text = "auth.email *" → use regex for partial match

  it('renders the email input', () => {
    renderLoginPage();
    expect(screen.getByLabelText(/auth\.email/i)).toBeInTheDocument();
  });

  // ── 3. Password input is present ────────────────────────────────────────
  // Same pattern: label text = "auth.password *" → regex

  it('renders the password input', () => {
    renderLoginPage();
    expect(screen.getByLabelText(/auth\.password/i)).toBeInTheDocument();
  });

  // ── 4. Submit button is present ─────────────────────────────────────────
  // Button renders text = t('auth.signIn') → "auth.signIn" — use role + name regex

  it('renders the sign-in submit button', () => {
    renderLoginPage();
    expect(
      screen.getByRole('button', { name: /auth\.signIn/i }),
    ).toBeInTheDocument();
  });

  // ── 5. Submitting empty form does not crash ──────────────────────────────
  // login() is not called when both fields are empty (guard in handleLogin)
  // Component should still be mounted after the click

  it('submitting an empty form does not crash the component', () => {
    renderLoginPage();
    const submitBtn = screen.getByRole('button', { name: /auth\.signIn/i });
    fireEvent.click(submitBtn);
    // Component still renders both inputs — not crashed
    expect(screen.getByLabelText(/auth\.email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/auth\.password/i)).toBeInTheDocument();
  });
});
