import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SharedContractViewerPage from '@/pages/guest/SharedContractViewerPage';
import {
  getMyShares,
  getSharedContract,
} from '@/services/api/sharedContractsService';
import type { SharedContractRow } from '@/services/api/sharedContractsService';
import type { Contract } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
  }),
}));

// Managing session in the auth store — the selector receives the real state
// shape and picks token/user from it.
vi.mock('react-redux', () => ({
  useSelector: (selector: (s: unknown) => unknown) =>
    selector({
      auth: {
        token: 'managing-token',
        user: { id: 'u-1', first_name: 'Youssef', last_name: 'Hazem' },
      },
    }),
}));

vi.mock('@/services/api/sharedContractsService', () => ({
  getMyShares: vi.fn(),
  getSharedContract: vi.fn(),
}));

// Capture the props flowing into the shipped guest components — the entry
// mode's contract is "unchanged components, managing token as the explicit
// token prop", so the prop VALUES are what we assert.
const mockGcvCalls: Array<Record<string, unknown>> = [];
vi.mock('@/components/guest/GuestContractView', () => ({
  default: (props: Record<string, unknown>) => {
    mockGcvCalls.push(props);
    return <div data-testid="guest-contract-view" />;
  },
}));
const mockChatCalls: Array<Record<string, unknown>> = [];
vi.mock('@/components/guest/GuestChatPanel', () => ({
  default: (props: Record<string, unknown>) => {
    mockChatCalls.push(props);
    return null;
  },
}));
const mockCommentsCalls: Array<Record<string, unknown>> = [];
vi.mock('@/components/guest/GuestComments', () => ({
  default: (props: Record<string, unknown>) => {
    mockCommentsCalls.push(props);
    return <div data-testid="guest-comments" />;
  },
}));
// #8d — the import modal is unit-tested in its own spec; here we capture the
// props the page wires into it (and keep projectService/axios out of this
// test's module graph).
const mockImportModalCalls: Array<Record<string, unknown>> = [];
vi.mock('@/components/guest/ImportContractModal', () => ({
  default: (props: Record<string, unknown>) => {
    mockImportModalCalls.push(props);
    return props.isOpen ? <div data-testid="import-modal-open" /> : null;
  },
}));

const CONTRACT = {
  id: 'c-1',
  name: 'Alexandria Metro Line 3',
  contract_type: 'FIDIC_RED_BOOK_2017',
  status: 'ACTIVE',
  contract_clauses: [],
} as unknown as Contract;

const SHARE_ROW: SharedContractRow = {
  contract_id: 'c-1',
  contract_name: 'Alexandria Metro Line 3',
  contract_type: 'FIDIC_RED_BOOK_2017',
  status: 'ACTIVE',
  signature_status: null,
  party_first_name: null,
  party_second_name: null,
  project_name: null,
  shared_by_org: 'Acme Construction',
  shared_by_user: 'Sara Ahmed',
  granted_at: '2026-07-12T10:00:00.000Z',
};

function notFoundError(): Error {
  return Object.assign(new Error('Request failed with status code 404'), {
    isAxiosError: true,
    response: { status: 404 },
  });
}

