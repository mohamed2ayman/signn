/**
 * Settings hub — renderer tests (Slice A1).
 *
 * `t` is mocked to the identity function, so assertions are made against i18n
 * KEYS rather than English copy — the test stays green when copy is reworded
 * and fails when a key is dropped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, matchRoutes } from 'react-router-dom';

import SettingsPage from './SettingsPage';
import { UserRole } from '@/types';

let currentRole: UserRole | null = UserRole.OWNER_ADMIN;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { user: currentRole ? { role: currentRole } : null } }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    currentRole = UserRole.OWNER_ADMIN;
  });

  it('renders 8 cards for OWNER_ADMIN', () => {
    renderPage();
    expect(screen.getAllByRole('link')).toHaveLength(8);
  });

  it('renders 6 cards for OWNER_CREATOR, with Playbook and ERP Connections absent', () => {
    currentRole = UserRole.OWNER_CREATOR;
    renderPage();

    expect(screen.getAllByRole('link')).toHaveLength(6);
    expect(screen.queryByText('settings.items.playbook.title')).toBeNull();
    expect(screen.queryByText('settings.items.erpConnections.title')).toBeNull();
  });

  it('renders both group headings', () => {
    renderPage();
    expect(screen.getByText('settings.groups.workspace')).toBeInTheDocument();
    expect(screen.getByText('settings.groups.personal')).toBeInTheDocument();
  });

  it('shows the admin-only chip exactly twice for OWNER_ADMIN', () => {
    renderPage();
    expect(screen.getAllByText('settings.adminOnly')).toHaveLength(2);
  });

  it('shows no admin-only chip for OWNER_CREATOR', () => {
    currentRole = UserRole.OWNER_CREATOR;
    renderPage();
    expect(screen.queryByText('settings.adminOnly')).toBeNull();
  });

  it('each card links to its entry path', () => {
    renderPage();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/app/settings/playbook');
    expect(hrefs).toContain('/app/team');
    expect(hrefs).toContain('/app/settings/billing');
  });

  // Route-ranking guard: the new bare "settings" route is declared BEFORE its
  // siblings in App.tsx. React Router v6 ranks by specificity rather than
  // declaration order, so the deeper children must still win. Proven here
  // rather than assumed, because getting this wrong would silently swallow
  // every existing /app/settings/* page.
  it('the bare "settings" route does not shadow the settings/* children', () => {
    const routes = [
      {
        path: '/app',
        children: [
          { path: 'settings' },
          { path: 'settings/security' },
          { path: 'settings/communications' },
          { path: 'settings/billing' },
          { path: 'settings/subscription' },
          { path: 'settings/playbook' },
        ],
      },
    ];

    const leafPath = (url: string) => {
      const m = matchRoutes(routes, url);
      return m?.[m.length - 1]?.route.path;
    };

    expect(leafPath('/app/settings')).toBe('settings');
    expect(leafPath('/app/settings/security')).toBe('settings/security');
    expect(leafPath('/app/settings/communications')).toBe('settings/communications');
    expect(leafPath('/app/settings/billing')).toBe('settings/billing');
    expect(leafPath('/app/settings/subscription')).toBe('settings/subscription');
    expect(leafPath('/app/settings/playbook')).toBe('settings/playbook');
  });
});
