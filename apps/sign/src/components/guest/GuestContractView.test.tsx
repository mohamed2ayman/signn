import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import GuestContractView from '@/components/guest/GuestContractView';
import {
  downloadGuestContractPdf,
  getGuestDocumentStatus,
  uploadGuestContractVersion,
} from '@/services/api/guestService';
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
// Isolate from the clause card (not under test here).
vi.mock('@/components/guest/GuestClauseCard', () => ({ default: () => null }));

const CONTRACT = {
  id: 'c-1',
  name: 'Test Contract',
  contract_type: 'FIDIC_RED_BOOK',
  status: 'ACTIVE',
  contract_clauses: [],
} as unknown as Contract;

describe('GuestContractView — guest watermarked download button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('does NOT render the download button for a passwordless viewer (no guestJwt)', () => {
    render(<GuestContractView contract={CONTRACT} />);
    expect(screen.queryByText('guest.contractView.download')).not.toBeInTheDocument();
  });

  it('renders the download button once identity is established (guestJwt present)', () => {
    render(<GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />);
    expect(screen.getByText('guest.contractView.download')).toBeInTheDocument();
  });

  it('calls downloadGuestContractPdf with the contract id and guest JWT on click', async () => {
    vi.mocked(downloadGuestContractPdf).mockResolvedValue(undefined);
    render(<GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />);

    fireEvent.click(screen.getByText('guest.contractView.download'));

    await waitFor(() =>
      expect(downloadGuestContractPdf).toHaveBeenCalledWith('c-1', 'guest-jwt'),
    );
  });

  it('shows a no-leak error message when the download fails', async () => {
    vi.mocked(downloadGuestContractPdf).mockRejectedValue(new Error('boom'));
    render(<GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />);

    fireEvent.click(screen.getByText('guest.contractView.download'));

    await waitFor(() =>
      expect(screen.getByText('guest.contractView.downloadError')).toBeInTheDocument(),
    );
  });
});

describe('GuestContractView — guest upload new version affordance (Feature #4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const fileInput = (container: HTMLElement) =>
    container.querySelector('input[type="file"]') as HTMLInputElement;

  it('does NOT render the upload button for a passwordless viewer (no guestJwt)', () => {
    render(<GuestContractView contract={CONTRACT} />);
    expect(screen.queryByText('guest.upload.button')).not.toBeInTheDocument();
  });

  it('renders the upload button once identity is established (guestJwt present)', () => {
    render(<GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />);
    expect(screen.getByText('guest.upload.button')).toBeInTheDocument();
  });

  it('uploads a valid file, then drives the live status surface to "submitted for review"', async () => {
    vi.mocked(uploadGuestContractVersion).mockResolvedValue({
      id: 'd-1',
      file_name: 'd-1.pdf',
      original_name: 'revised.pdf',
      processing_status: 'UPLOADED',
      created_at: '2026-06-23T00:00:00.000Z',
    });
    // The status poll resolves terminal-success → the surface shows the
    // "submitted for review" message (NOT the proposed clauses).
    vi.mocked(getGuestDocumentStatus).mockResolvedValue({
      id: 'd-1',
      processing_status: 'CLAUSES_EXTRACTED',
      quality_flags: null,
      error_message: null,
      page_count: 2,
      created_at: '2026-06-23T00:00:00.000Z',
      updated_at: '2026-06-23T00:00:05.000Z',
    });
    const { container } = render(
      <GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />,
    );
    const file = new File(['%PDF-1.4'], 'revised.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput(container), { target: { files: [file] } });

    await waitFor(() =>
      expect(uploadGuestContractVersion).toHaveBeenCalledWith('c-1', 'guest-jwt', file),
    );
    // The live status surface polls the guest status endpoint and lands on the
    // "submitted for review" terminal message.
    await waitFor(() =>
      expect(getGuestDocumentStatus).toHaveBeenCalledWith('c-1', 'guest-jwt', 'd-1'),
    );
    await waitFor(() =>
      expect(
        screen.getByText('guest.uploadStatus.submittedTitle'),
      ).toBeInTheDocument(),
    );
  });

  it('rejects a wrong-type file client-side without calling the API', async () => {
    const { container } = render(
      <GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />,
    );
    const bad = new File(['x'], 'evil.exe', { type: 'application/octet-stream' });
    fireEvent.change(fileInput(container), { target: { files: [bad] } });

    await waitFor(() =>
      expect(screen.getByText('guest.upload.errorType')).toBeInTheDocument(),
    );
    expect(uploadGuestContractVersion).not.toHaveBeenCalled();
  });

  it('shows the daily-limit message on a 429 GUEST_UPLOAD_DAILY_LIMIT response', async () => {
    vi.mocked(uploadGuestContractVersion).mockRejectedValue({
      response: { status: 429, data: { error: 'GUEST_UPLOAD_DAILY_LIMIT' } },
    });
    const { container } = render(
      <GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />,
    );
    const file = new File(['%PDF-1.4'], 'revised.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput(container), { target: { files: [file] } });

    await waitFor(() =>
      expect(screen.getByText('guest.upload.errorDailyLimit')).toBeInTheDocument(),
    );
  });

  it('REFRESH-RESUME — a persisted in-flight upload re-attaches the live status view on mount', async () => {
    // Simulate a prior upload persisted before a refresh.
    localStorage.setItem(
      'guest-upload-inflight:c-1',
      JSON.stringify({ id: 'd-resume', name: 'revised.pdf' }),
    );
    vi.mocked(getGuestDocumentStatus).mockResolvedValue({
      id: 'd-resume',
      processing_status: 'EXTRACTING_CLAUSES',
      quality_flags: null,
      error_message: null,
      page_count: null,
      created_at: '2026-06-27T00:00:00.000Z',
      updated_at: '2026-06-27T00:00:00.000Z',
    });

    render(<GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />);

    // On mount, with NO new upload, the status view resumes polling the
    // persisted doc — proving a refresh re-attaches progress.
    await waitFor(() =>
      expect(getGuestDocumentStatus).toHaveBeenCalledWith(
        'c-1',
        'guest-jwt',
        'd-resume',
      ),
    );
    expect(uploadGuestContractVersion).not.toHaveBeenCalled();
  });
});

describe('GuestContractView — Ask AI trigger (Feature #6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('does NOT render Ask AI for a passwordless viewer (no guestJwt), even with a handler', () => {
    render(<GuestContractView contract={CONTRACT} onAskAi={vi.fn()} />);
    expect(screen.queryByTestId('guest-ask-ai')).not.toBeInTheDocument();
  });

  it('does NOT render Ask AI when no handler is wired (panel absent)', () => {
    render(<GuestContractView contract={CONTRACT} guestJwt="guest-jwt" />);
    expect(screen.queryByTestId('guest-ask-ai')).not.toBeInTheDocument();
  });

  it('renders Ask AI first in the Path-B action row and fires the handler', () => {
    const onAskAi = vi.fn();
    render(
      <GuestContractView
        contract={CONTRACT}
        guestJwt="guest-jwt"
        onAskAi={onAskAi}
      />,
    );
    const trigger = screen.getByTestId('guest-ask-ai');
    expect(trigger).toHaveTextContent('guest.assistant.trigger');
    // Lead affordance: Ask AI precedes Upload + Download in the row.
    const row = trigger.parentElement as HTMLElement;
    expect(row.firstElementChild).toBe(trigger);
    fireEvent.click(trigger);
    expect(onAskAi).toHaveBeenCalledTimes(1);
  });
});
