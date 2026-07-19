import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import GuestContractView from '@/components/guest/GuestContractView';
import AcceptExecuteModal from '@/components/guest/AcceptExecuteModal';
import {
  acceptAndExecuteContract,
  getGuestSignSlip,
} from '@/services/api/guestSignService';
import type { Contract } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/services/api/guestService', () => ({
  downloadGuestContractPdf: vi.fn(),
  uploadGuestContractVersion: vi.fn(),
  getGuestDocumentStatus: vi.fn(),
}));
vi.mock('@/services/api/guestSignService', () => ({
  getGuestSignSlip: vi.fn(),
  acceptAndExecuteContract: vi.fn(),
}));
vi.mock('@/components/guest/GuestClauseCard', () => ({ default: () => null }));

const CONTRACT = {
  id: 'c-1',
  name: 'Test Contract',
  contract_type: 'FIDIC_RED_BOOK',
  status: 'ACTIVE',
  contract_clauses: [],
} as unknown as Contract;

const PENDING_SLIP = {
  slip_id: 's-1',
  status: 'PENDING' as const,
  granted_at: '2026-07-19T00:00:00.000Z',
  accepted_at: null,
  accepted_content_hash: null,
};

const EXECUTED_SLIP = {
  slip_id: 's-1',
  status: 'EXECUTED' as const,
  granted_at: '2026-07-19T00:00:00.000Z',
  accepted_at: '2026-07-19T01:00:00.000Z',
  accepted_content_hash: 'a'.repeat(64),
};

describe('GuestContractView — Accept & Execute affordance (Guest Signing v1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('⭐ never fetches the slip (and shows no affordance) without enableSignSlip — pure-guest path untouched', async () => {
    // guestJwt alone (an established token-guest has one) must NOT trigger a
    // slip fetch: the affordance is SHARED-VIEWER-ONLY in v1 — the prop, not
    // the token, is the gate (the #8d onImport precedent).
    render(<GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />);
    await waitFor(() => expect(screen.queryByTestId('guest-accept-execute')).not.toBeInTheDocument());
    expect(getGuestSignSlip).not.toHaveBeenCalled();
  });

  it('does not fetch without a token, even with enableSignSlip', async () => {
    render(<GuestContractView contract={CONTRACT} enableSignSlip />);
    await waitFor(() => expect(screen.queryByTestId('guest-accept-execute')).not.toBeInTheDocument());
    expect(getGuestSignSlip).not.toHaveBeenCalled();
  });

  it('shows NO affordance when the slip API answers the uniform 404 (null) — a bare binding never implies signing', async () => {
    vi.mocked(getGuestSignSlip).mockResolvedValue(null);
    render(
      <GuestContractView
        contract={CONTRACT}
        guestJwt="managing-token"
        enableSignSlip
      />,
    );
    await waitFor(() =>
      expect(getGuestSignSlip).toHaveBeenCalledWith('c-1', 'managing-token'),
    );
    expect(screen.queryByTestId('guest-accept-execute')).not.toBeInTheDocument();
    expect(screen.queryByText('guest.sign.panel.title')).not.toBeInTheDocument();
  });

  it('renders the Accept & Execute panel for an ACTIVE (PENDING) slip and opens the confirm modal', async () => {
    vi.mocked(getGuestSignSlip).mockResolvedValue(PENDING_SLIP);
    render(
      <GuestContractView
        contract={CONTRACT}
        guestJwt="managing-token"
        enableSignSlip
      />,
    );
    const btn = await screen.findByTestId('guest-accept-execute');
    expect(btn).toHaveTextContent('guest.sign.panel.button');

    // Nothing executes on the panel click — only the confirm modal opens.
    fireEvent.click(btn);
    expect(acceptAndExecuteContract).not.toHaveBeenCalled();
    expect(screen.getByTestId('sign-confirm')).toBeInTheDocument();
  });

  it('renders the executed receipt (hash included), with no CTA, for an EXECUTED slip', async () => {
    vi.mocked(getGuestSignSlip).mockResolvedValue(EXECUTED_SLIP);
    render(
      <GuestContractView
        contract={CONTRACT}
        guestJwt="managing-token"
        enableSignSlip
      />,
    );
    expect(
      await screen.findByText('guest.sign.executedPanel.title'),
    ).toBeInTheDocument();
    expect(screen.getByText('a'.repeat(64))).toBeInTheDocument();
    expect(screen.queryByTestId('guest-accept-execute')).not.toBeInTheDocument();
  });

  it('executes through the modal, flips to the receipt panel, and notifies the parent', async () => {
    vi.mocked(getGuestSignSlip).mockResolvedValue(PENDING_SLIP);
    vi.mocked(acceptAndExecuteContract).mockResolvedValue({
      ...EXECUTED_SLIP,
      executed: true,
      already_pinned: false,
    });
    const onExecuted = vi.fn();
    render(
      <GuestContractView
        contract={CONTRACT}
        guestJwt="managing-token"
        enableSignSlip
        onExecuted={onExecuted}
      />,
    );
    fireEvent.click(await screen.findByTestId('guest-accept-execute'));
    fireEvent.click(screen.getByTestId('sign-confirm'));

    await waitFor(() =>
      expect(acceptAndExecuteContract).toHaveBeenCalledWith(
        'c-1',
        'managing-token',
      ),
    );
    // The success state renders and the parent is told to refetch.
    expect(await screen.findByTestId('sign-success-close')).toBeInTheDocument();
    expect(onExecuted).toHaveBeenCalledTimes(1);
    // Closing the modal reveals the executed receipt panel.
    fireEvent.click(screen.getByTestId('sign-success-close'));
    expect(
      screen.getByText('guest.sign.executedPanel.title'),
    ).toBeInTheDocument();
  });
});

