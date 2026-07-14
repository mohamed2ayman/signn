/**
 * 7.20 Slice 4b — INVITE write action safety guards (RED-first).
 *
 * The backend invite endpoint (POST /project-parties/:id/invite) sends a
 * REAL email on EVERY call with NO idempotency, NO rate limit, and NO
 * "already invited" guard — recon-confirmed. The FRONTEND is the only
 * protection against duplicate real emails, so these tests exist to prove
 * the two MANDATORY guards:
 *   (a) confirmation dialog — no POST until an explicit Confirm;
 *   (b) in-flight guard — a double-click cannot fire a second POST.
 *
 * Also covered: success invalidation of ['project-parties', projectId],
 * error path (toast, no invalidation, deliberate retry), the resend path,
 * and permission gating that mirrors the backend RolesGuard EXACT-match
 * (@Roles(OWNER_ADMIN, OWNER_CREATOR) — membership, not hierarchy, so
 * even SYSTEM_ADMIN is excluded and would 403).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';

import ProjectPartiesDirectory from '@/components/project/ProjectPartiesDirectory';
import { projectPartyService } from '@/services/api/projectPartyService';
import { projectService } from '@/services/api/projectService';
import { PartyType, UserRole } from '@/types';
import type { ProjectParty } from '@/types';

// ─────────────────────────────────────────────────────────────────
// Mocks — service level (lesson #37); t() returns the key; redux
// via the ContractPartiesEditor.test.tsx vi.hoisted pattern so each
// test can swap the current user's role.
// ─────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  user: { id: 'u-1', role: 'OWNER_ADMIN' } as { id: string; role: string } | null,
}));

vi.mock('react-redux', () => ({
  useSelector: (sel: (s: unknown) => unknown) => sel({ auth: { user: h.user } }),
  useDispatch: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api/projectPartyService', () => {
  const svc = { getAll: vi.fn(), invite: vi.fn() };
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
    id: 'party-1',
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
  } as ProjectParty;
}

const PENDING_PARTY = mkParty({
  id: 'party-pending',
  name: 'Pending GmbH',
  email: 'pending@example.com',
  invitation_status: 'PENDING',
});

const INVITED_PARTY = mkParty({
  id: 'party-invited',
  name: 'Invited LLC',
  email: 'invited@example.com',
  invitation_status: 'INVITED',
});

const K = 'projectDashboard.directory.parties';

// ─────────────────────────────────────────────────────────────────
// Render helper — fresh QueryClient per test + invalidation spy
// ─────────────────────────────────────────────────────────────────

function renderDirectory(projectId = 'p-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProjectPartiesDirectory projectId={projectId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, qc, invalidateSpy };
}

async function openConfirmDialog(buttonKey: string) {
  const trigger = (await screen.findByText(buttonKey)).closest('button')!;
  fireEvent.click(trigger);
  return screen.getByRole('dialog');
}

describe('ProjectPartiesDirectory — invite action (Slice 4b safety guards)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.user = { id: 'u-1', role: UserRole.OWNER_ADMIN };
    vi.mocked(projectPartyService.getAll).mockResolvedValue([PENDING_PARTY]);
    vi.mocked(projectPartyService.invite).mockResolvedValue({
      message: 'Invitation sent to pending@example.com',
    });
    vi.mocked(projectService.getMembers).mockResolvedValue([]);
  });

  // ── (a) CONFIRMATION DIALOG — no POST without explicit Confirm ──

  it('clicking "Send invite" opens the confirmation dialog and does NOT call the endpoint', async () => {
    renderDirectory();

    const dialog = await openConfirmDialog(`${K}.invite`);

    // Dialog states WHO will be emailed: party name + email.
    expect(within(dialog).getByText('Pending GmbH')).toBeInTheDocument();
    expect(within(dialog).getByText('pending@example.com')).toBeInTheDocument();
    // WHAT will happen (send-mode copy) + explicit confirm/cancel.
    expect(within(dialog).getByText(`${K}.confirmSendBody`)).toBeInTheDocument();
    expect(within(dialog).getByText(`${K}.confirmSendAction`)).toBeInTheDocument();
    expect(within(dialog).getByText('common.cancel')).toBeInTheDocument();

    // The critical assertion: opening the dialog sent NOTHING.
    expect(projectPartyService.invite).not.toHaveBeenCalled();
  });

  it('Cancel closes the dialog without ever calling the endpoint', async () => {
    renderDirectory();

    const dialog = await openConfirmDialog(`${K}.invite`);
    fireEvent.click(within(dialog).getByText('common.cancel'));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(projectPartyService.invite).not.toHaveBeenCalled();
  });

  it('the party name and email in the dialog are Arabic-safe (dir="auto")', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue([
      mkParty({ name: 'شركة المقاولات', email: 'ar@example.com' }),
    ]);
    renderDirectory();

    const dialog = await openConfirmDialog(`${K}.invite`);
    expect(within(dialog).getByText('شركة المقاولات')).toHaveAttribute('dir', 'auto');
    expect(within(dialog).getByText('ar@example.com')).toHaveAttribute('dir', 'auto');
  });

  // ── Confirm fires EXACTLY ONE call ──────────────────────────────

  it('Confirm calls the invite endpoint exactly once with the party id', async () => {
    renderDirectory();

    const dialog = await openConfirmDialog(`${K}.invite`);
    fireEvent.click(within(dialog).getByText(`${K}.confirmSendAction`));

    await waitFor(() =>
      expect(projectPartyService.invite).toHaveBeenCalledTimes(1),
    );
    expect(projectPartyService.invite).toHaveBeenCalledWith('party-pending');
  });

  // ── (b) DOUBLE-SEND GUARD — the core safety mechanism ──────────

  it('a double/triple-click on Confirm fires exactly ONE POST (in-flight guard)', async () => {
    // Never-resolving promise = the request is in flight the whole test.
    let resolveInvite!: (v: { message: string }) => void;
    vi.mocked(projectPartyService.invite).mockImplementation(
      () => new Promise((res) => (resolveInvite = res)),
    );
    renderDirectory();

    const dialog = await openConfirmDialog(`${K}.invite`);
    const confirm = within(dialog)
      .getByText(`${K}.confirmSendAction`)
      .closest('button')!;

    // Simulated double-click: two clicks in the SAME tick — before any
    // re-render can disable the button. The synchronous ref guard must
    // hold (mutationFn itself runs on a microtask, hence the waitFor —
    // the assertion is that TWO clicks produced exactly ONE call).
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(projectPartyService.invite).toHaveBeenCalledTimes(1),
    );

    // Once pending propagates, the confirm button is disabled too.
    await waitFor(() => {
      const pendingBtn = within(screen.getByRole('dialog'))
        .getByText(`${K}.sending`)
        .closest('button')!;
      expect(pendingBtn).toBeDisabled();
    });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByText(`${K}.sending`).closest('button')!,
    );
    expect(projectPartyService.invite).toHaveBeenCalledTimes(1);

    // While in flight, the card's own invite trigger is disabled as well.
    const cardBtn = screen.getByText(`${K}.invite`).closest('button')!;
    expect(cardBtn).toBeDisabled();

    resolveInvite({ message: 'ok' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  // ── (c) SUCCESS — invalidation + toast ──────────────────────────

  it('on success: invalidates ["project-parties", projectId], shows success toast, closes dialog', async () => {
    const { invalidateSpy } = renderDirectory('p-42');

    const dialog = await openConfirmDialog(`${K}.invite`);
    fireEvent.click(within(dialog).getByText(`${K}.confirmSendAction`));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['project-parties', 'p-42'],
      }),
    );
    expect(toast.success).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  // ── (d) ERROR — toast, no invalidation, deliberate retry ────────

  it('on failure: shows error toast, does NOT invalidate, dialog stays open, confirm re-enabled', async () => {
    vi.mocked(projectPartyService.invite).mockRejectedValue(new Error('boom'));
    const { invalidateSpy } = renderDirectory();

    const dialog = await openConfirmDialog(`${K}.invite`);
    fireEvent.click(within(dialog).getByText(`${K}.confirmSendAction`));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: ['project-parties', 'p-1'],
    });

    // Dialog remains open so a retry is a DELIBERATE second Confirm…
    const stillOpen = screen.getByRole('dialog');
    // …and the confirm button is usable again after the request settled.
    await waitFor(() =>
      expect(
        within(stillOpen).getByText(`${K}.confirmSendAction`).closest('button'),
      ).not.toBeDisabled(),
    );
  });

  // ── RELEASE half of the in-flight guard — the ref MUST reset ────
  // A button that merely looks re-enabled (isPending reset) is not
  // enough: the synchronous ref (inviteInFlight) must also reset in
  // onSettled, or every future Confirm is silently swallowed. This
  // test re-clicks Confirm after a failure and proves a SECOND POST
  // actually fires — it goes RED if the onSettled `inviteInFlight
  // = false` reset is removed (mutation-verified), which the other
  // tests do NOT catch (they never re-invoke after a settle).

  it('after a failed invite, a second Confirm fires a retry POST (ref reset in onSettled)', async () => {
    vi.mocked(projectPartyService.invite)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ message: 'ok' });
    renderDirectory();

    const dialog = await openConfirmDialog(`${K}.invite`);
    fireEvent.click(within(dialog).getByText(`${K}.confirmSendAction`));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    // Confirm re-enabled (isPending reset) …
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog'))
          .getByText(`${K}.confirmSendAction`)
          .closest('button'),
      ).not.toBeDisabled(),
    );

    // … and the ref reset too, so the deliberate retry genuinely POSTs.
    fireEvent.click(
      within(screen.getByRole('dialog'))
        .getByText(`${K}.confirmSendAction`)
        .closest('button')!,
    );
    await waitFor(() =>
      expect(projectPartyService.invite).toHaveBeenCalledTimes(2),
    );
  });

  it('maps a 403 to the forbidden error message', async () => {
    vi.mocked(projectPartyService.invite).mockRejectedValue(
      Object.assign(new Error('Forbidden'), {
        isAxiosError: true,
        response: { status: 403 },
      }),
    );
    renderDirectory();

    const dialog = await openConfirmDialog(`${K}.invite`);
    fireEvent.click(within(dialog).getByText(`${K}.confirmSendAction`));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(`${K}.inviteErrorForbidden`),
    );
  });

  it('maps a 404 (party missing / other org) to the not-found error message', async () => {
    vi.mocked(projectPartyService.invite).mockRejectedValue(
      Object.assign(new Error('Not found'), {
        isAxiosError: true,
        response: { status: 404 },
      }),
    );
    renderDirectory();

    const dialog = await openConfirmDialog(`${K}.invite`);
    fireEvent.click(within(dialog).getByText(`${K}.confirmSendAction`));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(`${K}.inviteErrorNotFound`),
    );
  });

  // ── RESEND — same confirmation + guard ──────────────────────────

  it('Resend (INVITED party) goes through the same confirmation with resend copy + link warning', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue([INVITED_PARTY]);
    renderDirectory();

    const dialog = await openConfirmDialog(`${K}.resendInvite`);

    expect(within(dialog).getByText(`${K}.confirmResendBody`)).toBeInTheDocument();
    // Honest copy: the backend regenerates the token — the old link dies.
    expect(within(dialog).getByText(`${K}.resendNote`)).toBeInTheDocument();
    expect(projectPartyService.invite).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByText(`${K}.confirmResendAction`));
    await waitFor(() =>
      expect(projectPartyService.invite).toHaveBeenCalledTimes(1),
    );
    expect(projectPartyService.invite).toHaveBeenCalledWith('party-invited');
  });

  // ── PERMISSION GATING — mirrors backend exact-match RolesGuard ──

  it('OWNER_CREATOR can invite (button enabled)', async () => {
    h.user = { id: 'u-1', role: UserRole.OWNER_CREATOR };
    renderDirectory();

    const btn = (await screen.findByText(`${K}.invite`)).closest('button')!;
    expect(btn).not.toBeDisabled();
  });

  it('SYSTEM_ADMIN is EXCLUDED (backend RolesGuard is exact-match, would 403) — button disabled with reason', async () => {
    h.user = { id: 'u-1', role: UserRole.SYSTEM_ADMIN };
    renderDirectory();

    const btn = (await screen.findByText(`${K}.invite`)).closest('button')!;
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', `${K}.inviteNoPermission`);
    fireEvent.click(btn);
    expect(projectPartyService.invite).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a non-privileged role (OWNER_REVIEWER) cannot invite; resend equally gated', async () => {
    h.user = { id: 'u-1', role: UserRole.OWNER_REVIEWER };
    vi.mocked(projectPartyService.getAll).mockResolvedValue([
      PENDING_PARTY,
      INVITED_PARTY,
    ]);
    renderDirectory();

    const send = (await screen.findByText(`${K}.invite`)).closest('button')!;
    const resend = screen.getByText(`${K}.resendInvite`).closest('button')!;
    expect(send).toBeDisabled();
    expect(resend).toBeDisabled();
    expect(resend).toHaveAttribute('title', `${K}.inviteNoPermission`);
  });

  it('no user in state → invite disabled (never fire a call that will 401/403)', async () => {
    h.user = null;
    renderDirectory();

    const btn = (await screen.findByText(`${K}.invite`)).closest('button')!;
    expect(btn).toBeDisabled();
  });

  // ── ACCEPTED party — no invite affordance at all ────────────────

  it('an ACCEPTED party shows neither Send nor Resend (re-inviting ACCEPTED is a backend data regression)', async () => {
    vi.mocked(projectPartyService.getAll).mockResolvedValue([
      mkParty({ id: 'party-accepted', name: 'Active Corp', invitation_status: 'ACCEPTED' }),
    ]);
    renderDirectory();

    await screen.findByText('Active Corp');
    expect(screen.queryByText(`${K}.invite`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${K}.resendInvite`)).not.toBeInTheDocument();
  });
});
