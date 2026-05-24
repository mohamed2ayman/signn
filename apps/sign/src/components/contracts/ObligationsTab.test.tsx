import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ObligationsTab from '@/components/contracts/ObligationsTab';
import complianceService from '@/services/api/complianceService';
import { projectService } from '@/services/api/projectService';
import type { ContractObligation } from '@/services/api/complianceService';

// ─────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────

// react-i18next: t() returns the key (matches the codebase's
// existing LoginPage.test.tsx + DashboardPage.test.tsx pattern).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && 'days' in opts) return `${k}:${opts.days}`;
      return k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Mock at the service level so axios.ts (which imports the Redux store
// as a side effect) is never loaded — see lesson #37.
vi.mock('@/services/api/complianceService', () => ({
  default: {
    listContractObligations: vi.fn(),
    updateObligation: vi.fn(),
  },
}));
vi.mock('@/services/api/projectService', () => ({
  projectService: {
    getMembers: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const futureDate = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

const OBLIGATIONS: ContractObligation[] = [
  {
    id: 'ob-1',
    contract_id: 'c-1',
    project_id: 'p-1',
    compliance_check_id: null,
    description: 'Submit progress report monthly',
    responsible_party: 'CONTRACTOR',
    obligation_type: 'REPORTING',
    clause_ref: 'Clause 14.1',
    due_date: futureDate(20),
    duration: null,
    timeframe_description: null,
    amount: null,
    currency: null,
    is_critical: false,
    status: 'PENDING',
    completed_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'ob-2',
    contract_id: 'c-1',
    project_id: 'p-1',
    compliance_check_id: null,
    description: 'Provide performance bond — يجب تقديم خطاب الضمان',
    responsible_party: 'CONTRACTOR',
    obligation_type: 'PERFORMANCE_BOND',
    clause_ref: 'Clause 4.2',
    due_date: futureDate(-5), // overdue
    duration: null,
    timeframe_description: null,
    amount: '1000000',
    currency: 'USD',
    is_critical: true,
    status: 'PENDING', // PENDING + past-due → effectiveStatus → OVERDUE
    completed_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'ob-3',
    contract_id: 'c-1',
    project_id: 'p-1',
    compliance_check_id: null,
    description: 'Final inspection complete',
    responsible_party: 'EMPLOYER',
    obligation_type: 'MILESTONE',
    clause_ref: 'Clause 10.2',
    due_date: futureDate(-30),
    duration: null,
    timeframe_description: null,
    amount: null,
    currency: null,
    is_critical: false,
    status: 'COMPLETED',
    completed_at: futureDate(-15),
    created_at: new Date().toISOString(),
  },
];

// ─────────────────────────────────────────────────────────────────
// Render helper — fresh QueryClient per test so cache never leaks
// ─────────────────────────────────────────────────────────────────

function renderTab(overrides: { contractId?: string; projectId?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ObligationsTab
          contractId={overrides.contractId ?? 'c-1'}
          contractStatus="DRAFT"
          projectId={overrides.projectId ?? 'p-1'}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('ObligationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectService.getMembers).mockResolvedValue([]);
  });

  it('renders KPI cards with bucketed counts', async () => {
    vi.mocked(complianceService.listContractObligations).mockResolvedValue(OBLIGATIONS);
    renderTab();
    // Wait for a known-loaded marker — an obligation description only
    // appears AFTER the React Query resolves. Asserting on the KPI
    // label alone is insufficient because that label is also rendered
    // during the loading state (with counts at 0).
    await screen.findByText('Submit progress report monthly');
    // KPI labels present
    expect(screen.getByText('obligation.ui.kpi.total')).toBeInTheDocument();
    // 3 total: 1 pending (ob-1), 1 effectiveStatus=OVERDUE (ob-2), 1 actioned (ob-3)
    const totals = screen.getAllByText('3');
    expect(totals.length).toBeGreaterThan(0);
    // The component renders a "1" count for each of pending / overdue / actioned
    const ones = screen.getAllByText('1');
    expect(ones.length).toBeGreaterThanOrEqual(3);
  });

  it('renders obligation list when data loaded, with dir="auto" on descriptions', async () => {
    vi.mocked(complianceService.listContractObligations).mockResolvedValue(OBLIGATIONS);
    renderTab();
    const desc = await screen.findByText('Submit progress report monthly');
    // CLAUDE.md hard rule check — dir="auto" + unicodeBidi: plaintext
    expect(desc).toHaveAttribute('dir', 'auto');
    expect(desc.getAttribute('style')).toMatch(/unicode-bidi:\s*plaintext/i);
    // Arabic description on ob-2 also has dir="auto"
    const arabicDesc = await screen.findByText(/يجب تقديم خطاب الضمان/);
    expect(arabicDesc).toHaveAttribute('dir', 'auto');
  });

  it('shows the empty state when no obligations exist', async () => {
    vi.mocked(complianceService.listContractObligations).mockResolvedValue([]);
    renderTab();
    await screen.findByText('obligation.ui.empty');
    expect(screen.getByText('obligation.ui.emptySubtext')).toBeInTheDocument();
  });

  it('shows the loading skeleton while the query is in flight', () => {
    // Never-resolving promise so the query stays loading.
    vi.mocked(complianceService.listContractObligations).mockReturnValue(
      new Promise(() => {}) as unknown as Promise<ContractObligation[]>,
    );
    const { container } = renderTab();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it('shows the error state with a retry button on failure', async () => {
    vi.mocked(complianceService.listContractObligations).mockRejectedValue(
      new Error('boom'),
    );
    renderTab();
    await screen.findByText('obligation.ui.errorTitle');
    expect(screen.getByText('obligation.ui.retry')).toBeInTheDocument();
  });

  it('changes the rendered list when the status filter changes', async () => {
    vi.mocked(complianceService.listContractObligations).mockResolvedValue(OBLIGATIONS);
    renderTab();
    await screen.findByText('Submit progress report monthly');
    // Status select is the second select in the filter bar (Type / Status / Assignee).
    // Filter to COMPLETED — only the actioned obligation should remain.
    const selects = screen.getAllByRole('combobox');
    // Type, Status, Assignee selects are siblings — find the Status one by checking
    // for COMPLETED option present.
    const statusSelect = selects.find((el) =>
      Array.from(el.querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'COMPLETED',
      ),
    );
    expect(statusSelect).toBeDefined();
    fireEvent.change(statusSelect!, { target: { value: 'COMPLETED' } });
    await waitFor(() => {
      expect(screen.queryByText('Submit progress report monthly')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Final inspection complete')).toBeInTheDocument();
  });
});
