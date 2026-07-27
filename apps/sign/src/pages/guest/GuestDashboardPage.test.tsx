import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import GuestDashboardPage from '@/pages/guest/GuestDashboardPage';
import { getMyGuestContracts } from '@/services/api/guestService';
import type { SharedContractRow } from '@/services/api/sharedContractsService';
import { GUEST_SESSION_KEY, saveGuestSession } from '@/services/guestSession';

// ── Navigation spy — the shared row calls useNavigate. ────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── i18n passthrough — must also expose `i18n` because the header renders
//    <LanguageToggle/> which reads i18n.language. ──────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// ── Data — #8c Part 1: the dashboard fetches over the ISOLATED guestHttp
//    (getMyGuestContracts) with the guest-session Bearer, never the shared
//    api client. ────────────────────────────────────────────────────────
vi.mock('@/services/api/guestService', () => ({
  getMyGuestContracts: vi.fn(),
}));

const GUEST_USER = {
  id: 'u-guest-1',
  email: 'guest@external.example',
  first_name: 'Guest',
  last_name: 'User',
};

// A decodable fake guest JWT — payload carries role + a future exp so the
// real guestSession module stores/reads it as live.
const guestJwt = (expSecFromNow = 3600) =>
  `hdr.${btoa(
    JSON.stringify({
      sub: GUEST_USER.id,
      role: 'GUEST',
      exp: Math.floor(Date.now() / 1000) + expSecFromNow,
    }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.sig`;

const seedGuestSession = () => saveGuestSession(guestJwt(), GUEST_USER as never);

const ROW_ACTIVE: SharedContractRow = {
  contract_id: 'cccccccc-0000-0000-0000-000000000001',
  contract_name: 'Alexandria Metro Line 3',
  contract_type: 'FIDIC_RED_BOOK_2017',
  status: 'ACTIVE',
  signature_status: 'FULLY_EXECUTED',
  party_first_name: 'NAT',
  party_second_name: 'Acme',
  project_name: 'Metro Phase 2',
  shared_by_org: 'Acme Construction',
  shared_by_user: 'Sara Ahmed',
  granted_at: '2026-07-12T10:00:00.000Z',
};

