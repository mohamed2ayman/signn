/**
 * TopBar user menu — Settings entry guard (Slice A1).
 *
 * The sidebar removal is guarded by App.navItems.test.ts. This file guards the
 * other half: the TopBar entry is what makes /app/settings REACHABLE now that
 * the four sidebar links are gone, and it had no test.
 *
 * Colocated as a SEPARATE file rather than appended to TopBar.test.tsx: that
 * file relies on vitest globals with no `import ... from 'vitest'`, so it
 * contributes ~23 pre-existing errors to the repo's tsc baseline. Editing it
 * would shift those error line numbers (and add more), breaking the
 * byte-identical-tsc property this branch maintains. The harness below —
 * mocks, store, providers, render helper — is copied from it verbatim, plus a
 * useNavigate spy that the original does not need.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import TopBar from '@/components/layout/TopBar';
import { notificationService } from '@/services/api/notificationService';
import authReducer from '@/store/slices/authSlice';

// ── Navigation spy — the assertion target for the click behaviour ──
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Service mock ──────────────────────────────────────────────────
vi.mock('@/services/api/notificationService', () => ({
  notificationService: {
    getUnreadCount: vi.fn(),
  },
}));

// ── useAuth mock — TopBar only consumes `logout` ──────────────────
vi.mock('@/hooks/useAuth', () => ({
  default: () => ({ logout: vi.fn() }),
}));

// ── i18n mock — `t` is the identity function, so assertions are made
//    against i18n KEYS rather than English copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string) => fallback ?? k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// LanguageToggle reaches into i18next at module load — stub it out.
vi.mock('@/components/common/LanguageToggle', () => ({
  default: () => null,
}));
vi.mock('@/components/common/ManagexLogo', () => ({
  ManagexMark: () => null,
}));

function makeStore(authState: Record<string, unknown> = {}) {
  return configureStore({
    reducer: { auth: authReducer },
    preloadedState: {
      auth: {
        user: { id: 'u-1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
        isAuthenticated: true,
        isLoading: false,
        mfaRequired: false,
        mfaMethod: null,
        mfaEmail: null,
        mfaSetupRequired: false,
        ...authState,
      } as unknown as ReturnType<typeof authReducer>,
    },
  });
}

function renderTopBar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <Provider store={makeStore()}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <TopBar />
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
}

/**
 * Renders TopBar and opens the user dropdown by clicking the avatar trigger
 * (initials "AL"). Returns the trigger so a test can re-open the menu after an
 * item click closes it — re-calling this helper would mount a SECOND TopBar.
 */
function openUserMenu(): HTMLButtonElement {
  renderTopBar();
  const trigger = screen.getByText('AL').closest('button');
  expect(trigger).not.toBeNull();
  fireEvent.click(trigger as HTMLButtonElement);
  return trigger as HTMLButtonElement;
}

const buttonFor = (label: string) =>
  screen.getByText(label).closest('button') as HTMLButtonElement;

describe('TopBar user menu — Settings entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notificationService.getUnreadCount).mockResolvedValue({ count: 0 });
  });

  it('is not rendered until the menu is opened', () => {
    renderTopBar();
    expect(screen.queryByText('nav.settings')).toBeNull();
  });

  // (a)
  it('renders a menu item labelled via t("nav.settings") when the menu is open', () => {
    openUserMenu();
    expect(screen.getByText('nav.settings')).toBeInTheDocument();
  });

  // (b)
  it('navigates to /app/settings when clicked', () => {
    openUserMenu();
    fireEvent.click(buttonFor('nav.settings'));

    expect(mockNavigate).toHaveBeenCalledWith('/app/settings');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  // (c)
  it('closes the menu when clicked', () => {
    openUserMenu();
    expect(screen.getByText('nav.settings')).toBeInTheDocument();

    fireEvent.click(buttonFor('nav.settings'));

    // The dropdown is conditionally rendered on showUserMenu, so the whole
    // menu unmounting is the observable effect of setShowUserMenu(false).
    expect(screen.queryByText('nav.settings')).toBeNull();
    expect(screen.queryByText('Restart Tour')).toBeNull();
    expect(screen.queryByText('auth.logout')).toBeNull();
  });

  // (d) — DOM order, not just presence.
  it('sits in the same button group as Profile/Billing/Restart Tour, ABOVE the logout separator', () => {
    openUserMenu();

    const settings = buttonFor('nav.settings');
    const profile = buttonFor('nav.profile');
    const logout = buttonFor('auth.logout');

    // Same group as the other menu items…
    expect(settings.parentElement).toBe(profile.parentElement);
    // …and NOT in the separated logout group.
    expect(settings.parentElement).not.toBe(logout.parentElement);

    // Document order: Settings precedes Logout.
    expect(
      settings.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Exact position within the group: fourth, after Restart Tour.
    const groupLabels = Array.from(
      (settings.parentElement as HTMLElement).querySelectorAll('button'),
    ).map((b) => b.textContent?.trim());
    expect(groupLabels).toEqual([
      'nav.profile',
      'Billing',
      'Restart Tour',
      'nav.settings',
    ]);
  });

  // (e) — regression guard: the insertion displaced nothing.
  it('leaves the pre-existing menu items intact', () => {
    openUserMenu();

    expect(screen.getByText('nav.profile')).toBeInTheDocument();
    expect(screen.getByText('Billing')).toBeInTheDocument();
    expect(screen.getByText('Restart Tour')).toBeInTheDocument();
    expect(screen.getByText('auth.logout')).toBeInTheDocument();

    // Five items total: the four pre-existing plus Settings.
    expect(screen.getByText('auth.logout').closest('div')).not.toBeNull();
    const allMenuButtons = [
      buttonFor('nav.profile'),
      buttonFor('Billing'),
      buttonFor('Restart Tour'),
      buttonFor('nav.settings'),
      buttonFor('auth.logout'),
    ];
    expect(new Set(allMenuButtons).size).toBe(5);
  });

  it('each pre-existing item still navigates to its original destination', () => {
    // Re-open via the SAME trigger between clicks — calling openUserMenu()
    // again would mount a second TopBar into the same document.
    const trigger = openUserMenu();

    fireEvent.click(buttonFor('nav.profile'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/profile');

    fireEvent.click(trigger);
    fireEvent.click(buttonFor('Billing'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/settings/billing');

    fireEvent.click(trigger);
    fireEvent.click(buttonFor('Restart Tour'));
    expect(mockNavigate).toHaveBeenCalledWith('/app/onboarding');

    expect(mockNavigate).toHaveBeenCalledTimes(3);
  });
});
