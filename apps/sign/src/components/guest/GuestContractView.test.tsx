import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import GuestContractView from '@/components/guest/GuestContractView';
import { downloadGuestContractPdf } from '@/services/api/guestService';
import type { Contract } from '@/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/services/api/guestService', () => ({
  downloadGuestContractPdf: vi.fn(),
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
