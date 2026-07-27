import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/store/slices/authSlice';
import { GUEST_SESSION_KEY } from '@/services/guestSession';

// ── Module mocks (hoisted) ──────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Heavy children stubbed — the flow under test lives in GuestViewerPage's CTA +
// the (REAL) EstablishIdentityModal, not these.
vi.mock('@/components/guest/GuestLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/guest/GuestContractView', () => ({
  default: () => <div>contract-view</div>,
}));
vi.mock('@/components/guest/GuestChatPanel', () => ({ default: () => null }));
vi.mock('@/components/guest/GuestComments', () => ({
  default: () => <div>COMMENTS PANEL</div>,
}));

const exchangeInvitation = vi.fn();
const establishGuestIdentity = vi.fn();
vi.mock('@/services/api/guestService', () => ({
  exchangeInvitation: (...a: unknown[]) => exchangeInvitation(...a),
  establishGuestIdentity: (...a: unknown[]) => establishGuestIdentity(...a),
}));
const getViewerContract = vi.fn();
vi.mock('@/services/api/viewerService', () => ({
  getViewerContract: (...a: unknown[]) => getViewerContract(...a),
}));

import GuestViewerPage from './GuestViewerPage';

const makeStore = () =>
  configureStore({ reducer: { auth: authReducer } });

const renderViewer = (store: ReturnType<typeof makeStore>) =>
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/guest/view?token=tok-abc']}>
        <Routes>
          <Route path="/guest/view" element={<GuestViewerPage />} />
          <Route path="/guest/dashboard" element={<div>DASHBOARD SENTINEL</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

const VALID_PASSWORD = 'ReturnPass1!xyz'; // ≥12, upper, digit, special

const mockExchange = (accountExists: boolean) =>
  exchangeInvitation.mockResolvedValue({
    viewer_token: 'vt',
    viewer_expires_at: new Date(Date.now() + 60_000).toISOString(),
    contract_id: 'c1',
    invited_language: 'en',
    account_exists: accountExists,
  });

const mockEstablishSuccess = () =>
  establishGuestIdentity.mockResolvedValue({
    user: { id: 'g1', email: 'ret@guest.test', role: 'GUEST', first_name: 'Ret', last_name: 'Guest' },
    access_token: 'guest-access',
    // The API returns a refresh token, but the guest hydration MUST NOT persist it.
    refresh_token: 'guest-refresh',
    requires_login: false,
    contract_id: 'c1',
    resume: { kind: null, route: null },
  });

const axios401 = () =>
  Object.assign(new Error('401'), {
    isAxiosError: true,
    response: { status: 401 },
  });

describe('GuestViewerPage — returning guest (account_exists=true)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    mockExchange(true);
    getViewerContract.mockResolvedValue({ id: 'c1', name: 'Test Contract' });
    mockEstablishSuccess();
  });

  it('shows the returning CTA + modal copy: "enter your password", current-password, NO confirm field, no name fields', async () => {
    const store = makeStore();
    const { container } = renderViewer(store);

    // Returning CTA copy on the viewer card.
    const cta = await screen.findByText('guest.commentCta.returningButton');
    expect(screen.getByText('guest.commentCta.returningTitle')).toBeInTheDocument();
    fireEvent.click(cta);

    // Returning modal copy.
    expect(screen.getByText('guest.identity.returning.title')).toBeInTheDocument();
    expect(screen.getByText('guest.identity.returning.subtitle')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'guest.identity.returning.submit' }),
    ).toBeInTheDocument();

    // Exactly ONE password input, autoComplete=current-password, no names.
    const pw = container.querySelectorAll('input[type="password"]');
    expect(pw).toHaveLength(1);
    expect(pw[0].getAttribute('autocomplete')).toBe('current-password');
    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(0);
    // The create-mode complexity hint is absent.
    expect(screen.queryByText('guest.identity.passwordHint')).not.toBeInTheDocument();
  });

  it('password submit → saves the GUEST-ONLY sessionStorage session (access only) and NAVIGATES to /guest/dashboard', async () => {
    const store = makeStore();
    const { container } = renderViewer(store);

    fireEvent.click(await screen.findByText('guest.commentCta.returningButton'));
    const pw = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pw, { target: { value: VALID_PASSWORD } });
    fireEvent.click(
      screen.getByRole('button', { name: 'guest.identity.returning.submit' }),
    );

    await waitFor(() =>
      expect(screen.getByText('DASHBOARD SENTINEL')).toBeInTheDocument(),
    );

    // The session lives in sessionStorage under the GUEST key — access only.
    const stored = JSON.parse(
      sessionStorage.getItem(GUEST_SESSION_KEY) as string,
    );
    expect(stored.token).toBe('guest-access');
    expect(stored.user.id).toBe('g1');
    expect(JSON.stringify(stored)).not.toContain('guest-refresh');
    // NOT in localStorage, NOT in the shared managing slots, NOT in redux.
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(store.getState().auth.isAuthenticated).toBe(false);
    expect(store.getState().auth.token).toBeNull();
  });

  it('a returning guest can use their EXISTING password even if it predates the complexity rule (no client regex gate)', async () => {
    const store = makeStore();
    const { container } = renderViewer(store);

    fireEvent.click(await screen.findByText('guest.commentCta.returningButton'));
    const pw = container.querySelector('input[type="password"]') as HTMLInputElement;
    // Would FAIL the create-mode PASSWORD_RE — must still be submitted as-is.
    fireEvent.change(pw, { target: { value: 'short-legacy' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'guest.identity.returning.submit' }),
    );

    await waitFor(() => expect(establishGuestIdentity).toHaveBeenCalledTimes(1));
    expect(establishGuestIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'short-legacy' }),
    );
    // Names are never sent in returning mode.
    expect(establishGuestIdentity.mock.calls[0][0].first_name).toBeUndefined();
  });

  it('WRONG password (401) in returning mode is RECOVERABLE — inline error, form stays, NOT the terminal blocked state', async () => {
    establishGuestIdentity.mockRejectedValueOnce(axios401());
    const store = makeStore();
    const { container } = renderViewer(store);

    fireEvent.click(await screen.findByText('guest.commentCta.returningButton'));
    const pw = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pw, { target: { value: 'WrongGuess1!aaaa' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'guest.identity.returning.submit' }),
    );

    await waitFor(() =>
      expect(
        screen.getByText('guest.identity.errors.wrongPassword'),
      ).toBeInTheDocument(),
    );
    // Still the form (recoverable), NOT the terminal blocked screen.
    expect(screen.queryByText('guest.identity.blocked.title')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="password"]')).toBeInTheDocument();
    // No navigation, no session saved on failure.
    expect(screen.queryByText('DASHBOARD SENTINEL')).not.toBeInTheDocument();
    expect(sessionStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
    expect(store.getState().auth.isAuthenticated).toBe(false);
  });

  it('an MFA real account (requires_login, null token) does NOT hydrate or navigate — the modal owns that state', async () => {
    establishGuestIdentity.mockResolvedValueOnce({
      user: { id: 'm1', email: 'mfa@managing.test', account_type: 'MANAGING' },
      access_token: null,
      refresh_token: null,
      requires_login: true,
      contract_id: 'c1',
      resume: { kind: null, route: null },
    });
    const store = makeStore();
    const { container } = renderViewer(store);

    fireEvent.click(await screen.findByText('guest.commentCta.returningButton'));
    const pw = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(pw, { target: { value: VALID_PASSWORD } });
    fireEvent.click(
      screen.getByRole('button', { name: 'guest.identity.returning.submit' }),
    );

    await waitFor(() =>
      expect(screen.getByText('guest.identity.linked.title')).toBeInTheDocument(),
    );
    expect(screen.queryByText('DASHBOARD SENTINEL')).not.toBeInTheDocument();
    expect(store.getState().auth.isAuthenticated).toBe(false);
    expect(sessionStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
  });
});

