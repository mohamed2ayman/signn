import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ObligationDetailDrawer from '@/components/obligations/ObligationDetailDrawer';
import { obligationService } from '@/services/api/obligationService';
import complianceService from '@/services/api/complianceService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && 'days' in opts) return `${k}:${opts.days}`;
      return k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/services/api/obligationService', () => ({
  obligationService: { getById: vi.fn() },
}));
vi.mock('@/services/api/complianceService', () => ({
  default: { listContractObligations: vi.fn() },
}));

const OBL = {
  id: 'ob-1',
  contract_id: 'c-1',
  project_id: 'p-1',
  compliance_check_id: null,
  contract_clause_id: 'cl-9',
  description: 'Submit performance bond',
  responsible_party: 'CONTRACTOR',
  obligation_type: 'PERFORMANCE_BOND',
  clause_ref: 'Clause 4.2',
  due_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  duration: null,
  timeframe_description: null,
  amount: '1000000',
  currency: 'USD',
  is_critical: true,
  status: 'PENDING',
  completed_at: null,
  evidence_url: null,
  created_at: new Date().toISOString(),
} as never;

function renderDrawer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ObligationDetailDrawer
          isOpen
          onClose={() => {}}
          obligationId="ob-1"
          contractId="c-1"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ObligationDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(obligationService.getById).mockResolvedValue(OBL);
    vi.mocked(complianceService.listContractObligations).mockResolvedValue([OBL]);
  });

  it('renders the obligation description with dir="auto" once loaded', async () => {
    renderDrawer();
    const desc = await screen.findByText('Submit performance bond');
    expect(desc).toHaveAttribute('dir', 'auto');
  });

  it('renders the section titles', async () => {
    renderDrawer();
    await screen.findByText('Submit performance bond');
    expect(screen.getByText('obligation.modal.detail.keyDetails')).toBeInTheDocument();
    expect(screen.getByText('obligation.modal.detail.assignees')).toBeInTheDocument();
    expect(screen.getByText('obligation.modal.detail.evidence')).toBeInTheDocument();
    expect(screen.getByText('obligation.modal.detail.reminderHistory')).toBeInTheDocument();
    expect(screen.getByText('obligation.modal.detail.activityTimeline')).toBeInTheDocument();
  });

  it('shows the deferred reminder-history placeholder', async () => {
    renderDrawer();
    await waitFor(() =>
      expect(
        screen.getByText('obligation.modal.detail.reminderHistoryDeferred'),
      ).toBeInTheDocument(),
    );
  });

  it('renders a "No evidence uploaded" placeholder when evidence_url is null', async () => {
    renderDrawer();
    await waitFor(() =>
      expect(
        screen.getByText('obligation.modal.detail.noEvidence'),
      ).toBeInTheDocument(),
    );
  });
});
