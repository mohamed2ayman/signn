import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ObligationsCalendarPage from '@/pages/app/ObligationsCalendarPage';
import { obligationService } from '@/services/api/obligationService';
import { projectService } from '@/services/api/projectService';

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/services/api/obligationService', () => ({
  obligationService: { getCalendarObligations: vi.fn() },
}));
vi.mock('@/services/api/projectService', () => ({
  projectService: { getAll: vi.fn() },
}));

// Stub react-big-calendar so the test environment doesn't have to
// boot the real RBC + its DOM measuring code. The page's contract
// with RBC is: pass events + accessors and render a calendar. We
// verify the page wires through correctly, not RBC's internals.
vi.mock('react-big-calendar', async () => {
  const actual =
    await vi.importActual<typeof import('react-big-calendar')>('react-big-calendar');
  return {
    ...actual,
    Calendar: ({ events }: { events: unknown[] }) => (
      <div data-testid="mock-calendar">events:{(events ?? []).length}</div>
    ),
  };
});
// react-big-calendar's CSS import is a no-op under vitest's css: false default,
// but we mock it explicitly so the test doesn't try to resolve the file.
vi.mock('react-big-calendar/lib/css/react-big-calendar.css', () => ({}));

// ─────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ObligationsCalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ObligationsCalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectService.getAll).mockResolvedValue([]);
    vi.mocked(obligationService.getCalendarObligations).mockResolvedValue([]);
  });

  it('renders the page header with title + back-to-list link', async () => {
    renderPage();
    // Title appears in both the breadcrumb and the h1 — use heading role
    // to disambiguate.
    await screen.findByRole('heading', { name: 'obligation.calendar.title' });
    expect(screen.getByText('obligation.calendar.subtitle')).toBeInTheDocument();
    expect(screen.getByText('obligation.calendar.backToList')).toBeInTheDocument();
  });

  it('renders the filter bar (Project / Type / Status)', async () => {
    renderPage();
    // Title appears in both the breadcrumb and the h1 — use heading role
    // to disambiguate.
    await screen.findByRole('heading', { name: 'obligation.calendar.title' });
    expect(screen.getByText('project.title')).toBeInTheDocument();
    expect(screen.getByText('common.type')).toBeInTheDocument();
    expect(screen.getByText('common.status')).toBeInTheDocument();
  });

  it('shows the loading state while the calendar query is in-flight', () => {
    vi.mocked(obligationService.getCalendarObligations).mockReturnValue(
      new Promise(() => {}) as never,
    );
    renderPage();
    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('renders the mocked calendar with zero events on success', async () => {
    renderPage();
    const cal = await screen.findByTestId('mock-calendar');
    expect(cal.textContent).toContain('events:0');
  });
});
