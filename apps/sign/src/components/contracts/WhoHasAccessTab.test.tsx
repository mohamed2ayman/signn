/**
 * #8c Part 4b — "Who has access" host tab.
 *
 * Service level mocked (lesson #37); t() returns the key. Pinned here:
 *  - active rows show a Revoke button; revoked rows show NONE (an
 *    "Access revoked" label instead) and stay in the list de-emphasized;
 *  - counts derive from the data (active + "· n revoked");
 *  - empty state when no guests; error state with a working Retry;
 *  - modal: confirm calls the revoke endpoint and flips the row to Revoked
 *    IN PLACE (button gone, label present, counts updated) without removing
 *    it; cancel closes with NO call;
 *  - lesson #238 both halves: a same-tick double-click on Confirm produces
 *    exactly ONE POST (acquire), and a retry after failure genuinely
 *    re-POSTs (release).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import WhoHasAccessTab from '@/components/contracts/WhoHasAccessTab';
import {
  listContractGuests,
  revokeGuestAccess,
  type HostGuestBindingRow,
} from '@/services/api/guestAccessService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/api/guestAccessService', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/api/guestAccessService')
  >('@/services/api/guestAccessService');
  return {
    ...actual,
    listContractGuests: vi.fn(),
    revokeGuestAccess: vi.fn(),
  };
});

const CONTRACT_ID = 'c0000000-0000-4000-8000-000000000001';

const ACTIVE_ROW: HostGuestBindingRow = {
  user_id: 'u0000000-0000-4000-8000-00000000000a',
  guest_email: 'khalid@northgate-partners.com',
  guest_name: 'Khalid Partner',
  guest_account_type: 'GUEST',
  granted_at: '2026-07-18T10:00:00.000Z',
  granted_by_name: 'Layla Al-Mansour',
  revoked_at: null,
  revoked_by_name: null,
};

const REVOKED_ROW: HostGuestBindingRow = {
  user_id: 'u0000000-0000-4000-8000-00000000000b',
  guest_email: 's.wright@vector-qs.co.uk',
  guest_name: 'Sam Wright',
  guest_account_type: 'GUEST',
  granted_at: '2026-06-21T10:00:00.000Z',
  granted_by_name: 'Layla Al-Mansour',
  revoked_at: '2026-07-09T10:00:00.000Z',
  revoked_by_name: 'Layla Al-Mansour',
};

function renderTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <WhoHasAccessTab contractId={CONTRACT_ID} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(listContractGuests).mockReset();
  vi.mocked(revokeGuestAccess).mockReset();
});

describe('WhoHasAccessTab — list rendering', () => {
  it('⭐ renders active + revoked rows: revoke button only on active, revoked label on revoked, counts correct', async () => {
    vi.mocked(listContractGuests).mockResolvedValue([ACTIVE_ROW, REVOKED_ROW]);
    renderTab();

    expect(
      await screen.findByText('khalid@northgate-partners.com'),
    ).toBeInTheDocument();
    expect(screen.getByText('s.wright@vector-qs.co.uk')).toBeInTheDocument();

    // Exactly ONE revoke button — the active row's.
    expect(screen.getAllByText('contract.guests.revoke')).toHaveLength(1);
    // The revoked row carries the muted revoked-on label instead.
    expect(screen.getByText(/contract\.guests\.revokedOn/)).toBeInTheDocument();

    // Counts: 1 active → the "one" key; 1 revoked → the revoked-count key.
    expect(screen.getByText(/contract\.guests\.guestCountOne/)).toBeInTheDocument();
    expect(screen.getByText(/contract\.guests\.revokedCount/)).toBeInTheDocument();

    // Pills: one Active, one Revoked.
    expect(screen.getByText('contract.guests.pillActive')).toBeInTheDocument();
    expect(screen.getByText('contract.guests.pillRevoked')).toBeInTheDocument();
  });

  it('revoked rows are de-emphasized (muted email) but present — they never vanish', async () => {
    vi.mocked(listContractGuests).mockResolvedValue([ACTIVE_ROW, REVOKED_ROW]);
    renderTab();

    const revokedEmail = await screen.findByText('s.wright@vector-qs.co.uk');
    expect(revokedEmail.className).toContain('text-gray-500');
    const activeEmail = screen.getByText('khalid@northgate-partners.com');
    expect(activeEmail.className).toContain('text-gray-900');
  });

  it('shows the empty state when the contract has no guests', async () => {
    vi.mocked(listContractGuests).mockResolvedValue([]);
    renderTab();

    expect(
      await screen.findByText('contract.guests.empty'),
    ).toBeInTheDocument();
    expect(screen.queryByText('contract.guests.revoke')).toBeNull();
  });

  it('shows the error state with a working Retry', async () => {
    vi.mocked(listContractGuests)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([ACTIVE_ROW]);
    renderTab();

    expect(await screen.findByText('contract.guests.error')).toBeInTheDocument();
    fireEvent.click(screen.getByText('contract.guests.retry'));
    expect(
      await screen.findByText('khalid@northgate-partners.com'),
    ).toBeInTheDocument();
    expect(vi.mocked(listContractGuests)).toHaveBeenCalledTimes(2);
  });
});

describe('WhoHasAccessTab — revoke flow', () => {
  it('⭐ confirm calls the endpoint and flips the row to Revoked IN PLACE + updates counts', async () => {
    // First load: active. The post-revoke invalidation refetch returns the
    // server truth: the SAME row, now revoked (it never vanishes).
    vi.mocked(listContractGuests)
      .mockResolvedValueOnce([ACTIVE_ROW])
      .mockResolvedValue([
        { ...ACTIVE_ROW, revoked_at: '2026-07-29T12:00:00.000Z' },
      ]);
    vi.mocked(revokeGuestAccess).mockResolvedValue({
      contract_id: CONTRACT_ID,
      user_id: ACTIVE_ROW.user_id,
      revoked_at: '2026-07-29T12:00:00.000Z',
      revoked_by: 'host-1',
      already_revoked: false,
    });
    renderTab();

    fireEvent.click(await screen.findByText('contract.guests.revoke'));
    expect(screen.getByText('contract.guests.modalTitle')).toBeInTheDocument();

    fireEvent.click(screen.getByText('contract.guests.modalConfirm'));

    await waitFor(() =>
      expect(vi.mocked(revokeGuestAccess)).toHaveBeenCalledWith(
        CONTRACT_ID,
        ACTIVE_ROW.user_id,
      ),
    );

    // The row FLIPS in place: still listed, button gone, revoked label +
    // revoked pill present, counts updated.
    await waitFor(() =>
      expect(screen.queryByText('contract.guests.revoke')).toBeNull(),
    );
    expect(
      screen.getByText('khalid@northgate-partners.com'),
    ).toBeInTheDocument();
    expect(screen.getByText(/contract\.guests\.revokedOn/)).toBeInTheDocument();
    expect(screen.getByText('contract.guests.pillRevoked')).toBeInTheDocument();
    expect(screen.getByText(/contract\.guests\.revokedCount/)).toBeInTheDocument();
  });

  it('cancel closes the modal with NO revoke call and no state change', async () => {
    vi.mocked(listContractGuests).mockResolvedValue([ACTIVE_ROW]);
    renderTab();

    fireEvent.click(await screen.findByText('contract.guests.revoke'));
    fireEvent.click(screen.getByText('contract.guests.modalCancel'));

    await waitFor(() =>
      expect(screen.queryByText('contract.guests.modalTitle')).toBeNull(),
    );
    expect(vi.mocked(revokeGuestAccess)).not.toHaveBeenCalled();
    expect(screen.getByText('contract.guests.pillActive')).toBeInTheDocument();
  });

  it('⭐ lesson #238 acquire: a same-tick double-click on Confirm sends exactly ONE POST', async () => {
    vi.mocked(listContractGuests).mockResolvedValue([ACTIVE_ROW]);
    // Never-resolving promise keeps the mutation in flight for the 2nd click.
    vi.mocked(revokeGuestAccess).mockImplementation(
      () => new Promise(() => undefined),
    );
    renderTab();

    fireEvent.click(await screen.findByText('contract.guests.revoke'));
    const confirm = screen.getByText('contract.guests.modalConfirm');
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(vi.mocked(revokeGuestAccess)).toHaveBeenCalledTimes(1),
    );
  });

  it('⭐ lesson #238 release: after a failure, a deliberate retry re-POSTs (and the error shows)', async () => {
    vi.mocked(listContractGuests)
      .mockResolvedValueOnce([ACTIVE_ROW])
      .mockResolvedValue([
        { ...ACTIVE_ROW, revoked_at: '2026-07-29T12:00:00.000Z' },
      ]);
    vi.mocked(revokeGuestAccess)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({
        contract_id: CONTRACT_ID,
        user_id: ACTIVE_ROW.user_id,
        revoked_at: '2026-07-29T12:00:00.000Z',
        revoked_by: 'host-1',
        already_revoked: false,
      });
    renderTab();

    fireEvent.click(await screen.findByText('contract.guests.revoke'));
    fireEvent.click(screen.getByText('contract.guests.modalConfirm'));

    // Failure surfaces inline; the modal stays open for a deliberate retry.
    expect(
      await screen.findByText('contract.guests.revokeFailed'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText('contract.guests.modalConfirm'));
    await waitFor(() =>
      expect(vi.mocked(revokeGuestAccess)).toHaveBeenCalledTimes(2),
    );
    // Second attempt succeeds → row flips.
    await waitFor(() =>
      expect(screen.queryByText('contract.guests.revoke')).toBeNull(),
    );
  });
});
