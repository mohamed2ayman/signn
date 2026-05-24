import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ObligationsPage from '@/pages/app/ObligationsPage';
import { obligationService } from '@/services/api/obligationService';
import complianceService from '@/services/api/complianceService';
import { projectService } from '@/services/api/projectService';
import type { ObligationPortfolioItem } from '@/services/api/obligationService';

// ─────────────────────────────────────────────────────────────────
// Mocks — service level only (axios.ts side-effect-loads the Redux
// store, per lesson #37)
// ─────────────────────────────────────────────────────────────────

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
  obligationService: {
    getPortfolioObligations: vi.fn(),
  },
}));
vi.mock('@/services/api/complianceService', () => ({
  default: { updateObligation: vi.fn() },
}));
vi.mock('@/services/api/projectService', () => ({
  projectService: {
    getAll: vi.fn(),
    getMembers: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const futureDate = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

const PORTFOLIO: ObligationPortfolioItem[] = [
  {
    id: 'po-1',
    contract_id: 'c-1',
    project_id: 'p-1',
    compliance_check_id: null,
    description: 'Submit monthly progress reports',
    responsible_party: 'CONTRACTOR',
    obligation_type: 'REPORTING',
    clause_ref: 'Clause 14.1',
    due_date: futureDate(3), // due this week
    duration: null,
    timeframe_description: null,
    amount: null,
    currency: null,
    is_critical: false,
    status: 'PENDING',
    completed_at: null,
    created_at: new Date().toISOString(),
    project: { id: 'p-1', name: 'Bridge Project' },
    contract: { id: 'c-1', name: 'Main Bridge Contract' },
    assignees: [],
  },
];

// ─────────────────────────────────────────────────────────────────
// Render helper
// ─────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ObligationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('ObligationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectService.getAll).mockResolvedValue([]);
    vi.mocked(projectService.getMembers).mockResolvedValue([]);
  });

  it('renders the header with View Calendar + Export buttons', async () => {
    vi.mocked(obligationService.getPortfolioObligations).mockResolvedValue([]);
    renderPage();
    await screen.findByText('obligation.ui.allTitle');
    expect(screen.getByText('obligation.ui.allSubtitle')).toBeInTheDocument();
    expect(screen.getByText('obligation.ui.viewCalendar')).toBeInTheDocument();
    expect(screen.getByText('obligation.ui.exportExcel')).toBeInTheDocument();
  });

  it('renders all four KPI cards', async () => {
    vi.mocked(obligationService.getPortfolioObligations).mockResolvedValue(PORTFOLIO);
    renderPage();
    await screen.findByText('obligation.ui.kpi.total');
    expect(screen.getByText('obligation.ui.kpi.pending')).toBeInTheDocument();
    expect(screen.getByText('obligation.ui.kpi.overdue')).toBeInTheDocument();
    expect(screen.getByText('obligation.ui.kpi.actioned')).toBeInTheDocument();
  });

  it('renders the portfolio empty state when no obligations exist', async () => {
    vi.mocked(obligationService.getPortfolioObligations).mockResolvedValue([]);
    renderPage();
    await screen.findByText('obligation.ui.empty');
  });

  it('renders an obligation card with project + contract links and dir="auto"', async () => {
    vi.mocked(obligationService.getPortfolioObligations).mockResolvedValue(PORTFOLIO);
    renderPage();
    const desc = await screen.findByText('Submit monthly progress reports');
    expect(desc).toHaveAttribute('dir', 'auto');
    expect(screen.getByText('Bridge Project')).toBeInTheDocument();
    expect(screen.getByText('Main Bridge Contract')).toBeInTheDocument();
  });

  it('shows the filter bar with portfolio-only fields (Project + Search)', async () => {
    vi.mocked(obligationService.getPortfolioObligations).mockResolvedValue([]);
    renderPage();
    await screen.findByText('obligation.ui.allTitle');
    // Project label is t('project.title')
    expect(screen.getByText('project.title')).toBeInTheDocument();
    expect(screen.getByText('common.search')).toBeInTheDocument();
  });
});
