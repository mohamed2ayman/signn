import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import MarkActionedModal from '@/components/obligations/MarkActionedModal';
import complianceService from '@/services/api/complianceService';
import type { ContractObligation } from '@/services/api/complianceService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/services/api/complianceService', () => ({
  default: { updateObligation: vi.fn(), updateEvidence: vi.fn() },
}));

const OBL: ContractObligation = {
  id: 'ob-1',
  contract_id: 'c-1',
  project_id: 'p-1',
  compliance_check_id: null,
  contract_clause_id: null,
  description: 'Pay milestone invoice',
  responsible_party: 'EMPLOYER',
  obligation_type: 'PAYMENT',
  clause_ref: null,
  due_date: new Date().toISOString(),
  duration: null,
  timeframe_description: null,
  amount: null,
  currency: null,
  is_critical: false,
  status: 'PENDING',
  completed_at: null,
  evidence_url: null,
  created_at: new Date().toISOString(),
};

function renderModal(obligation: ContractObligation | null = OBL) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MarkActionedModal
        isOpen
        onClose={() => {}}
        obligation={obligation}
        contractId="c-1"
      />
    </QueryClientProvider>,
  );
}

describe('MarkActionedModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the protective evidence message and URL input', () => {
    renderModal();
    expect(screen.getByText('obligation.modal.markActioned.evidenceHeading')).toBeInTheDocument();
    expect(screen.getByText('obligation.modal.markActioned.evidenceMessage')).toBeInTheDocument();
    expect(screen.getByText('obligation.modal.markActioned.evidenceUrlLabel')).toBeInTheDocument();
  });

  it('defaults status to MET and allows submitting without evidence', async () => {
    vi.mocked(complianceService.updateObligation).mockResolvedValue({} as never);
    const { container } = renderModal();
    const form = container.querySelector('#mark-actioned-form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(complianceService.updateObligation).toHaveBeenCalledTimes(1),
    );
    expect(complianceService.updateObligation).toHaveBeenCalledWith(
      'c-1',
      'ob-1',
      expect.objectContaining({ status: 'MET' }),
    );
    // No evidence URL → updateEvidence not called.
    expect(complianceService.updateEvidence).not.toHaveBeenCalled();
  });

  it('calls updateEvidence first when an evidence URL is provided', async () => {
    vi.mocked(complianceService.updateEvidence).mockResolvedValue({} as never);
    vi.mocked(complianceService.updateObligation).mockResolvedValue({} as never);
    const { container } = renderModal();
    const urlInput = screen.getByPlaceholderText('https://...');
    fireEvent.change(urlInput, { target: { value: 'https://example.com/evidence.pdf' } });
    const form = container.querySelector('#mark-actioned-form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(complianceService.updateEvidence).toHaveBeenCalledWith(
        'c-1',
        'ob-1',
        'https://example.com/evidence.pdf',
      ),
    );
  });

  it('rejects an invalid evidence URL before submitting', async () => {
    const { container } = renderModal();
    const urlInput = screen.getByPlaceholderText('https://...');
    fireEvent.change(urlInput, { target: { value: 'not-a-url' } });
    const form = container.querySelector('#mark-actioned-form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(await screen.findByText('obligation.modal.markActioned.invalidUrl')).toBeInTheDocument();
    expect(complianceService.updateObligation).not.toHaveBeenCalled();
  });

  it('returns null when obligation prop is null', () => {
    const { container } = renderModal(null);
    expect(container.textContent).toBe('');
  });
});
