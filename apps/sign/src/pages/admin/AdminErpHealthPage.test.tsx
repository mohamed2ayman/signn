import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AdminErpHealthPage from '@/pages/admin/AdminErpHealthPage';
import { adminService } from '@/services/api/adminService';
import type { ErpConnection } from '@/services/api/erpService';

// ─── Mocks (service level only) ─────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k, // assert on keys
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/services/api/adminService', () => ({
  adminService: { getErpConnections: vi.fn() },
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────
const ACTIVE: ErpConnection = {
  id: 'c-1',
  organization_id: 'org-aaaa',
  vendor: 'MOCK',
  name: 'Acme ERP',
  base_url: null,
  capabilities_snapshot: null,
  enabled: true,
  status: 'active',
  last_sync_at: new Date().toISOString(),
  error_message: null,
  has_credentials: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const ERRORED: ErpConnection = {
  ...ACTIVE,
  id: 'c-2',
  organization_id: 'org-bbbb',
  vendor: 'SAP',
  name: 'Globex SAP',
  status: 'error',
  last_sync_at: null,
  error_message: 'SapCostConnector is not yet operational',
};

function makeError(status: number) {
  return Object.assign(new Error('http'), { response: { status } });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AdminErpHealthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AdminErpHealthPage', () => {
  it('shows a loading spinner while data loads', () => {
    vi.mocked(adminService.getErpConnections).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the empty state when no connections exist anywhere', async () => {
    vi.mocked(adminService.getErpConnections).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('erp.admin.empty')).toBeInTheDocument();
  });

  // retry:1 on the page → rejected query waits ~1s before erroring.
  it('renders an error on a non-404 failure', async () => {
    vi.mocked(adminService.getErpConnections).mockRejectedValue(makeError(500));
    renderPage();
    expect(await screen.findByText('erp.admin.loadError', undefined, { timeout: 4000 })).toBeInTheDocument();
  });

  it('handles the feature-off 404 gracefully (notice, no crash)', async () => {
    vi.mocked(adminService.getErpConnections).mockRejectedValue(makeError(404));
    renderPage();
    expect(await screen.findByText('erp.admin.featureOff', undefined, { timeout: 4000 })).toBeInTheDocument();
  });

  it('renders cross-tenant rows: org, vendor, status, error', async () => {
    vi.mocked(adminService.getErpConnections).mockResolvedValue([ACTIVE, ERRORED]);
    renderPage();
    expect(await screen.findByText('org-aaaa')).toBeInTheDocument();
    expect(screen.getByText('org-bbbb')).toBeInTheDocument();
    expect(screen.getByText('Acme ERP')).toBeInTheDocument();
    expect(screen.getByText('Globex SAP')).toBeInTheDocument();
    // Status badges reuse the connection-status keys; error must be visible.
    expect(screen.getByText('erp.status.active')).toBeInTheDocument();
    expect(screen.getByText('erp.status.error')).toBeInTheDocument();
    expect(screen.getByText('SapCostConnector is not yet operational')).toBeInTheDocument();
  });

  it('is READ-ONLY — renders no mutation controls', async () => {
    vi.mocked(adminService.getErpConnections).mockResolvedValue([ACTIVE, ERRORED]);
    renderPage();
    await screen.findByText('Acme ERP');
    // No interactive controls of any kind — the dashboard is pure monitoring.
    // (Role-based, not text-based: a text match on /sync/ would falsely hit the
    // "Last sync" column header.)
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
