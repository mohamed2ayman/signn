/**
 * 7.20 Slice 5 — Customize mode component tests (RED-first).
 *
 * Covers the customize UX on the four SUPPORTING ANALYTICS widgets:
 * reorder, hide, restore, persistence round-trip, corrupt-value resilience,
 * all-hidden empty state, reset-to-default, and the invariant that the fixed
 * spine (health bar / attention zone) exposes NO customize controls (they are
 * not part of this component's manageable set at all).
 *
 * Service level + chart children are mocked (jsdom has no canvas); the REAL
 * dashboardLayout module + localStorage drive the assertions.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ProjectAnalyticsRow from '@/components/project/ProjectAnalyticsRow';
import { projectService } from '@/services/api/projectService';
import { projectPartyService } from '@/services/api/projectPartyService';
import { obligationService } from '@/services/api/obligationService';
import { layoutStorageKey, DEFAULT_WIDGET_ORDER } from '@/components/project/dashboardLayout';

// ── Mocks (lesson #37 — service level; t() returns the key) ──────

vi.mock('react-redux', () => ({
  useSelector: (sel: (s: unknown) => unknown) => sel({ auth: { user: { id: 'u-1' } } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Chart / KPI children render <canvas> internals that jsdom can't — stub them.
vi.mock('@/components/portfolio/RiskDistributionBar', () => ({
  default: () => <div data-testid="riskbar-stub" />,
}));
vi.mock('@/components/portfolio/StatusPie', () => ({
  default: () => <div data-testid="statuspie-stub" />,
}));
vi.mock('@/components/obligations/ObligationKpiRow', () => ({
  default: () => <div data-testid="kpirow-stub" />,
}));

vi.mock('@/services/api/projectService', () => {
  const svc = { getDashboard: vi.fn(), getMembers: vi.fn() };
  return { projectService: svc, default: svc };
});
vi.mock('@/services/api/projectPartyService', () => {
  const svc = { getAll: vi.fn() };
  return { projectPartyService: svc, default: svc };
});
vi.mock('@/services/api/obligationService', () => {
  const svc = { getPortfolioObligations: vi.fn() };
  return { obligationService: svc, default: svc };
});

const PROJECT_ID = 'proj-1';
const KEY = layoutStorageKey('u-1', PROJECT_ID);

function renderRow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProjectAnalyticsRow projectId={PROJECT_ID} />
    </QueryClientProvider>,
  );
}

function visibleWidgetIds(): string[] {
  return screen
    .queryAllByTestId(/^widget-/)
    .map((el) => el.getAttribute('data-testid')!.replace('widget-', ''));
}

function readStored(): { order: string[]; hidden: string[] } | null {
  const raw = localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  (projectService.getDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
    risk_summary: [],
    contracts: { by_status: [] },
  });
  (projectService.getMembers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (obligationService.getPortfolioObligations as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (projectPartyService.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

// ── Tests ────────────────────────────────────────────────────────

describe('ProjectAnalyticsRow — customize mode', () => {
  it('renders all four analytics widgets in default order, with a Customize entry point', async () => {
    renderRow();
    await waitFor(() => expect(screen.getByTestId('customize-toggle')).toBeInTheDocument());
    expect(visibleWidgetIds()).toEqual([...DEFAULT_WIDGET_ORDER]);
  });

  it('the fixed spine (health bar / attention zone) is NOT customizable — only the 4 widgets have manage rows', async () => {
    renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    const manageRows = screen
      .getAllByTestId(/^manage-row-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(manageRows.sort()).toEqual(
      ['manage-row-contractsByStatus', 'manage-row-directory', 'manage-row-obligations', 'manage-row-riskMix'].sort(),
    );
    // The spine widgets must never appear as manageable rows.
    expect(screen.queryByTestId('manage-row-health')).not.toBeInTheDocument();
    expect(screen.queryByTestId('manage-row-attention')).not.toBeInTheDocument();
  });

  it('HIDE removes a widget from the row and persists to localStorage', async () => {
    renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    fireEvent.click(screen.getByTestId('customize-visibility-directory')); // hide directory
    fireEvent.click(screen.getByTestId('customize-done'));

    expect(screen.queryByTestId('widget-directory')).not.toBeInTheDocument();
    expect(visibleWidgetIds()).toEqual(['riskMix', 'obligations', 'contractsByStatus']);
    expect(readStored()?.hidden).toEqual(['directory']);
  });

  it('RESTORE brings a hidden widget back', async () => {
    // start hidden
    localStorage.setItem(KEY, JSON.stringify({ v: 1, order: DEFAULT_WIDGET_ORDER, hidden: ['directory'] }));
    renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    // hidden row still listed (restore affordance) — toggle it back on
    fireEvent.click(screen.getByTestId('customize-visibility-directory'));
    fireEvent.click(screen.getByTestId('customize-done'));

    expect(screen.getByTestId('widget-directory')).toBeInTheDocument();
    expect(readStored()?.hidden).toEqual([]);
  });

  it('REORDER (move down) changes the order and persists', async () => {
    renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    fireEvent.click(screen.getByTestId('customize-movedown-riskMix')); // riskMix ↓
    fireEvent.click(screen.getByTestId('customize-done'));

    expect(visibleWidgetIds()).toEqual(['obligations', 'riskMix', 'contractsByStatus', 'directory']);
    expect(readStored()?.order).toEqual(['obligations', 'riskMix', 'contractsByStatus', 'directory']);
  });

  it('move-up is disabled for the first row and move-down for the last (keyboard-accessible bounds)', async () => {
    renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    expect(screen.getByTestId('customize-moveup-riskMix')).toBeDisabled();
    expect(screen.getByTestId('customize-movedown-directory')).toBeDisabled();
  });

  it('native drag-and-drop reorders via the same pure transform', async () => {
    renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    const source = screen.getByTestId('manage-row-directory');
    const target = screen.getByTestId('manage-row-riskMix');
    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    fireEvent.click(screen.getByTestId('customize-done'));
    expect(visibleWidgetIds()).toEqual(['directory', 'riskMix', 'obligations', 'contractsByStatus']);
  });

  it('PERSISTENCE round-trips across a remount', async () => {
    const first = renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    fireEvent.click(screen.getByTestId('customize-visibility-obligations')); // hide
    fireEvent.click(screen.getByTestId('customize-done'));
    first.unmount();

    renderRow(); // fresh instance, same project/user key
    await waitFor(() => expect(screen.getByTestId('customize-toggle')).toBeInTheDocument());
    expect(screen.queryByTestId('widget-obligations')).not.toBeInTheDocument();
    expect(visibleWidgetIds()).toEqual(['riskMix', 'contractsByStatus', 'directory']);
  });

  it('a CORRUPT stored value falls back to the default layout and does NOT crash (resilience)', async () => {
    localStorage.setItem(KEY, '{ not valid json ]');
    expect(() => renderRow()).not.toThrow();
    await waitFor(() => expect(screen.getByTestId('customize-toggle')).toBeInTheDocument());
    expect(visibleWidgetIds()).toEqual([...DEFAULT_WIDGET_ORDER]); // full default, nothing dropped
  });

  it('ALL FOUR hidden → an empty state with a restore affordance (never a blank void)', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, order: DEFAULT_WIDGET_ORDER, hidden: [...DEFAULT_WIDGET_ORDER] }),
    );
    renderRow();
    await waitFor(() => expect(screen.getByTestId('analytics-empty')).toBeInTheDocument());
    expect(visibleWidgetIds()).toEqual([]); // no widgets rendered...
    expect(screen.getByTestId('customize-empty-restore')).toBeInTheDocument(); // ...but a way back

    // the restore affordance opens the customize panel where widgets can be shown
    fireEvent.click(screen.getByTestId('customize-empty-restore'));
    expect(screen.getByTestId('customize-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^manage-row-/)).toHaveLength(4);
  });

  it('RESET restores the original order and un-hides everything', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        order: ['directory', 'contractsByStatus', 'obligations', 'riskMix'],
        hidden: ['riskMix', 'obligations'],
      }),
    );
    renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    fireEvent.click(screen.getByTestId('customize-reset'));

    // manage rows back to default order
    const rows = screen
      .getAllByTestId(/^manage-row-/)
      .map((el) => el.getAttribute('data-testid')!.replace('manage-row-', ''));
    expect(rows).toEqual([...DEFAULT_WIDGET_ORDER]);

    fireEvent.click(screen.getByTestId('customize-done'));
    expect(visibleWidgetIds()).toEqual([...DEFAULT_WIDGET_ORDER]);
    expect(readStored()).toMatchObject({ order: [...DEFAULT_WIDGET_ORDER], hidden: [] });
  });

  it('RESET is disabled while the layout is already default', async () => {
    renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    expect(screen.getByTestId('customize-reset')).toBeDisabled();

    // once a change is made, reset becomes available
    fireEvent.click(screen.getByTestId('customize-visibility-riskMix'));
    expect(screen.getByTestId('customize-reset')).not.toBeDisabled();
  });

  it('shows the honest per-browser persistence note (no cross-device promise)', async () => {
    renderRow();
    fireEvent.click(await screen.findByTestId('customize-toggle'));
    const panel = screen.getByTestId('customize-panel');
    expect(within(panel).getByText('projectDashboard.customize.browserNote')).toBeInTheDocument();
  });
});
