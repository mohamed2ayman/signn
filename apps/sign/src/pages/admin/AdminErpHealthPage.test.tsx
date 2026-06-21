import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/api/adminService', () => ({
  adminService: {
    getErpConnections: vi.fn(),
    suspendErpConnection: vi.fn(),
    unsuspendErpConnection: vi.fn(),
    forceCheckErpConnection: vi.fn(),
    deleteErpConnection: vi.fn(),
  },
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────
const NONE: ErpConnection = {
  id: 'c-none',
  organization_id: 'org-a',
  vendor: 'MOCK',
  name: 'Acme ERP',
  base_url: null,
  capabilities_snapshot: null,
  enabled: true,
  status: 'active',
  operator_hold_state: 'none',
  hold_reason: null,
  hold_at: null,
  last_sync_at: new Date().toISOString(),
  error_message: null,
  has_credentials: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
const HELD: ErpConnection = {
  ...NONE,
  id: 'c-held',
  organization_id: 'org-b',
  name: 'Globex SAP',
  vendor: 'SAP',
  operator_hold_state: 'operator_suspended',
  hold_reason: 'compliance review',
  hold_at: new Date().toISOString(),
  hold_by_user_id: 'u-op',
  hold_by_name: 'Jane Operator',
  hold_by_email: 'jane@ops.com',
};
const AUTO: ErpConnection = {
  ...NONE,
  id: 'c-auto',
  organization_id: 'org-c',
  name: 'Initech ERP',
  operator_hold_state: 'auto_suspended',
  hold_reason: 'Auto-suspended after 5 consecutive failures',
  hold_at: new Date().toISOString(),
  hold_by_user_id: null,
  hold_by_name: null,
  hold_by_email: null,
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

describe('AdminErpHealthPage — states', () => {
  it('shows a loading spinner while data loads', () => {
    vi.mocked(adminService.getErpConnections).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the empty state when no connections exist', async () => {
    vi.mocked(adminService.getErpConnections).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('erp.admin.empty')).toBeInTheDocument();
  });

  it('renders an error on a non-404 failure', async () => {
    vi.mocked(adminService.getErpConnections).mockRejectedValue(makeError(500));
    renderPage();
    expect(await screen.findByText('erp.admin.loadError', undefined, { timeout: 4000 })).toBeInTheDocument();
  });

  it('handles the feature-off 404 gracefully', async () => {
    vi.mocked(adminService.getErpConnections).mockRejectedValue(makeError(404));
    renderPage();
    expect(await screen.findByText('erp.admin.featureOff', undefined, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe('AdminErpHealthPage — operator actions', () => {
  function rowFor(name: string): HTMLElement {
    return screen.getByText(name).closest('tr') as HTMLElement;
  }

  it('shows Suspend (not Unsuspend) and a DISABLED Delete when there is no hold', async () => {
    vi.mocked(adminService.getErpConnections).mockResolvedValue([NONE]);
    renderPage();
    await screen.findByText('Acme ERP');
    const row = within(rowFor('Acme ERP'));
    expect(row.getByText('erp.admin.action.suspend.button')).toBeInTheDocument();
    expect(row.queryByText('erp.admin.action.unsuspend.button')).not.toBeInTheDocument();
    expect(row.getByText('erp.admin.action.delete.button')).toBeDisabled();
    // Hold state reads as "none" key.
    expect(row.getByText('erp.admin.holdState.none')).toBeInTheDocument();
  });

  it('shows Unsuspend and an ENABLED Delete when held, with distinct hold-state label + reason', async () => {
    vi.mocked(adminService.getErpConnections).mockResolvedValue([HELD]);
    renderPage();
    await screen.findByText('Globex SAP');
    const row = within(rowFor('Globex SAP'));
    expect(row.getByText('erp.admin.action.unsuspend.button')).toBeInTheDocument();
    expect(row.queryByText('erp.admin.action.suspend.button')).not.toBeInTheDocument();
    expect(row.getByText('erp.admin.action.delete.button')).not.toBeDisabled();
    expect(row.getByText('erp.admin.holdState.operator_suspended')).toBeInTheDocument();
    expect(row.getByText('compliance review')).toBeInTheDocument();
  });

  it('shows the suspending operator: name for manual, System for auto', async () => {
    vi.mocked(adminService.getErpConnections).mockResolvedValue([HELD, AUTO]);
    renderPage();
    await screen.findByText('Globex SAP');
    // The value sits in a larger text node ("Suspended by: <value>") → substring match.
    expect(within(rowFor('Globex SAP')).getByText(/Jane Operator/)).toBeInTheDocument();
    expect(within(rowFor('Initech ERP')).getByText(/erp\.admin\.systemActor/)).toBeInTheDocument();
  });

  it('suspend requires a reason, then calls the endpoint', async () => {
    vi.mocked(adminService.getErpConnections).mockResolvedValue([NONE]);
    vi.mocked(adminService.suspendErpConnection).mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByText('erp.admin.action.suspend.button'));

    const confirm = screen.getByText('erp.admin.action.suspend.confirm');
    expect(confirm).toBeDisabled(); // reason empty
    fireEvent.change(screen.getByLabelText('erp.admin.modal.reasonLabel'), {
      target: { value: 'planned maintenance' },
    });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(adminService.suspendErpConnection).toHaveBeenCalledWith('c-none', 'planned maintenance'),
    );
  });

  it('delete requires reason AND a second confirm (checkbox) before it fires', async () => {
    vi.mocked(adminService.getErpConnections).mockResolvedValue([HELD]);
    vi.mocked(adminService.deleteErpConnection).mockResolvedValue({});
    renderPage();
    fireEvent.click(await screen.findByText('erp.admin.action.delete.button'));

    const confirm = screen.getByText('erp.admin.action.delete.confirm');
    expect(confirm).toBeDisabled(); // reason empty + checkbox unchecked
    fireEvent.change(screen.getByLabelText('erp.admin.modal.reasonLabel'), {
      target: { value: 'decommission' },
    });
    expect(confirm).toBeDisabled(); // reason alone is not enough — second confirm required
    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(adminService.deleteErpConnection).toHaveBeenCalledWith('c-held', 'decommission'),
    );
  });
});