describe('GuestViewerPage — first-time guest (account_exists=false)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    mockExchange(false);
    getViewerContract.mockResolvedValue({ id: 'c1', name: 'Test Contract' });
    mockEstablishSuccess();
  });

  it('shows the create-password copy: names + password + confirm, new-password, complexity hint', async () => {
    const store = makeStore();
    const { container } = renderViewer(store);

    const cta = await screen.findByText('guest.commentCta.button');
    expect(screen.getByText('guest.commentCta.title')).toBeInTheDocument();
    fireEvent.click(cta);

    expect(screen.getByText('guest.identity.title')).toBeInTheDocument();
    const pw = container.querySelectorAll('input[type="password"]');
    expect(pw).toHaveLength(2);
    expect(pw[0].getAttribute('autocomplete')).toBe('new-password');
    expect(pw[1].getAttribute('autocomplete')).toBe('new-password');
    // Name fields present in create mode.
    expect(container.querySelectorAll('input[type="text"]').length).toBe(2);
    expect(screen.getByText('guest.identity.passwordHint')).toBeInTheDocument();
  });

  it('create-password submit → saves the guest session but STAYS on the contract viewer (no dashboard navigation)', async () => {
    const store = makeStore();
    const { container } = renderViewer(store);

    fireEvent.click(await screen.findByText('guest.commentCta.button'));
    const pw = container.querySelectorAll('input[type="password"]');
    fireEvent.change(pw[0], { target: { value: VALID_PASSWORD } });
    fireEvent.change(pw[1], { target: { value: VALID_PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'guest.identity.submit' }));

    // Stays on the viewer: comments panel appears, no navigation.
    await waitFor(() =>
      expect(screen.getByText('COMMENTS PANEL')).toBeInTheDocument(),
    );
    expect(screen.queryByText('DASHBOARD SENTINEL')).not.toBeInTheDocument();
    expect(screen.getByText('contract-view')).toBeInTheDocument();

    // Session STILL saved (dashboard reachable later) — guest key, access only.
    const stored = JSON.parse(
      sessionStorage.getItem(GUEST_SESSION_KEY) as string,
    );
    expect(stored.token).toBe('guest-access');
    expect(JSON.stringify(stored)).not.toContain('guest-refresh');
    // Shared slots + redux untouched.
    expect(localStorage.length).toBe(0);
    expect(store.getState().auth.isAuthenticated).toBe(false);
  });

  it('WRONG-password-shaped 401 in CREATE mode stays TERMINAL (blocked state) — unchanged behavior', async () => {
    establishGuestIdentity.mockRejectedValueOnce(axios401());
    const store = makeStore();
    const { container } = renderViewer(store);

    fireEvent.click(await screen.findByText('guest.commentCta.button'));
    const pw = container.querySelectorAll('input[type="password"]');
    fireEvent.change(pw[0], { target: { value: VALID_PASSWORD } });
    fireEvent.change(pw[1], { target: { value: VALID_PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'guest.identity.submit' }));

    // Renders TWICE by design: the modal's blocked state AND the page-level
    // CTA swap that onUnusable triggers (so the doomed form can't reopen).
    await waitFor(() =>
      expect(
        screen.getAllByText('guest.identity.blocked.title').length,
      ).toBeGreaterThanOrEqual(1),
    );
    expect(sessionStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
    expect(store.getState().auth.isAuthenticated).toBe(false);
  });
});
