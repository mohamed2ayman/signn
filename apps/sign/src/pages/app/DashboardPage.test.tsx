import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import DashboardPage from '@/pages/app/DashboardPage';
import { dashboardAnalyticsService } from '@/services/api/dashboardAnalyticsService';
import type { DashboardAnalytics } from '@/services/api/dashboardAnalyticsService';

// ─────────────────────────────────────────────────────────────────────────────
// Module mock — service level only (axios.ts is never loaded)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/services/api/dashboardAnalyticsService', () => ({
  dashboardAnalyticsService: {
    getAnalytics: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Complete DashboardAnalytics fixture
// Every nested property the component reads must be present or it crashes.
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_ANALYTICS: DashboardAnalytics = {
  projects: { total: 3 },
  contracts: {
    total: 5,
    by_status: { DRAFT: 2, ACTIVE: 3 },
  },
  risks: {
    total: 10,
    by_level: { HIGH: 3, MEDIUM: 4, LOW: 3 },
    by_status: { OPEN: 7, APPROVED: 2, MITIGATED: 1 },
    high_unresolved: 3,
  },
  obligations: {
    total: 8,
    overdue: 1,
    due_this_week: 2,
    due_this_month: 3,
    completed: 5,
    pending: 3,
    by_status: {},
    completion_rate: 62,
  },
  clauses: {
    total: 45,
    ai_extracted: 40,
    manually_created: 5,
    pending_review: 2,
    approved: 43,
  },
  documents: { total: 4, processed: 4, total_pages: 120 },
  loss_aversion: {
    total_hours_saved: 16,
    hours_saved_extraction: 8,
    hours_saved_clause_analysis: 8,
    documents_processed: 4,
    clauses_extracted: 45,
    unaddressed_high_risks: 3,
    overdue_obligations: 1,
    obligations_due_this_week: 2,
    clauses_pending_review: 2,
    obligation_completion_rate: 62,
  },
  recent_activity: {
    recent_documents: [],
    recent_risks: [],
  },
  upcoming_obligations: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Render helper — no Redux Provider needed (DashboardPage has zero Redux usage)
// ─────────────────────────────────────────────────────────────────────────────

const renderDashboard = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Renders successfully when analytics loads ─────────────────────────

  it('renders the Dashboard heading when analytics loads successfully', async () => {
    vi.mocked(dashboardAnalyticsService.getAnalytics).mockResolvedValue(
      MOCK_ANALYTICS,
    );

    renderDashboard();

    // findByText waits for the async useEffect to resolve and re-render
    const heading = await screen.findByText('Dashboard');
    expect(heading).toBeInTheDocument();
  });

  // ── 2. Shows error state when analytics fails ────────────────────────────

  it('shows error message when analytics fetch fails', async () => {
    vi.mocked(dashboardAnalyticsService.getAnalytics).mockRejectedValue(
      new Error('Network error'),
    );

    renderDashboard();

    const errorMsg = await screen.findByText(/failed to load/i);
    expect(errorMsg).toBeInTheDocument();
  });

  // ── 3. Shows loading state initially ────────────────────────────────────
  // Return a promise that never resolves — component stays in loading state.
  // LoadingSpinner renders role="status" aria-label="Loading"

  it('shows the loading spinner before analytics resolves', () => {
    vi.mocked(dashboardAnalyticsService.getAnalytics).mockReturnValue(
      new Promise(() => {}), // never resolves
    );

    renderDashboard();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
