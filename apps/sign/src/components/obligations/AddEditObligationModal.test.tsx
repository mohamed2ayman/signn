import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import AddEditObligationModal from '@/components/obligations/AddEditObligationModal';
import { obligationService } from '@/services/api/obligationService';
import complianceService from '@/services/api/complianceService';
import type { ContractObligation } from '@/services/api/complianceService';

// ─────────────────────────────────────────────────────────────────
// Mocks — service-level (axios.ts side-effect-loads Redux store, #37)
// ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (opts && 'days' in opts) return `${k}:${opts.days}`;
      return k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/services/api/obligationService', () => ({
  obligationService: { create: vi.fn() },
}));
vi.mock('@/services/api/complianceService', () => ({
  default: { updateObligation: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const futureISO = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

const EDIT_OBL: ContractObligation = {
  id: 'ob-1',
  contract_id: 'c-1',
  project_id: 'p-1',
  compliance_check_id: null,
  contract_clause_id: 'cl-9',
  description: 'Provide insurance certificate',
  responsible_party: 'CONTRACTOR',
  obligation_type: 'INSURANCE',
  clause_ref: 'Clause 18.1',
  due_date: futureISO(40),
  duration: null,
  timeframe_description: null,
  amount: '500000',
  currency: 'USD',
  is_critical: true,
  status: 'PENDING',
  completed_at: null,
  evidence_url: null,
  created_at: new Date().toISOString(),
};

function renderModal(opts: { obligation?: ContractObligation | null; isOpen?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AddEditObligationModal
        isOpen={opts.isOpen ?? true}
        onClose={() => {}}
        contractId="c-1"
        obligation={opts.obligation ?? null}
      />
    </QueryClientProvider>,
  );
}

// ─────────────────────────────────────────────────────────────────

describe('AddEditObligationModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the Add title in create mode', () => {
    renderModal();
    expect(screen.getByText('obligation.modal.add.title')).toBeInTheDocument();
  });

  it('renders the Edit title and pre-fills the description in edit mode', () => {
    renderModal({ obligation: EDIT_OBL });
    expect(screen.getByText('obligation.modal.edit.title')).toBeInTheDocument();
    // Description textarea pre-filled
    const description = screen.getByDisplayValue('Provide insurance certificate');
    expect(description).toBeInTheDocument();
    expect(description).toHaveAttribute('dir', 'auto');
  });

  it('shows the Amount + Currency fields only for payment/bond/insurance types', () => {
    renderModal({ obligation: EDIT_OBL });
    // Edit fixture is INSURANCE — both fields visible
    expect(screen.getByDisplayValue('500000')).toBeInTheDocument();
    expect(screen.getByDisplayValue('USD')).toBeInTheDocument();
  });

  it('validates required Description before submitting (create mode)', async () => {
    const { container } = renderModal();
    const form = container.querySelector('#add-edit-obligation-form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(await screen.findByText('obligation.form.errors.descriptionRequired')).toBeInTheDocument();
    expect(obligationService.create).not.toHaveBeenCalled();
  });

  it('calls complianceService.updateObligation in edit mode submit', async () => {
    vi.mocked(complianceService.updateObligation).mockResolvedValue({} as never);
    const { container } = renderModal({ obligation: EDIT_OBL });
    // Submit the form directly — the footer button uses the form="..."
    // attribute which jsdom doesn't always propagate via click.
    const form = container.querySelector('#add-edit-obligation-form') as HTMLFormElement;
    fireEvent.submit(form);
    await waitFor(() =>
      expect(complianceService.updateObligation).toHaveBeenCalledTimes(1),
    );
    expect(complianceService.updateObligation).toHaveBeenCalledWith(
      'c-1',
      'ob-1',
      expect.objectContaining({ description: 'Provide insurance certificate' }),
    );
  });
});
