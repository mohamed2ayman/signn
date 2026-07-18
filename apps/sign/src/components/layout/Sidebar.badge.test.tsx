import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import Sidebar from '@/components/layout/Sidebar';
import { getMyShares } from '@/services/api/sharedContractsService';
import type { SharedContractRow } from '@/services/api/sharedContractsService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
// No role gating in these cases — items without `roles` are always shown.
vi.mock('react-redux', () => ({
  useSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { user: { role: 'OWNER_ADMIN' } } }),
}));
vi.mock('@/services/api/sharedContractsService', () => ({
  getMyShares: vi.fn(),
}));
vi.mock('@/components/common/SignLogo', () => ({
  default: () => <div data-testid="sign-logo" />,
}));

const SHARED_ITEM = {
  label: 'nav.sharedWithMe',
  path: '/app/shared-with-me',
  icon: '🤝',
};
const OTHER_ITEMS = [
  { label: 'nav.dashboard', path: '/app/dashboard', icon: '📊' },
  { label: 'nav.projects', path: '/app/projects', icon: '📁' },
];

const row = (id: string): SharedContractRow => ({
  contract_id: id,
  contract_name: 'X',
  contract_type: 'ADHOC',
  status: 'ACTIVE',
  signature_status: null,
  party_first_name: null,
  party_second_name: null,
  project_name: null,
  shared_by_org: null,
  shared_by_user: null,
  granted_at: '2026-07-12T10:00:00.000Z',
});

function renderSidebar(items: Array<{ label: string; path: string; icon: string }>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Sidebar items={items} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar — "Shared with me" nav count badge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the count pill when the user has shared contracts', async () => {
    vi.mocked(getMyShares).mockResolvedValue([row('a'), row('b')]);
    renderSidebar([...OTHER_ITEMS, SHARED_ITEM]);

    expect(screen.getByText('nav.sharedWithMe')).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument();
  });

  it('zero case: the item is STILL visible, but no pill renders', async () => {
    vi.mocked(getMyShares).mockResolvedValue([]);
    renderSidebar([...OTHER_ITEMS, SHARED_ITEM]);

    // Item always present…
    expect(screen.getByText('nav.sharedWithMe')).toBeInTheDocument();
    // …the fetch resolves…
    await waitFor(() => expect(getMyShares).toHaveBeenCalledTimes(1));
    // …and no count pill appears.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('does NOT fetch when the rail has no "Shared with me" item (guest/contractor rails)', async () => {
    renderSidebar(OTHER_ITEMS);

    expect(screen.getByText('nav.dashboard')).toBeInTheDocument();
    // The query is gated on the item's presence — no wasted call on rails
    // that can never show the badge.
    await waitFor(() => expect(getMyShares).not.toHaveBeenCalled());
  });
});
