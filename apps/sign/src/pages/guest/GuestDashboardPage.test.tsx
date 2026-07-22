import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import GuestDashboardPage from '@/pages/guest/GuestDashboardPage';
import { getMyShares } from '@/services/api/sharedContractsService';
import type { SharedContractRow } from '@/services/api/sharedContractsService';

// ── Navigation spy — the shared row and the sign-out button both call
//    useNavigate; one spy proves both targets. ─────────────────────────
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

// ── Auth — the header shows the guest email + a sign-out button, and the
//    page hydrates the user on mount when the store is empty. Mutable so a
//    test can simulate the not-yet-hydrated (user: null) state. ───────────
const GUEST_USER = {
  id: 'u-guest-1',
  email: 'guest@external.example',
  first_name: 'Guest',
  last_name: 'User',
};
const authMock = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  logout: vi.fn(),
  refreshUserProfile: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({
    user: authMock.user,
    logout: authMock.logout,
    refreshUserProfile: authMock.refreshUserProfile,
  }),
}));

vi.mock('@/services/api/sharedContractsService', () => ({
  getMyShares: vi.fn(),
}));

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

describe('GuestDashboardPage — pure-guest binding list (#8c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a hydrated guest. The hydration test overrides this to null.
    authMock.user = { ...GUEST_USER };
  });

  it('renders the GuestLayout shell chrome (read-only badge + sign-out)', async () => {
    vi.mocked(getMyShares).mockResolvedValue([]);
    renderPage();

    // GuestLayout shell — the persistent read-only cue.
    expect(await screen.findByText('guest.readOnlyBadge')).toBeInTheDocument();
    // Dashboard-only header controls: the guest email + a sign-out button.
    expect(screen.getByText('guest@external.example')).toBeInTheDocument();
    expect(screen.getByText('guest.dashboard.signOut')).toBeInTheDocument();
    // Page title/subtitle.
    expect(screen.getByText('guest.dashboard.title')).toBeInTheDocument();
    expect(screen.getByText('guest.dashboard.subtitle')).toBeInTheDocument();
  });

  it('renders every shared contract regardless of status, API order preserved', async () => {
    vi.mocked(getMyShares).mockResolvedValue([ROW_ACTIVE, ROW_DRAFT]);
    const { container } = renderPage();

    await screen.findByText('Alexandria Metro Line 3');
    expect(screen.getByText('Cairo Bridge Works')).toBeInTheDocument();

    // No status filter: both ACTIVE and DRAFT show, in API order.
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text.indexOf('Alexandria Metro Line 3')).toBeLessThan(
      text.indexOf('Cairo Bridge Works'),
    );

    // Count badge on the card header.
    expect(screen.getByText('2')).toBeInTheDocument();
    // Signature pill only for the row that has a status.
    expect(
      screen.getByText('sharedWithMe.signature.fullyExecuted'),
    ).toBeInTheDocument();
    // Third row line: type (underscores→spaces) + the sharing org's project.
    expect(screen.getByText(/FIDIC RED BOOK 2017/)).toBeInTheDocument();
    expect(screen.getByText(/Metro Phase 2/)).toBeInTheDocument();
  });

  it('renders the EMPTY state (not an error) on [] with 200', async () => {
    vi.mocked(getMyShares).mockResolvedValue([]);
    renderPage();

    await screen.findByText('guest.dashboard.empty.title');
    expect(screen.getByText('guest.dashboard.empty.subtitle')).toBeInTheDocument();
    expect(
      screen.queryByText('guest.dashboard.error.title'),
    ).not.toBeInTheDocument();
  });

  it('renders the LOADING state while the fetch is in flight', async () => {
    vi.mocked(getMyShares).mockImplementation(() => new Promise(() => {}));
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
    vi.mocked(getMyShares)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([ROW_ACTIVE]);
    renderPage();

    await screen.findByText('guest.dashboard.error.title');
    expect(getMyShares).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('guest.dashboard.error.retry'));

    await screen.findByText('Alexandria Metro Line 3');
    await waitFor(() => expect(getMyShares).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText('guest.dashboard.error.title'),
    ).not.toBeInTheDocument();
  });

  it('opens the guest-styled viewer at /guest/shared/:id on row click', async () => {
    vi.mocked(getMyShares).mockResolvedValue([ROW_ACTIVE]);
    renderPage();

    fireEvent.click(await screen.findByText('Alexandria Metro Line 3'));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/guest/shared/cccccccc-0000-0000-0000-000000000001',
    );
  });

  it('opens the contract on Enter/Space (keyboard parity, WCAG 2.1.1)', async () => {
    vi.mocked(getMyShares).mockResolvedValue([ROW_ACTIVE]);
    renderPage();

    // The row is a real button in the a11y tree, focusable and key-activatable.
    const row = await screen.findByRole('button', { name: ROW_ACTIVE.contract_name });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(mockNavigate).toHaveBeenCalledWith(
      '/guest/shared/cccccccc-0000-0000-0000-000000000001',
    );

    fireEvent.keyDown(row, { key: ' ' });
    expect(mockNavigate).toHaveBeenCalledTimes(2);
  });

  it('signs out and routes to the login page', async () => {
    vi.mocked(getMyShares).mockResolvedValue([]);
    renderPage();

    fireEvent.click(await screen.findByText('guest.dashboard.signOut'));
    expect(authMock.logout).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/auth/login');
  });

  it('keeps the share date LTR even in an RTL row (SIGN convention)', async () => {
    vi.mocked(getMyShares).mockResolvedValue([ROW_ACTIVE]);
    renderPage();

    await screen.findByText('Alexandria Metro Line 3');

    // The share date renders in a span pinned dir="ltr".
    const dateText = new Date(ROW_ACTIVE.granted_at).toLocaleDateString();
    const dateEl = screen
      .getAllByText(dateText)
      .find((el) => el.getAttribute('dir') === 'ltr');
    expect(dateEl).toBeTruthy();

    // The row uses RTL-aware wiring: the forward chevron flips in RTL. Scope to
    // the row itself (role=button, named by the contract) — the header sign-out
    // icon ALSO carries rtl:rotate-180 and would satisfy an unscoped container
    // query even if the row chevron were broken.
    const row = screen.getByRole('button', { name: ROW_ACTIVE.contract_name });
    expect(row.querySelector('.rtl\\:rotate-180')).toBeTruthy();
  });

  it('hydrates the user on mount when the store is empty (email hidden until loaded)', async () => {
    // Not-yet-hydrated: only the token is persisted, Redux user is null (the
    // AppLayout/AdminLayout mount-refresh mirror, CLAUDE.md Known Issue #10).
    authMock.user = null;
    vi.mocked(getMyShares).mockResolvedValue([]);
    renderPage();

    await screen.findByText('guest.dashboard.empty.title');
    // The page asks for the profile so the header email can appear.
    expect(authMock.refreshUserProfile).toHaveBeenCalled();
    // Until it resolves, no email span renders (and nothing crashes).
    expect(screen.queryByText('guest@external.example')).not.toBeInTheDocument();
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
    // ROW_ACTIVE = FULLY_EXECUTED, ROW_DRAFT = null.
    vi.mocked(getMyShares).mockResolvedValue([
      ROW_ACTIVE,
      awaiting,
      pending,
      ROW_DRAFT,
      unknown,
    ]);
    renderPage();

    await screen.findByText('Alexandria Metro Line 3');

    // Each known state renders its labelled pill…
    expect(screen.getByText('sharedWithMe.signature.fullyExecuted')).toBeInTheDocument();
    expect(screen.getByText('sharedWithMe.signature.awaitingCounterparty')).toBeInTheDocument();
    expect(screen.getByText('sharedWithMe.signature.pendingSignature')).toBeInTheDocument();
    // …and exactly three pills total — the null and unknown rows render none.
    expect(screen.getAllByText(/^sharedWithMe\.signature\./)).toHaveLength(3);
  });
});
