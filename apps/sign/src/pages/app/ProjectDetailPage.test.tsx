import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ProjectDetailPage from '@/pages/app/ProjectDetailPage';
import { projectService } from '@/services/api/projectService';
import { contractService } from '@/services/api/contractService';
import { obligationService } from '@/services/api/obligationService';
import type { ProjectDashboard } from '@/services/api/projectService';

// ─────────────────────────────────────────────────────────────────
// Mocks — service level only (axios.ts side-effect-loads the Redux
// store, per lesson #37)
// ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0
        ? `${k}:${Object.values(opts).join(',')}`
        : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/services/api/projectService', () => ({
  projectService: {
    getById: vi.fn(),
    getDashboard: vi.fn(),
  },
}));

vi.mock('@/services/api/contractService', () => ({
  contractService: {
    getAll: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('@/services/api/obligationService', () => ({
  obligationService: {
    getPortfolioObligations: vi.fn(),
  },
}));

// Heavy children — irrelevant to the tab shell under test.
vi.mock('@/components/chat/ChatPanel', () => ({
  default: () => null,
}));
vi.mock('@/components/contracts/ContractTypeSelector', () => ({
  default: () => null,
}));

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const PROJECT = {
  id: 'p-1',
  organization_id: 'org-1',
  name: 'Metro Line 4',
  objective: 'Underground works',
  country: 'Egypt',
  start_date: null,
  end_date: null,
  created_by: 'u-1',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  members: [],
};

const CONTRACTS = [
  {
    id: 'c-1',
    project_id: 'p-1',
    name: 'Main Construction Agreement',
    contract_type: 'FIDIC_RED_BOOK_2017',
    status: 'ACTIVE',
    current_version: 2,
    party_type: null,
    created_by: 'u-1',
    approved_by: null,
    approved_at: null,
    shared_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
] as never[];

const DASHBOARD: ProjectDashboard = {
  project_id: 'p-1',
  contracts: { total: 1, by_status: [{ status: 'ACTIVE', count: '1' }] },
  parties: { total: 0, by_type: [] },
  risk_summary: [{ risk_level: 'LOW', count: '2' }],
};

// ─────────────────────────────────────────────────────────────────
// Render helper
// ─────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/projects/p-1']}>
        <Routes>
          <Route path="/app/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('ProjectDetailPage — tabbed shell (7.20 slice 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectService.getById).mockResolvedValue(PROJECT as never);
    vi.mocked(projectService.getDashboard).mockResolvedValue(DASHBOARD);
    vi.mocked(contractService.getAll).mockResolvedValue(CONTRACTS as never);
    vi.mocked(obligationService.getPortfolioObligations).mockResolvedValue([]);
  });

  it('renders the three tabs with Dashboard active by default', async () => {
    renderPage();
    await screen.findAllByText('Metro Line 4');
    expect(screen.getByRole('tab', { name: 'projectDashboard.tabs.dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'projectDashboard.tabs.contracts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'projectDashboard.tabs.partiesTeam' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'projectDashboard.tabs.dashboard' }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  it('shows the health widget on the default Dashboard tab', async () => {
    renderPage();
    await screen.findAllByText('Metro Line 4');
    expect(await screen.findByText('projectDashboard.health.title')).toBeInTheDocument();
  });

  it('switching to Contracts still shows the existing contracts list', async () => {
    renderPage();
    await screen.findAllByText('Metro Line 4');
    // Contracts card must NOT be on the dashboard tab…
    expect(screen.queryByText('Main Construction Agreement')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'projectDashboard.tabs.contracts' }));
    // …but must render, unchanged, on the Contracts tab.
    expect(await screen.findByText('Main Construction Agreement')).toBeInTheDocument();
  });

  it('switching to Parties & Team shows the placeholder', async () => {
    renderPage();
    await screen.findAllByText('Metro Line 4');
    await userEvent.click(screen.getByRole('tab', { name: 'projectDashboard.tabs.partiesTeam' }));
    expect(await screen.findByText('projectDashboard.parties.comingSoon')).toBeInTheDocument();
  });

  it('renders a real score once dashboard + contracts + obligations resolve', async () => {
    renderPage();
    await screen.findAllByText('Metro Line 4');
    // All-clear fixture → 100 / healthy.
    expect(await screen.findByText('100%')).toBeInTheDocument();
    expect(screen.getByText('projectDashboard.health.band.healthy')).toBeInTheDocument();
  });

  it('shows the neutral insufficient-data state when nothing is analysed', async () => {
    vi.mocked(projectService.getDashboard).mockResolvedValue({
      ...DASHBOARD,
      risk_summary: [],
    });
    renderPage();
    await screen.findAllByText('Metro Line 4');
    expect(
      await screen.findByText('projectDashboard.health.insufficientTitle'),
    ).toBeInTheDocument();
    // Never a misleading score in this state.
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────
// 7.20 slice 2 — "Needs your attention" zone
// ─────────────────────────────────────────────────────────────────

const isoDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();
const dateDaysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('ProjectDetailPage — attention zone (7.20 slice 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectService.getById).mockResolvedValue(PROJECT as never);
    vi.mocked(projectService.getDashboard).mockResolvedValue(DASHBOARD);
    vi.mocked(contractService.getAll).mockResolvedValue(CONTRACTS as never);
    vi.mocked(obligationService.getPortfolioObligations).mockResolvedValue([]);
  });

  it('shows overdue, expiring, and high-risk entries when present', async () => {
    vi.mocked(projectService.getDashboard).mockResolvedValue({
      ...DASHBOARD,
      risk_summary: [
        { risk_level: 'HIGH', count: '3' },
        { risk_level: 'LOW', count: '1' },
      ],
    });
    vi.mocked(contractService.getAll).mockResolvedValue([
      {
        ...(CONTRACTS[0] as object),
        id: 'c-exp',
        name: 'Expiring Steel Supply',
        expiry_date: dateDaysFromNow(10),
      },
    ] as never);
    vi.mocked(obligationService.getPortfolioObligations).mockResolvedValue([
      {
        id: 'ob-1',
        contract_id: 'c-1',
        description: 'Submit overdue payment certificate',
        status: 'PENDING', // derived-overdue: PENDING + past due (the landmine)
        due_date: isoDaysFromNow(-6),
        obligation_type: 'PAYMENT',
        is_critical: true,
        responsible_party: 'EMPLOYER',
        contract: { id: 'c-1', name: 'Main Construction Agreement' },
      },
    ] as never);

    renderPage();
    await screen.findAllByText('Metro Line 4');
    expect(await screen.findByText('projectDashboard.attention.title')).toBeInTheDocument();
    // Overdue row (derived from PENDING + past due_date)
    expect(await screen.findByText('Submit overdue payment certificate')).toBeInTheDocument();
    // Expiring row
    expect(screen.getByText('Expiring Steel Supply')).toBeInTheDocument();
    // High-risk entry (count interpolated by mocked t as key:values)
    expect(screen.getByText(/projectDashboard\.attention\.highRisk:3/)).toBeInTheDocument();
    // No all-clear when things need attention
    expect(screen.queryByText('projectDashboard.attention.allClearTitle')).not.toBeInTheDocument();
  });

  it('shows the all-clear state when zero overdue, expiring, and high-risk', async () => {
    // Default mocks: LOW-only risk, no expiry, no obligations.
    renderPage();
    await screen.findAllByText('Metro Line 4');
    expect(await screen.findByText('projectDashboard.attention.allClearTitle')).toBeInTheDocument();
  });

  it('does NOT surface actioned obligations as overdue', async () => {
    vi.mocked(obligationService.getPortfolioObligations).mockResolvedValue([
      {
        id: 'ob-met',
        contract_id: 'c-1',
        description: 'Old met obligation',
        status: 'MET',
        due_date: isoDaysFromNow(-90),
        obligation_type: 'INSURANCE',
        is_critical: false,
        responsible_party: 'CONTRACTOR',
      },
    ] as never);
    renderPage();
    await screen.findAllByText('Metro Line 4');
    // MET + past due is NOT overdue → all-clear (given LOW-only risk, no expiry).
    expect(await screen.findByText('projectDashboard.attention.allClearTitle')).toBeInTheDocument();
    expect(screen.queryByText('Old met obligation')).not.toBeInTheDocument();
  });

  it('per-source isolation: obligations failure shows a scoped error while expiring still renders', async () => {
    vi.mocked(obligationService.getPortfolioObligations).mockRejectedValue(new Error('boom'));
    vi.mocked(contractService.getAll).mockResolvedValue([
      {
        ...(CONTRACTS[0] as object),
        id: 'c-exp2',
        name: 'Expiring HVAC Package',
        expiry_date: dateDaysFromNow(5),
      },
    ] as never);
    renderPage();
    await screen.findAllByText('Metro Line 4');
    // Scoped error for the obligations source…
    expect(await screen.findByText('projectDashboard.attention.error.obligations')).toBeInTheDocument();
    // …while the contracts-sourced expiring row still renders.
    expect(await screen.findByText('Expiring HVAC Package')).toBeInTheDocument();
    // And no all-clear (unknown obligations ≠ all clear).
    expect(screen.queryByText('projectDashboard.attention.allClearTitle')).not.toBeInTheDocument();
  });
});
