import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ErpConnectionsPage from '@/pages/app/ErpConnectionsPage';
import ErpConnectionFormModal from '@/components/erp/ErpConnectionFormModal';
import ErpSyncHistoryModal from '@/components/erp/ErpSyncHistoryModal';
import { erpService, type ErpConnection, type ErpSyncJob } from '@/services/api/erpService';

// ─── Mocks (service level only) ─────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k, // assert on keys
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api/erpService', () => ({
  erpService: {
    listConnections: vi.fn(),
    deleteConnection: vi.fn(),
    createConnection: vi.fn(),
    updateConnection: vi.fn(),
    triggerSync: vi.fn(),
    listJobs: vi.fn(),
    getMappings: vi.fn(),
    setMappings: vi.fn(),
  },
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────
const CONNECTION: ErpConnection = {
  id: 'conn-1',
  organization_id: 'org-1',
  vendor: 'MOCK',
  name: 'Primary ERP',
  base_url: null,
  capabilities_snapshot: null,
  enabled: true,
  status: 'configured',
  operator_hold_state: 'none',
  hold_reason: null,
  hold_at: null,
  last_sync_at: null,
  error_message: null,
  has_credentials: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const JOB: ErpSyncJob = {
  id: 'job-1',
  connection_id: 'conn-1',
  organization_id: 'org-1',
  direction: 'import',
  domain: 'cost',
  status: 'success',
  idempotency_key: 'k1',
  records_processed: 3,
  records_imported: 3,
  records_failed: 0,
  error: null,
  started_at: new Date().toISOString(),
  finished_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

function makeError(status: number) {
  return Object.assign(new Error('http'), { response: { status } });
}

function renderWith(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

// ─── Page: loading / error / empty / feature-off / data ─────────────────────
describe('ErpConnectionsPage', () => {
  it('shows a loading spinner while connections load', () => {
    vi.mocked(erpService.listConnections).mockReturnValue(new Promise(() => {}));
    renderWith(<ErpConnectionsPage />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the empty state when there are no connections', async () => {
    vi.mocked(erpService.listConnections).mockResolvedValue([]);
    renderWith(<ErpConnectionsPage />);
    expect(await screen.findByText('erp.empty.title')).toBeInTheDocument();
  });

  // The page sets retry:1, so a rejected query waits for one retry (~1s default
  // backoff) before erroring — give these findBy calls headroom past that.
  it('renders an error + retry on a non-404 failure', async () => {
    vi.mocked(erpService.listConnections).mockRejectedValue(makeError(500));
    renderWith(<ErpConnectionsPage />);
    expect(await screen.findByText('erp.loadError', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('erp.retry')).toBeInTheDocument();
  });

  it('handles the feature-off 404 gracefully (notice shown, no Add button)', async () => {
    vi.mocked(erpService.listConnections).mockRejectedValue(makeError(404));
    renderWith(<ErpConnectionsPage />);
    expect(await screen.findByText('erp.featureOff', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText('erp.addConnection')).not.toBeInTheDocument();
  });

  it('lists connections with name, vendor and status, and no export action', async () => {
    vi.mocked(erpService.listConnections).mockResolvedValue([CONNECTION]);
    renderWith(<ErpConnectionsPage />);
    expect(await screen.findByText('Primary ERP')).toBeInTheDocument();
    expect(screen.getByText('MOCK')).toBeInTheDocument();
    expect(screen.getByText('erp.status.configured')).toBeInTheDocument();
    // Import-only — there must be no export action anywhere.
    expect(screen.queryByText(/export/i)).not.toBeInTheDocument();
  });
});

// ─── Write-only credentials ─────────────────────────────────────────────────
describe('ErpConnectionFormModal — write-only credentials', () => {
  it('shows "configured" status and never displays a credential value on edit', () => {
    renderWith(
      <ErpConnectionFormModal isOpen onClose={() => {}} connection={CONNECTION} />,
    );
    // Status indicator only — never a value or masked stand-in.
    expect(screen.getByText('erp.form.credentialsConfigured')).toBeInTheDocument();
    // No credential value input is rendered until the user opts to replace.
    expect(screen.queryByLabelText('erp.form.credentialValue')).not.toBeInTheDocument();
    expect(screen.getByText('erp.form.replaceCredentials')).toBeInTheDocument();
  });

  it('reveals EMPTY credential inputs when replacing (never pre-filled)', () => {
    renderWith(
      <ErpConnectionFormModal isOpen onClose={() => {}} connection={CONNECTION} />,
    );
    fireEvent.click(screen.getByText('erp.form.replaceCredentials'));
    const valueInput = screen.getByLabelText('erp.form.credentialValue') as HTMLInputElement;
    expect(valueInput).toBeInTheDocument();
    expect(valueInput.value).toBe(''); // no stored secret ever populated
    expect(valueInput.type).toBe('password');
  });
});

// ─── Sync-now → job history ─────────────────────────────────────────────────
describe('ErpSyncHistoryModal — sync-now then history', () => {
  it('enqueues a sync and shows the new job in history', async () => {
    vi.mocked(erpService.listJobs)
      .mockResolvedValueOnce([]) // initial: no jobs
      .mockResolvedValue([JOB]); // after sync: one job
    vi.mocked(erpService.triggerSync).mockResolvedValue({ jobId: 'job-1', reused: false });

    renderWith(
      <ErpSyncHistoryModal isOpen onClose={() => {}} connection={CONNECTION} />,
    );

    expect(await screen.findByText('erp.sync.noJobs')).toBeInTheDocument();

    fireEvent.click(screen.getByText('erp.sync.syncNow'));

    await waitFor(() => expect(erpService.triggerSync).toHaveBeenCalledWith('conn-1'));
    // The mutation invalidates the jobs query → refetch surfaces the new job.
    expect(await screen.findByText('erp.jobStatus.success')).toBeInTheDocument();
  });
});
