import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import RelationshipTypeSelector from '@/components/contracts/RelationshipTypeSelector';
import { contractService } from '@/services/api/contractService';

/**
 * Multi-tier T0a.2 — RelationshipTypeSelector tests.
 *
 * The picker renders the registry grouped by domain_group, makes active types
 * selectable, and greys out inactive ("coming soon") types. i18n is mocked so
 * `t()` returns the key; type NAMES come from the registry labels (label_en
 * under the mocked 'en' locale).
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/services/api/contractService', () => ({
  contractService: { getRelationshipTypes: vi.fn() },
}));

const REGISTRY = [
  { code: 'MAIN', label_en: 'Main Contract', label_ar: 'عقد رئيسي', label_fr: 'Contrat principal', domain_group: 'delivery_chain', is_active: true, sort_order: 10 },
  { code: 'SUBCONTRACT', label_en: 'Sub-Contract', label_ar: 'عقد فرعي', label_fr: 'Sous-contrat', domain_group: 'delivery_chain', is_active: true, sort_order: 20 },
  { code: 'CONSULTANT', label_en: 'Consultant Appointment', label_ar: 'تعيين استشاري', label_fr: 'Nomination de consultant', domain_group: 'appointment', is_active: true, sort_order: 60 },
  { code: 'JOINT_VENTURE', label_en: 'Joint Venture', label_ar: 'مشروع مشترك', label_fr: 'Coentreprise', domain_group: 'party_agreement', is_active: false, sort_order: 80 },
];

function renderPicker(value: string | null, onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RelationshipTypeSelector value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe('RelationshipTypeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (contractService.getRelationshipTypes as ReturnType<typeof vi.fn>).mockResolvedValue(REGISTRY);
  });

  it('fetches with include_inactive so "coming soon" types render', async () => {
    renderPicker(null);
    await screen.findByText('Main Contract');
    expect(contractService.getRelationshipTypes).toHaveBeenCalledWith(true);
  });

  it('renders types grouped by domain_group with the active labels', async () => {
    renderPicker(null);
    // group headings (i18n keys under the mock)
    expect(await screen.findByText('relationshipType.group.delivery_chain')).toBeInTheDocument();
    expect(screen.getByText('relationshipType.group.appointment')).toBeInTheDocument();
    expect(screen.getByText('relationshipType.group.party_agreement')).toBeInTheDocument();
    // registry labels
    expect(screen.getByText('Main Contract')).toBeInTheDocument();
    expect(screen.getByText('Sub-Contract')).toBeInTheDocument();
    expect(screen.getByText('Consultant Appointment')).toBeInTheDocument();
    expect(screen.getByText('Joint Venture')).toBeInTheDocument();
  });

  it('selecting an active card notifies via onChange with the registry code', async () => {
    const { onChange } = renderPicker(null);
    const card = (await screen.findByText('Main Contract')).closest('button');
    fireEvent.click(card!);
    expect(onChange).toHaveBeenCalledWith('MAIN');
  });

  it('greys out inactive types: not a button, shows "coming soon", and is not selectable', async () => {
    const { onChange } = renderPicker(null);
    const jv = await screen.findByText('Joint Venture');
    // inactive is a plain (aria-disabled) div — never a <button>
    expect(jv.closest('button')).toBeNull();
    expect(screen.getByText('relationshipType.comingSoon')).toBeInTheDocument();
    fireEvent.click(jv);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks the selected type as pressed', async () => {
    renderPicker('MAIN');
    const card = (await screen.findByText('Main Contract')).closest('button');
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });
});
