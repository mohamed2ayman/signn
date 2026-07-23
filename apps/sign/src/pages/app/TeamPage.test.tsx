import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import TeamPage from '@/pages/app/TeamPage';
import { adminService } from '@/services/api/adminService';
import { UserRole, type User } from '@/types';

// Service-level mock only (axios.ts side-effect-loads the Redux store — lesson #37).
// TeamPage talks to adminService directly (no react-query / redux / i18n / router).
vi.mock('@/services/api/adminService', () => ({
  adminService: {
    getUsers: vi.fn(),
    inviteUser: vi.fn(),
  },
}));

const ownerAdminMember: User = {
  id: 'u1',
  organization_id: 'org1',
  email: 'ada.admin@acme.test',
  first_name: 'Ada',
  last_name: 'Admin',
  role: UserRole.OWNER_ADMIN,
  job_title: null,
  default_permission_level: null,
  is_active: true,
  is_email_verified: true,
  mfa_enabled: false,
  mfa_method: null,
  preferred_language: 'en',
  last_login_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  (adminService.getUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
    ownerAdminMember,
  ]);
});

describe('TeamPage — invite-role ceiling (pairs with #185)', () => {
  it('invite dropdown offers OWNER_CREATOR + OWNER_REVIEWER but NOT OWNER_ADMIN', async () => {
    const user = userEvent.setup();
    render(<TeamPage />);
    await screen.findByText('ada.admin@acme.test'); // wait for load

    await user.click(screen.getByRole('button', { name: /invite member/i }));

    // ASSIGNABLE_ROLES (backend-allowed for an OWNER_ADMIN) are offered…
    expect(
      screen.getByRole('option', { name: 'Contract Creator' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Contract Reviewer' }),
    ).toBeInTheDocument();

    // …but OWNER_ADMIN is NOT an invite option (the #185 gap this fix closes).
    // Scoped to role='option' so the OWNER_ADMIN member badge (a <span>) can't
    // false-positive this assertion.
    expect(
      screen.queryByRole('option', { name: 'Organization Admin' }),
    ).toBeNull();
  });

  it('an existing OWNER_ADMIN member still renders the friendly "Organization Admin" label (badge regression guard — the display/assignable split)', async () => {
    render(<TeamPage />);

    // Invite form is closed, so the badge is the only source of this text.
    expect(await screen.findByText('Organization Admin')).toBeInTheDocument();

    // Must NOT fall back to the raw enum ('OWNER_ADMIN'.replace(/_/g,' ')).
    expect(screen.queryByText('OWNER ADMIN')).toBeNull();
  });
});