describe('AcceptExecuteModal — confirm safety (in-flight ref)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderModal = (onExecuted = vi.fn(), onClose = vi.fn()) => {
    render(
      <AcceptExecuteModal
        contractId="c-1"
        contractName="Test Contract"
        guestJwt="managing-token"
        onClose={onClose}
        onExecuted={onExecuted}
      />,
    );
    return { onExecuted, onClose };
  };

  it('⭐ a same-tick double-click produces exactly ONE POST (synchronous ref guard)', async () => {
    let resolveCall: (v: any) => void = () => {};
    vi.mocked(acceptAndExecuteContract).mockImplementation(
      () => new Promise((res) => (resolveCall = res)),
    );
    renderModal();
    const confirm = screen.getByTestId('sign-confirm');
    // Two clicks in the same tick — before React re-renders the disabled attr.
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(acceptAndExecuteContract).toHaveBeenCalledTimes(1);
    resolveCall({ ...EXECUTED_SLIP, executed: true, already_pinned: false });
    await screen.findByTestId('sign-success-close');
  });

  it('⭐ a deliberate retry after failure genuinely re-POSTs (the ref resets)', async () => {
    vi.mocked(acceptAndExecuteContract).mockRejectedValueOnce(
      new Error('boom'),
    );
    renderModal();
    fireEvent.click(screen.getByTestId('sign-confirm'));
    // Failure: generic no-leak error, modal stays open for a retry.
    expect(await screen.findByText('guest.sign.modal.error')).toBeInTheDocument();

    vi.mocked(acceptAndExecuteContract).mockResolvedValueOnce({
      ...EXECUTED_SLIP,
      executed: true,
      already_pinned: true,
    });
    fireEvent.click(screen.getByTestId('sign-confirm'));
    await screen.findByTestId('sign-success-close');
    expect(acceptAndExecuteContract).toHaveBeenCalledTimes(2);
  });

  it('close is inert while executing', async () => {
    let resolveCall: (v: any) => void = () => {};
    vi.mocked(acceptAndExecuteContract).mockImplementation(
      () => new Promise((res) => (resolveCall = res)),
    );
    const onClose = vi.fn();
    renderModal(vi.fn(), onClose);
    fireEvent.click(screen.getByTestId('sign-confirm'));
    // Mid-flight: cancel must not close.
    fireEvent.click(screen.getByText('guest.sign.modal.cancel'));
    expect(onClose).not.toHaveBeenCalled();
    resolveCall({ ...EXECUTED_SLIP, executed: true, already_pinned: false });
    await screen.findByTestId('sign-success-close');
  });
});
