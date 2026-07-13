/**
 * 7.20 Slice 4a — Parties & Team directory DISPLAY (RED-first).
 *
 * Component tests for the three-section directory that replaces the
 * "Parties & Team" tab placeholder. Display-only: no invite POST
 * (that is Slice 4b) — the invite buttons must be disabled.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ProjectPartiesDirectory from '@/components/project/ProjectPartiesDirectory';
import { projectPartyService } from '@/services/api/projectPartyService';
import { projectService } from '@/services/api/projectService';
import { PartyType } from '@/types';
import type { ProjectParty, ProjectMember } from '@/types';

// ─────────────────────────────────────────────────────────────────
// Mocks — service level (lesson #37), t() returns the key (codebase
// convention, matches ObligationsTab.test.tsx).
// ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/services/api/projectPartyService', () => {
  const svc = { getAll: vi.fn() };
  return { projectPartyService: svc, default: svc };
});

vi.mock('@/services/api/projectService', () => {
  const svc = { getMembers: vi.fn() };
  return { projectService: svc, default: svc };
});

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

function mkParty(overrides: Partial<ProjectParty> = {}): ProjectParty {
  return {
    id: `party-${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'p-1',
    owner_organization_id: 'org-1',
    party_organization_id: null,
    party_type: PartyType.CONTRACTOR,
    name: 'Acme Contracting',
    email: 'acme@example.com',
    contact_person: null,
    phone: null,
    invitation_token: null,
    invitation_status: 'PENDING',
    permissions: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function mkMember(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    id: `member-${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'p-1',
    user_id: 'user-1',
    role: 'MEMBER',
    permission_level: null,
    added_at: '2026-07-01T00:00:00.000Z',
    user: {
      id: 'user-1',
      organization_id: 'org-1',
      email: 'jane@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      role: 'OWNER_CREATOR',
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
    } as ProjectMember['user'],
    ...overrides,
  };
}

const THREE_STATUS_PARTIES: ProjectParty[] = [
  mkParty({
    id: 'party-accepted',
    name: 'Active Corp',
    email: 'active@example.com',
    invitation_status: 'ACCEPTED',
    party_type: PartyType.EMPLOYER,
    contact_person: 'Alice Active',
    phone: '+20 100 000 0000',
  }),
  mkParty({
    id: 'party-invited',
    name: 'Invited LLC',
    email: 'invited@example.com',
    invitation_status: 'INVITED',
    party_type: PartyType.CONTRACTOR,
  }),
  mkParty({
    id: 'party-pending',
    name: 'Pending GmbH',
    email: 'pending@example.com',
    invitation_status: 'PENDING',
    party_type: PartyType.SUBCONTRACTOR,
  }),
];

// ─────────────────────────────────────────────────────────────────
// Render helper — fresh QueryClient per test so cache never leaks
// ─────────────────────────────────────────────────────────────────

function renderDirectory(projectId = 'p-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProjectPartiesDirectory projectId={projectId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('ProjectPartiesDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(projectPartyService.getAll).mockResolvedValue([]);
    vi.mocked(projectService.getMembers).mockResolvedValue([]);
  });

  // ── Status badges — all three states ──────────────────────────

  it('maps invitation_status to the three distinct status badges', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue(THREE_STATUS_PARTIES);
    renderDirectory();

    await screen.findByText('Active Corp');
    expect(
      screen.getByText('projectDashboard.directory.parties.status.active'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projectDashboard.directory.parties.status.invited'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projectDashboard.directory.parties.status.pending'),
    ).toBeInTheDocument();
  });

  it('shows a contextual footer line per status', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue(THREE_STATUS_PARTIES);
    renderDirectory();

    await screen.findByText('Active Corp');
    expect(
      screen.getByText('projectDashboard.directory.parties.footer.active'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projectDashboard.directory.parties.footer.invited'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projectDashboard.directory.parties.footer.notInvited'),
    ).toBeInTheDocument();
  });

  // ── Null-field handling on party cards ─────────────────────────

  it('renders null contact_person as "No contact person" and null phone as "—"', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue([
      mkParty({ contact_person: null, phone: null }),
    ]);
    renderDirectory();

    await screen.findByText('Acme Contracting');
    expect(
      screen.getByText('projectDashboard.directory.parties.noContactPerson'),
    ).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders party name with dir="auto" (Arabic-safe) and the type badge from the shared labels', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue([
      mkParty({ name: 'شركة المقاولات العربية', party_type: PartyType.CONTRACTOR }),
    ]);
    renderDirectory();

    const name = await screen.findByText('شركة المقاولات العربية');
    expect(name).toHaveAttribute('dir', 'auto');
    // Reuses the EXISTING Slice-3 party-type label keys — no duplicates.
    // The label legitimately appears twice: filter chip + card type badge.
    expect(
      screen.getAllByText('projectDashboard.analytics.directory.partyType.CONTRACTOR').length,
    ).toBeGreaterThanOrEqual(2);
  });

  // ── Invite buttons: display-only this slice (4b does the POST) ─

  it('renders invite buttons DISABLED — no inline POST this slice', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue(THREE_STATUS_PARTIES);
    renderDirectory();

    await screen.findByText('Pending GmbH');
    // PENDING → "Send invite", INVITED → "Resend invite"; ACCEPTED → none.
    const send = screen.getByText('projectDashboard.directory.parties.invite');
    const resend = screen.getByText('projectDashboard.directory.parties.resendInvite');
    expect(send.closest('button')).toBeDisabled();
    expect(resend.closest('button')).toBeDisabled();
    // The invite endpoint must never be called from this slice.
    expect(vi.mocked(projectPartyService.getAll)).toHaveBeenCalled();
  });

  // ── Party-type filter ──────────────────────────────────────────

  it('filters the grid by party type and shows correct counts on the chips', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue([
      mkParty({ id: 'c1', name: 'Contractor One', party_type: PartyType.CONTRACTOR }),
      mkParty({ id: 'c2', name: 'Contractor Two', party_type: PartyType.CONTRACTOR }),
      mkParty({ id: 'e1', name: 'Employer One', party_type: PartyType.EMPLOYER }),
    ]);
    renderDirectory();

    await screen.findByText('Contractor One');
    // All three visible initially
    expect(screen.getByText('Employer One')).toBeInTheDocument();

    // Chips carry counts: All (3), CONTRACTOR (2), EMPLOYER (1)
    const contractorChip = screen.getByRole('button', {
      name: /partyType\.CONTRACTOR.*2/,
    });
    expect(
      screen.getByRole('button', { name: /filterAll.*3/ }),
    ).toBeInTheDocument();

    fireEvent.click(contractorChip);

    // Only contractors remain
    expect(screen.getByText('Contractor One')).toBeInTheDocument();
    expect(screen.getByText('Contractor Two')).toBeInTheDocument();
    expect(screen.queryByText('Employer One')).not.toBeInTheDocument();
  });

  // ── Empty states ───────────────────────────────────────────────

  it('renders the parties empty state when there are no parties', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue([]);
    vi.mocked(projectService.getMembers).mockResolvedValue([mkMember()]);
    renderDirectory();

    expect(
      await screen.findByText('projectDashboard.directory.parties.empty'),
    ).toBeInTheDocument();
  });

  it('renders the team empty state when there are no members', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue([mkParty()]);
    vi.mocked(projectService.getMembers).mockResolvedValue([]);
    renderDirectory();

    expect(
      await screen.findByText('projectDashboard.directory.team.empty'),
    ).toBeInTheDocument();
  });

  // ── Internal team matrix: null handling ────────────────────────

  it('renders the team matrix handling real nulls (job_title, permission_level)', async () => {
    vi.mocked(projectService.getMembers).mockResolvedValue([
      mkMember(), // job_title null, permission_level null
    ]);
    renderDirectory();

    await screen.findByText('Jane Doe');
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    // job_title null → "Not set"
    expect(
      screen.getByText('projectDashboard.directory.team.jobTitleNotSet'),
    ).toBeInTheDocument();
    // permission_level null → VIEWER fallback badge
    expect(
      screen.getByText('projectDashboard.directory.team.permissionLevel.VIEWER'),
    ).toBeInTheDocument();
  });

  it('renders an empty-name member as a pending teammate', async () => {
    vi.mocked(projectService.getMembers).mockResolvedValue([
      mkMember({
        user: {
          ...mkMember().user!,
          first_name: '',
          last_name: '',
          email: 'invited@example.com',
        },
      }),
    ]);
    renderDirectory();

    expect(
      await screen.findByText('projectDashboard.directory.team.pendingTeammate'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projectDashboard.directory.team.pendingInvitation'),
    ).toBeInTheDocument();
  });

  it('links "Manage permissions" to the existing permissions page', async () => {
    vi.mocked(projectService.getMembers).mockResolvedValue([mkMember()]);
    renderDirectory('p-42');

    await screen.findByText('Jane Doe');
    const link = screen
      .getByText('projectDashboard.directory.team.managePermissions')
      .closest('a');
    expect(link).toHaveAttribute('href', '/app/projects/p-42/permissions');
  });

  // ── Portal Guests — vision placeholder, never populated ────────

  it('renders Portal Guests as a labelled, non-populated placeholder', async () => {
    renderDirectory();

    expect(
      await screen.findByText('projectDashboard.directory.guests.title'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projectDashboard.directory.guests.plannedBadge'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('projectDashboard.directory.guests.explanation'),
    ).toBeInTheDocument();
  });

  // ── Per-source error isolation ─────────────────────────────────

  it('a parties fetch failure does not blank the team section (per-source isolation)', async () => {
    vi.mocked(projectPartyService.getAll).mockRejectedValue(new Error('boom'));
    vi.mocked(projectService.getMembers).mockResolvedValue([mkMember()]);
    renderDirectory();

    // Team still renders
    await screen.findByText('Jane Doe');
    // Parties section shows its own error state
    await waitFor(() =>
      expect(
        screen.getByText('projectDashboard.directory.parties.error'),
      ).toBeInTheDocument(),
    );
  });

  it('a members fetch failure does not blank the parties section', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue([mkParty()]);
    vi.mocked(projectService.getMembers).mockRejectedValue(new Error('boom'));
    renderDirectory();

    await screen.findByText('Acme Contracting');
    await waitFor(() =>
      expect(
        screen.getByText('projectDashboard.directory.team.error'),
      ).toBeInTheDocument(),
    );
  });
});
