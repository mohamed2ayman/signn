import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import ContractPartiesEditor from './ContractPartiesEditor';
import { partyService } from '@/services/api/partyService';
import type { Contract, ContractParty, PartyRole } from '@/types';

// Mutable holders read by the static vi.mock factories (hoisted-safe).
const h = vi.hoisted(() => ({
  user: { role: 'OWNER_ADMIN', organization_id: 'org-1' } as {
    role: string;
    organization_id: string | null;
  } | null,
  lang: 'en' as string,
}));

vi.mock('react-redux', () => ({
  useSelector: (sel: (s: any) => any) => sel({ auth: { user: h.user } }),
  useDispatch: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${Object.values(opts).join(',')}` : k,
    i18n: { language: h.lang, changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Service-level mock so axios.ts (imports the Redux store as a side effect)
// is never loaded (lesson #37).
vi.mock('@/services/api/partyService', () => ({
  partyService: {
    getRoles: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const ROLES: PartyRole[] = [
  { id: 'r1', code: 'EMPLOYER', label_en: 'Employer', label_ar: 'صاحب العمل', label_fr: "Maître d'ouvrage", applies_to: 'both', is_active: true, sort_order: 10, created_at: '' },
  { id: 'r2', code: 'CONTRACTOR', label_en: 'Contractor', label_ar: 'مقاول', label_fr: 'Entrepreneur', applies_to: 'both', is_active: true, sort_order: 20, created_at: '' },
];

const CONTRACT: Contract = {
  id: 'c-1',
  project_id: 'p-1',
  status: 'DRAFT',
} as unknown as Contract;

const svc = partyService as unknown as {
  getRoles: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

function renderEditor(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { role: 'OWNER_ADMIN', organization_id: 'org-1' };
  h.lang = 'en';
  svc.getRoles.mockResolvedValue(ROLES);
  svc.list.mockResolvedValue([]);
});

describe('ContractPartiesEditor', () => {
  it('renders the empty state with a wired "Add manually" and a DISABLED upload (item 3)', async () => {
    renderEditor(<ContractPartiesEditor contractId="c-1" contract={CONTRACT} />);
    expect(await screen.findByText('partiesEditor.empty.title')).toBeInTheDocument();

    const add = screen.getByRole('button', { name: 'partiesEditor.addManually' });
    expect(add).toBeEnabled();

    const upload = screen.getByRole('button', { name: /partiesEditor\.uploadDocument/ });
    expect(upload).toBeDisabled();
  });

  it('item 5: an empty added party shows required errors and blocks Save', async () => {
    renderEditor(<ContractPartiesEditor contractId="c-1" contract={CONTRACT} />);
    await screen.findByText('partiesEditor.empty.title');
    fireEvent.click(screen.getByRole('button', { name: 'partiesEditor.addManually' }));

    // Required-field errors render (mirrors backend 400s: role; org_name client-side).
    expect(await screen.findByText('partiesEditor.errors.orgNameRequired')).toBeInTheDocument();
    expect(screen.getByText('partiesEditor.errors.roleRequired')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'partiesEditor.save' });
    expect(save).toBeDisabled();
  });

  it('item 2: one signatory is valid — filling a signatory party enables Save (count never blocks)', async () => {
    renderEditor(<ContractPartiesEditor contractId="c-1" contract={CONTRACT} />);
    await screen.findByText('partiesEditor.empty.title');
    fireEvent.click(screen.getByRole('button', { name: 'partiesEditor.addManually' }));

    fireEvent.change(await screen.findByPlaceholderText('partiesEditor.fields.orgNamePlaceholder'), {
      target: { value: 'Acme Co' },
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'EMPLOYER' } });
    // Turn this party into the sole signatory — a valid 1-signatory contract.
    fireEvent.click(screen.getByRole('switch', { name: 'partiesEditor.fields.signs' }));

    // The signatory chip is present (display-only) and Save is enabled at 1 signatory.
    expect(screen.getByText(/partiesEditor\.signatoriesChip/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'partiesEditor.save' })).toBeEnabled(),
    );
  });

  it('item 1: AI-prefilled parties block Save until every role is confirmed', async () => {
    renderEditor(
      <ContractPartiesEditor
        contractId="c-1"
        contract={CONTRACT}
        prefilledParties={[{ role_code: 'EMPLOYER', org_name: 'Extracted Co', is_signatory: false }]}
      />,
    );
    // Pending-confirmation banner + Save blocked.
    expect(await screen.findByText('partiesEditor.confirm.roleNeedsConfirmation')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'partiesEditor.save' });
    expect(save).toBeDisabled();
    expect(screen.getByText(/partiesEditor\.confirm\.gate/)).toBeInTheDocument();

    // Confirm the role → Save enables.
    fireEvent.click(screen.getByRole('button', { name: 'partiesEditor.confirm.confirm' }));
    await waitFor(() => expect(save).toBeEnabled());
  });

  it('one-designated-signatory: two designated contacts surface the error and block Save', async () => {
    renderEditor(
      <ContractPartiesEditor
        contractId="c-1"
        contract={CONTRACT}
        prefilledParties={[
          {
            role_code: 'EMPLOYER',
            org_name: 'Sign Co',
            is_signatory: true,
            contacts: [
              { name: 'A', email: 'a@b.com', is_designated_signatory: true },
              { name: 'B', email: 'b@b.com', is_designated_signatory: true },
            ],
          },
        ]}
      />,
    );
    // Confirm the role so the confirm-gate is not the (only) blocker.
    fireEvent.click(await screen.findByRole('button', { name: 'partiesEditor.confirm.confirm' }));

    expect(await screen.findByText('partiesEditor.errors.multipleDesignated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'partiesEditor.save' })).toBeDisabled();
  });

  it('EDITOR floor: a viewer below EDITOR gets a read-only view (no edit controls)', async () => {
    h.user = { role: 'CONTRACTOR_USER', organization_id: 'org-1' };
    const party: ContractParty = {
      id: 'pt-1', contract_id: 'c-1', role_code: 'CONTRACTOR', org_name: 'البناء للمقاولات',
      is_signatory: false, organization_id: null, legal_tax_card: null, legal_address: null,
      contacts: [], created_at: '', updated_at: '',
    };
    svc.list.mockResolvedValue([party]);

    renderEditor(<ContractPartiesEditor contractId="c-1" contract={CONTRACT} />);

    // Read is visible…
    expect(await screen.findByText('البناء للمقاولات')).toBeInTheDocument();
    expect(screen.getByText('Contractor')).toBeInTheDocument(); // role label from registry
    // …but no edit controls.
    expect(screen.queryByRole('button', { name: 'partiesEditor.save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'partiesEditor.addParty' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('pinned (signed) contract is frozen — read-only with a frozen notice', async () => {
    const pinned = { ...CONTRACT, pinned_version_id: 'v-1' } as unknown as Contract;
    const party: ContractParty = {
      id: 'pt-2', contract_id: 'c-1', role_code: 'EMPLOYER', org_name: 'Frozen Co',
      is_signatory: false, organization_id: null, legal_tax_card: null, legal_address: null,
      contacts: [], created_at: '', updated_at: '',
    };
    svc.list.mockResolvedValue([party]);
    renderEditor(<ContractPartiesEditor contractId="c-1" contract={pinned} />);

    expect(await screen.findByText('partiesEditor.frozen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'partiesEditor.save' })).not.toBeInTheDocument();
  });

  it('RTL smoke: Arabic locale renders the editor container dir="rtl"', async () => {
    h.lang = 'ar';
    const { container } = renderEditor(
      <ContractPartiesEditor contractId="c-1" contract={CONTRACT} />,
    );
    await screen.findByText('partiesEditor.empty.title');
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
