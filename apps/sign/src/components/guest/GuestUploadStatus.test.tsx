import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import GuestUploadStatus from '@/components/guest/GuestUploadStatus';
import { getGuestDocumentStatus } from '@/services/api/guestService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/services/api/guestService', () => ({
  getGuestDocumentStatus: vi.fn(),
}));

const PROPS = {
  contractId: 'c-1',
  guestJwt: 'guest-jwt',
  docId: 'd-1',
  fileName: 'revised.pdf',
};

const status = (over: Record<string, unknown>) => ({
  id: 'd-1',
  processing_status: 'EXTRACTING_TEXT',
  quality_flags: null,
  error_message: null,
  page_count: null,
  created_at: '2026-06-23T00:00:00.000Z',
  updated_at: '2026-06-23T00:00:00.000Z',
  ...over,
});

describe('GuestUploadStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('polls the guest status endpoint and shows "submitted for review" on completion', async () => {
    vi.mocked(getGuestDocumentStatus).mockResolvedValue(
      status({ processing_status: 'CLAUSES_EXTRACTED' }) as any,
    );
    render(<GuestUploadStatus {...PROPS} onReupload={vi.fn()} />);

    await waitFor(() =>
      expect(getGuestDocumentStatus).toHaveBeenCalledWith('c-1', 'guest-jwt', 'd-1'),
    );
    await waitFor(() =>
      expect(
        screen.getByText('guest.uploadStatus.submittedTitle'),
      ).toBeInTheDocument(),
    );
    // The guest is told it's SUBMITTED, never that clauses replaced the contract.
    expect(
      screen.queryByText('guest.uploadStatus.processingTitle'),
    ).not.toBeInTheDocument();
  });

  it('shows a failure message + a re-upload action when extraction FAILED', async () => {
    vi.mocked(getGuestDocumentStatus).mockResolvedValue(
      status({ processing_status: 'FAILED', error_message: null }) as any,
    );
    const onReupload = vi.fn();
    render(<GuestUploadStatus {...PROPS} onReupload={onReupload} />);

    await waitFor(() =>
      expect(
        screen.getByText('guest.uploadStatus.failedTitle'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('guest.uploadStatus.reupload'));
    expect(onReupload).toHaveBeenCalledTimes(1);
  });

  it('renders the in-progress surface while extraction is running', async () => {
    vi.mocked(getGuestDocumentStatus).mockResolvedValue(
      status({ processing_status: 'EXTRACTING_CLAUSES' }) as any,
    );
    render(<GuestUploadStatus {...PROPS} onReupload={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByText('guest.uploadStatus.processingTitle'),
      ).toBeInTheDocument(),
    );
  });
});