const ROW_DRAFT: SharedContractRow = {
  contract_id: 'cccccccc-0000-0000-0000-000000000002',
  contract_name: 'Cairo Bridge Works',
  contract_type: 'NEC4',
  status: 'DRAFT',
  signature_status: null,
  party_first_name: null,
  party_second_name: null,
  project_name: null,
  shared_by_org: null,
  shared_by_user: null,
  granted_at: '2026-07-01T10:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GuestDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GuestDashboardPage — pure-guest binding list (#8c, guest-session posture)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    // Default: a live guest session in the GUEST-ONLY sessionStorage store.
    seedGuestSession();
  });

  it('renders the GuestLayout shell chrome (read-only badge, guest email, sign-out)', async () => {
    vi.mocked(getMyGuestContracts).mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('guest.readOnlyBadge')).toBeInTheDocument();
    // Header email comes from the GUEST SESSION (no redux, no profile fetch).
    expect(screen.getByText('guest@external.example')).toBeInTheDocument();
    expect(screen.getByText('guest.dashboard.signOut')).toBeInTheDocument();
    expect(screen.getByText('guest.dashboard.title')).toBeInTheDocument();
    expect(screen.getByText('guest.dashboard.subtitle')).toBeInTheDocument();
  });

  it('fetches via guestHttp with the SESSION token (explicit Bearer pattern)', async () => {
    vi.mocked(getMyGuestContracts).mockResolvedValue([ROW_ACTIVE]);
    renderPage();

    await screen.findByText('Alexandria Metro Line 3');
    expect(getMyGuestContracts).toHaveBeenCalledTimes(1);
    // Called with the exact token the guest session holds.
    const stored = JSON.parse(sessionStorage.getItem(GUEST_SESSION_KEY) as string);
    expect(getMyGuestContracts).toHaveBeenCalledWith(stored.token);
  });

  it('renders every shared contract regardless of status, API order preserved', async () => {
    vi.mocked(getMyGuestContracts).mockResolvedValue([ROW_ACTIVE, ROW_DRAFT]);
    const { container } = renderPage();

    await screen.findByText('Alexandria Metro Line 3');
    expect(screen.getByText('Cairo Bridge Works')).toBeInTheDocument();

    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text.indexOf('Alexandria Metro Line 3')).toBeLessThan(
      text.indexOf('Cairo Bridge Works'),
    );

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(
      screen.getByText('sharedWithMe.signature.fullyExecuted'),
    ).toBeInTheDocument();
    expect(screen.getByText(/FIDIC RED BOOK 2017/)).toBeInTheDocument();
    expect(screen.getByText(/Metro Phase 2/)).toBeInTheDocument();
  });

  it('renders the EMPTY state (not an error) on [] with 200', async () => {
    vi.mocked(getMyGuestContracts).mockResolvedValue([]);
    renderPage();

    await screen.findByText('guest.dashboard.empty.title');
    expect(screen.getByText('guest.dashboard.empty.subtitle')).toBeInTheDocument();
    expect(
      screen.queryByText('guest.dashboard.error.title'),
    ).not.toBeInTheDocument();
  });

  it('renders the LOADING state while the fetch is in flight', async () => {
    vi.mocked(getMyGuestContracts).mockImplementation(() => new Promise(() => {}));
    renderPage();

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(
      screen.queryByText('guest.dashboard.empty.title'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('guest.dashboard.error.title'),
    ).not.toBeInTheDocument();
  });

  it('renders the ERROR state and Retry re-fetches', async () => {
    vi.mocked(getMyGuestContracts)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([ROW_ACTIVE]);
    renderPage();

    await screen.findByText('guest.dashboard.error.title');
    expect(getMyGuestContracts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('guest.dashboard.error.retry'));

    await screen.findByText('Alexandria Metro Line 3');
    await waitFor(() => expect(getMyGuestContracts).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText('guest.dashboard.error.title'),
    ).not.toBeInTheDocument();
  });

  it('opens the guest-styled viewer at /guest/shared/:id on row click', async () => {
    vi.mocked(getMyGuestContracts).mockResolvedValue([ROW_ACTIVE]);
    renderPage();

    fireEvent.click(await screen.findByText('Alexandria Metro Line 3'));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/guest/shared/cccccccc-0000-0000-0000-000000000001',
    );
  });

  it('opens the contract on Enter/Space (keyboard parity, WCAG 2.1.1)', async () => {
    vi.mocked(getMyGuestContracts).mockResolvedValue([ROW_ACTIVE]);
    renderPage();

    const row = await screen.findByRole('button', { name: ROW_ACTIVE.contract_name });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith(
      '/guest/shared/cccccccc-0000-0000-0000-000000000001',
    );

    fireEvent.keyDown(row, { key: ' ' });
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });

  it('sign-out clears ONLY the guest session and shows the session-ended state (managing slots untouched)', async () => {
    // A managing session in the shared slots must survive a guest sign-out.
    localStorage.setItem('access_token', 'managing-access');
    localStorage.setItem('refresh_token', 'managing-refresh');
    vi.mocked(getMyGuestContracts).mockResolvedValue([]);
    renderPage();

    fireEvent.click(await screen.findByText('guest.dashboard.signOut'));

    // Guest session gone → the honest ended state, no login redirect (there
    // is deliberately no link-less guest login to send them to).
    expect(sessionStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
    expect(
      await screen.findByText('guest.dashboard.sessionEnded.title'),
    ).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    // The managing slots are byte-untouched.
    expect(localStorage.getItem('access_token')).toBe('managing-access');
    expect(localStorage.getItem('refresh_token')).toBe('managing-refresh');
  });

  it('NO guest session → session-ended state and NO fetch (the gate is the guest session, not redux)', async () => {
    sessionStorage.clear();
    // Even a full managing redux/localStorage session must NOT open this page's
    // data path — the gate reads the guest store only.
    localStorage.setItem('access_token', 'managing-access');
    vi.mocked(getMyGuestContracts).mockResolvedValue([ROW_ACTIVE]);
    renderPage();

    expect(
      await screen.findByText('guest.dashboard.sessionEnded.title'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('guest.dashboard.sessionEnded.body'),
    ).toBeInTheDocument();
    expect(getMyGuestContracts).not.toHaveBeenCalled();
  });

  it('an EXPIRED guest session is treated as absent (cleared on read)', async () => {
    sessionStorage.clear();
    saveGuestSession(guestJwt(-60), GUEST_USER as never); // exp in the past
    vi.mocked(getMyGuestContracts).mockResolvedValue([ROW_ACTIVE]);
    renderPage();

    expect(
      await screen.findByText('guest.dashboard.sessionEnded.title'),
    ).toBeInTheDocument();
    expect(getMyGuestContracts).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
  });

  it('keeps the share date LTR even in an RTL row (SIGN convention)', async () => {
    vi.mocked(getMyGuestContracts).mockResolvedValue([ROW_ACTIVE]);
    renderPage();

    await screen.findByText('Alexandria Metro Line 3');

    const dateText = new Date(ROW_ACTIVE.granted_at).toLocaleDateString();
    const dateEl = screen
      .getAllByText(dateText)
      .find((el) => el.getAttribute('dir') === 'ltr');
    expect(dateEl).toBeTruthy();

    const row = screen.getByRole('button', { name: ROW_ACTIVE.contract_name });
    expect(row.querySelector('.rtl\\:rotate-180')).toBeTruthy();
  });

  it('renders a signature pill for each valid state and none for null/unknown', async () => {
    const awaiting: SharedContractRow = {
      ...ROW_ACTIVE,
      contract_id: 'cccccccc-0000-0000-0000-000000000003',
      contract_name: 'Sinai Desalination Plant',
      signature_status: 'AWAITING_COUNTERPARTY',
    };
    const pending: SharedContractRow = {
      ...ROW_ACTIVE,
      contract_id: 'cccccccc-0000-0000-0000-000000000004',
      contract_name: 'Red Sea Port Expansion',
      signature_status: 'PENDING_SIGNATURE',
    };
    const unknown: SharedContractRow = {
      ...ROW_ACTIVE,
      contract_id: 'cccccccc-0000-0000-0000-000000000005',
      contract_name: 'Nile Barrage Retrofit',
      signature_status: 'SOME_FUTURE_STATE',
    };
    vi.mocked(getMyGuestContracts).mockResolvedValue([
      ROW_ACTIVE,
      awaiting,
      pending,
      ROW_DRAFT,
      unknown,
    ]);
    renderPage();

    await screen.findByText('Alexandria Metro Line 3');

    expect(screen.getByText('sharedWithMe.signature.fullyExecuted')).toBeInTheDocument();
    expect(screen.getByText('sharedWithMe.signature.awaitingCounterparty')).toBeInTheDocument();
    expect(screen.getByText('sharedWithMe.signature.pendingSignature')).toBeInTheDocument();
    expect(screen.getAllByText(/^sharedWithMe\.signature\./)).toHaveLength(3);
  });
});