function renderViewer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/guest/shared/c-1']}>
        <Routes>
          <Route path="/guest/shared/:contractId" element={<SharedContractViewerPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SharedContractViewerPage — managing-session entry into the guest view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGcvCalls.length = 0;
    mockChatCalls.length = 0;
    mockCommentsCalls.length = 0;
  });

  it('loads the bound contract from the managing session (GET /contracts/:id path)', async () => {
    vi.mocked(getSharedContract).mockResolvedValue(CONTRACT);
    vi.mocked(getMyShares).mockResolvedValue([SHARE_ROW]);
    renderViewer();

    await screen.findByTestId('guest-contract-view');
    expect(getSharedContract).toHaveBeenCalledWith('c-1');
  });

  it('passes the MANAGING token through the guest components’ explicit token prop', async () => {
    vi.mocked(getSharedContract).mockResolvedValue(CONTRACT);
    vi.mocked(getMyShares).mockResolvedValue([SHARE_ROW]);
    renderViewer();

    await screen.findByTestId('guest-contract-view');
    expect(mockGcvCalls.at(-1)?.guestJwt).toBe('managing-token');
    expect(mockChatCalls.at(-1)?.guestJwt).toBe('managing-token');
    expect(mockCommentsCalls.at(-1)?.guestJwt).toBe('managing-token');
  });

  it('renders the guest-context banner with the sharing org’s name', async () => {
    vi.mocked(getSharedContract).mockResolvedValue(CONTRACT);
    vi.mocked(getMyShares).mockResolvedValue([SHARE_ROW]);
    renderViewer();

    await screen.findByText('sharedWithMe.banner.title');
    expect(
      screen.getByText('sharedWithMe.banner.body:{"org":"Acme Construction"}'),
    ).toBeInTheDocument();
    // The way back to the list.
    expect(screen.getAllByText('sharedWithMe.banner.back').length).toBeGreaterThan(0);
  });

  it('falls back to the generic org label when shared_by_org is null', async () => {
    vi.mocked(getSharedContract).mockResolvedValue(CONTRACT);
    vi.mocked(getMyShares).mockResolvedValue([
      { ...SHARE_ROW, shared_by_org: null },
    ]);
    renderViewer();

    await screen.findByText(
      'sharedWithMe.banner.body:{"org":"sharedWithMe.banner.orgFallback"}',
    );
  });

  it('a managing user NEVER sees the establish-identity ("set a password") CTA', async () => {
    vi.mocked(getSharedContract).mockResolvedValue(CONTRACT);
    vi.mocked(getMyShares).mockResolvedValue([SHARE_ROW]);
    renderViewer();

    await screen.findByTestId('guest-contract-view');
    // The token flow's progressive-identity surface must not exist here —
    // comments render directly instead.
    expect(screen.queryByText('guest.commentCta.title')).not.toBeInTheDocument();
    expect(screen.queryByText('guest.commentCta.button')).not.toBeInTheDocument();
    expect(screen.getByTestId('guest-comments')).toBeInTheDocument();
  });

  it('renders the REAL SignLogo brand component, never the design export’s placeholder (lesson #222)', async () => {
    vi.mocked(getSharedContract).mockResolvedValue(CONTRACT);
    vi.mocked(getMyShares).mockResolvedValue([SHARE_ROW]);
    const { container } = renderViewer();

    await screen.findByTestId('guest-contract-view');
    // GuestLayout is UNMOCKED here — the real SignLogo component mounts and
    // renders its "Sign" wordmark in the header.
    expect(screen.getByText('Sign')).toBeInTheDocument();
    // The design export marked its logo slot with a dashed box labeled
    // "SignLogo" ("Real SignLogo component mounts here") — that literal
    // stand-in must never appear as rendered text.
    expect(container.textContent).not.toContain('SignLogo');
    expect(container.textContent).not.toContain('mounts here');
  });

  it('REVOKED binding (404) renders the dedicated block, not a crash', async () => {
    vi.mocked(getSharedContract).mockRejectedValue(notFoundError());
    vi.mocked(getMyShares).mockResolvedValue([SHARE_ROW]);
    renderViewer();

    await screen.findByText('sharedWithMe.revoked.title');
    expect(screen.getByText('sharedWithMe.revoked.body')).toBeInTheDocument();
    // Primary action returns to the list.
    const back = screen.getByText('sharedWithMe.banner.back');
    expect(back.closest('a')).toHaveAttribute('href', '/app/shared-with-me');
    // No viewer, no banner, no generic-error copy.
    expect(screen.queryByTestId('guest-contract-view')).not.toBeInTheDocument();
    expect(screen.queryByText('sharedWithMe.banner.title')).not.toBeInTheDocument();
    expect(screen.queryByText('sharedWithMe.error.title')).not.toBeInTheDocument();
  });

  it('a non-404 failure renders the generic error with Retry, and Retry re-fetches', async () => {
    // The page auto-retries a non-404 (react-query's failureCount starts at
    // 0, so `failureCount < 2` allows up to three attempts) before surfacing
    // the error state — reject them all, then let the MANUAL Retry succeed.
    vi.mocked(getSharedContract)
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(CONTRACT);
    vi.mocked(getMyShares).mockResolvedValue([SHARE_ROW]);
    renderViewer();

    await screen.findByText('sharedWithMe.error.title');
    expect(screen.queryByText('sharedWithMe.revoked.title')).not.toBeInTheDocument();
    const attemptsBeforeManualRetry = vi.mocked(getSharedContract).mock.calls.length;

    screen.getByText('sharedWithMe.error.retry').click();

    await screen.findByTestId('guest-contract-view');
    await waitFor(() =>
      expect(vi.mocked(getSharedContract).mock.calls.length).toBeGreaterThan(
        attemptsBeforeManualRetry,
      ),
    );
  });

  it('#8d — supplies onImport to GuestContractView (THIS page is the sole supplier) and wires the modal props', async () => {
    vi.mocked(getSharedContract).mockResolvedValue(CONTRACT);
    vi.mocked(getMyShares).mockResolvedValue([SHARE_ROW]);
    renderViewer();

    await screen.findByTestId('guest-contract-view');
    // The shared-viewer-only gate: the page passes a real onImport function.
    expect(typeof mockGcvCalls.at(-1)?.onImport).toBe('function');
    // The modal is mounted (closed) with the full wiring: contract identity,
    // the sharing org for the copy semantics, and the MANAGING token as the
    // explicit guest-surface credential.
    const modalProps = mockImportModalCalls.at(-1);
    expect(modalProps?.isOpen).toBe(false);
    expect(modalProps?.contractId).toBe('c-1');
    expect(modalProps?.contractName).toBe('Alexandria Metro Line 3');
    expect(modalProps?.sharedByOrg).toBe('Acme Construction');
    expect(modalProps?.guestJwt).toBe('managing-token');
  });

  it('#8d — the Import button opens the modal (onImport → isOpen)', async () => {
    vi.mocked(getSharedContract).mockResolvedValue(CONTRACT);
    vi.mocked(getMyShares).mockResolvedValue([SHARE_ROW]);
    renderViewer();

    await screen.findByTestId('guest-contract-view');
    const onImport = mockGcvCalls.at(-1)?.onImport as () => void;
    act(() => onImport());
    expect(screen.getByTestId('import-modal-open')).toBeInTheDocument();
  });
});
