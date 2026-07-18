import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SharedWithMePage from '@/pages/app/SharedWithMePage';
import { getMyShares } from '@/services/api/sharedContractsService';
import type { SharedContractRow } from '@/services/api/sharedContractsService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
  }),
}));
vi.mock('@/services/api/sharedContractsService', () => ({
  getMyShares: vi.fn(),
}));

const ROW_A: SharedContractRow = {
  contract_id: 'aaaaaaaa-0000-0000-0000-000000000001',
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

const ROW_B: SharedContractRow = {
  contract_id: 'aaaaaaaa-0000-0000-0000-000000000002',
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
        <SharedWithMePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SharedWithMePage — list states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders rows from the endpoint, preserving the API order (granted_at DESC)', async () => {
    vi.mocked(getMyShares).mockResolvedValue([ROW_A, ROW_B]);
    const { container } = renderPage();

    await screen.findByText('Alexandria Metro Line 3');
    expect(screen.getByText('Cairo Bridge Works')).toBeInTheDocument();

    // API order is preserved: newest share (ROW_A) renders above ROW_B.
    const text = container.textContent ?? '';
    expect(text.indexOf('Alexandria Metro Line 3')).toBeLessThan(
      text.indexOf('Cairo Bridge Works'),
    );

    // Count pill on the card header.
    expect(screen.getByText('2')).toBeInTheDocument();
    // Status pill + signature pill for ROW_A; no signature pill for null.
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(
      screen.getByText('sharedWithMe.signature.fullyExecuted'),
    ).toBeInTheDocument();
    // Row 3rd line: type with underscores→spaces + the sharing org's project.
    expect(screen.getByText(/FIDIC RED BOOK 2017/)).toBeInTheDocument();
    expect(screen.getByText(/Metro Phase 2/)).toBeInTheDocument();
  });

  it('renders the EMPTY state (not an error) on [] with 200', async () => {
    vi.mocked(getMyShares).mockResolvedValue([]);
    renderPage();

    await screen.findByText('sharedWithMe.empty.title');
    expect(screen.getByText('sharedWithMe.empty.subtitle')).toBeInTheDocument();
    expect(screen.queryByText('sharedWithMe.error.title')).not.toBeInTheDocument();
  });

  it('renders the LOADING state while the fetch is in flight', async () => {
    vi.mocked(getMyShares).mockImplementation(() => new Promise(() => {}));
    renderPage();

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('sharedWithMe.empty.title')).not.toBeInTheDocument();
    expect(screen.queryByText('sharedWithMe.error.title')).not.toBeInTheDocument();
  });

  it('renders the ERROR state and Retry re-fetches', async () => {
    vi.mocked(getMyShares)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([ROW_A]);
    renderPage();

    await screen.findByText('sharedWithMe.error.title');
    expect(getMyShares).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('sharedWithMe.error.retry'));

    await screen.findByText('Alexandria Metro Line 3');
    await waitFor(() => expect(getMyShares).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('sharedWithMe.error.title')).not.toBeInTheDocument();
  });
});
