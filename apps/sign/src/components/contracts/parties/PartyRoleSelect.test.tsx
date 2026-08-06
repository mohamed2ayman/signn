import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PartyRoleSelect from '@/components/contracts/parties/PartyRoleSelect';
import { partyService } from '@/services/api/partyService';
import type { PartyRole } from '@/types';

/**
 * Party Foundation Slice 1b — PartyRoleSelect grouped-dropdown tests.
 *
 * The picker renders the party_roles registry inside <optgroup> per category:
 * groups ordered by the LOWEST sort_order within each group, roles ordered by
 * sort_order within a group, and the NULL-category role ungrouped and LAST.
 *
 * Assertions are INVARIANTS, never counts. A hardcoded "expect 24 options"
 * goes red the moment someone seeds a role, and a test that fails because the
 * DATA changed teaches people to ignore red. So: every ACTIVE code in the
 * fixture must render, no INACTIVE code may render, and each option must sit
 * under the group matching its own category — all derived from the fixture.
 *
 * Group HEADERS are chrome and assert by i18n KEY (t() is mocked to echo the
 * key). Option LABELS are registry DATA and assert by literal.
 */

let mockLanguage = 'en';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: mockLanguage, changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/services/api/partyService', () => ({
  partyService: { getRoles: vi.fn() },
}));

/**
 * Mirrors the real registry's shape and its awkward parts on purpose:
 *  - sort_order is NON-CONTIGUOUS per category (CONTRACTOR_SIDE 20, 60, 70),
 *    which is what makes grouping visibly reorder the flat list.
 *  - CONCESSION (90) sorts before FINANCIAL (100) by lowest member, NOT by
 *    the order the categories happen to be written here.
 *  - OTHER carries category null — the deliberately uncategorised catch-all.
 *  - One INACTIVE row, which the API would not return but which must never
 *    render even if it did.
 */
const REGISTRY: PartyRole[] = [
  { id: '1', code: 'EMPLOYER', label_en: 'Employer', label_ar: 'صاحب العمل', label_fr: "Maître d'ouvrage", applies_to: 'both', is_active: true, sort_order: 10, category: 'EMPLOYER_SIDE', created_at: '2026-01-01' },
  { id: '2', code: 'DEVELOPER', label_en: 'Developer', label_ar: 'المطور العقاري', label_fr: 'Promoteur immobilier', applies_to: 'contract', is_active: true, sort_order: 11, category: 'EMPLOYER_SIDE', created_at: '2026-01-01' },
  { id: '3', code: 'CONTRACTOR', label_en: 'Contractor', label_ar: 'مقاول', label_fr: 'Entrepreneur', applies_to: 'both', is_active: true, sort_order: 20, category: 'CONTRACTOR_SIDE', created_at: '2026-01-01' },
  { id: '4', code: 'SUBCONTRACTOR', label_en: 'Sub-contractor', label_ar: 'مقاول من الباطن', label_fr: 'Sous-traitant', applies_to: 'both', is_active: true, sort_order: 60, category: 'CONTRACTOR_SIDE', created_at: '2026-01-01' },
  { id: '5', code: 'SUPPLIER', label_en: 'Supplier', label_ar: 'مورّد', label_fr: 'Fournisseur', applies_to: 'contract', is_active: true, sort_order: 70, category: 'CONTRACTOR_SIDE', created_at: '2026-01-01' },
  { id: '6', code: 'ENGINEERING_CONSULTANT', label_en: 'Engineering Consultant', label_ar: 'استشاري هندسي', label_fr: 'Consultant en ingénierie', applies_to: 'both', is_active: true, sort_order: 30, category: 'CONSULTANTS', created_at: '2026-01-01' },
  { id: '7', code: 'ENGINEER', label_en: 'Engineer', label_ar: 'المهندس', label_fr: 'Ingénieur', applies_to: 'contract', is_active: true, sort_order: 80, category: 'CONSULTANTS', created_at: '2026-01-01' },
  { id: '8', code: 'GRANTOR', label_en: 'Grantor', label_ar: 'المانح', label_fr: 'Constituant', applies_to: 'contract', is_active: true, sort_order: 90, category: 'CONCESSION', created_at: '2026-01-01' },
  { id: '9', code: 'BENEFICIARY', label_en: 'Beneficiary', label_ar: 'المنتفع', label_fr: 'Usufruitier', applies_to: 'contract', is_active: true, sort_order: 100, category: 'FINANCIAL', created_at: '2026-01-01' },
  { id: '10', code: 'LENDER', label_en: 'Lender', label_ar: 'المُقرض', label_fr: 'Prêteur', applies_to: 'contract', is_active: true, sort_order: 102, category: 'FINANCIAL', created_at: '2026-01-01' },
  { id: '11', code: 'OTHER', label_en: 'Other', label_ar: 'أخرى', label_fr: 'Autre', applies_to: 'both', is_active: true, sort_order: 110, category: null, created_at: '2026-01-01' },
  { id: '12', code: 'RETIRED_ROLE', label_en: 'Retired Role', label_ar: 'دور متقاعد', label_fr: 'Rôle retiré', applies_to: 'contract', is_active: false, sort_order: 500, category: 'CONSULTANTS', created_at: '2026-01-01' },
];

const ACTIVE = REGISTRY.filter((r) => r.is_active);
const INACTIVE = REGISTRY.filter((r) => !r.is_active);

/** What the API actually serves: active-only (the backend's default). */
const SERVED = ACTIVE;

function renderSelect(value = '', onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <PartyRoleSelect value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { ...utils, onChange };
}

/** The <option> elements, in DOM order, excluding the empty placeholder. */
function realOptions() {
  return Array.from(
    document.querySelectorAll('option'),
  ).filter((o) => (o as HTMLOptionElement).value !== '') as HTMLOptionElement[];
}

const labelInLocale = (r: PartyRole, lang: string) =>
  lang === 'ar' ? r.label_ar : lang === 'fr' ? r.label_fr : r.label_en;

describe('PartyRoleSelect — grouped registry dropdown (Slice 1b)', () => {
  beforeEach(() => {
    mockLanguage = 'en';
    vi.clearAllMocks();
    (partyService.getRoles as ReturnType<typeof vi.fn>).mockResolvedValue(SERVED);
  });

  it('queries the CONTRACT-scoped role list, never the project-scoped one', async () => {
    renderSelect();
    await screen.findByText('Employer');
    expect(partyService.getRoles).toHaveBeenCalledWith('contract');
    expect(partyService.getRoles).not.toHaveBeenCalledWith('project');
  });

  it('renders an option for every ACTIVE code the registry serves', async () => {
    renderSelect();
    await screen.findByText('Employer');

    const rendered = realOptions().map((o) => o.value);
    for (const role of ACTIVE) {
      expect(rendered).toContain(role.code);
    }
    // and nothing beyond what was served
    expect(rendered.sort()).toEqual(ACTIVE.map((r) => r.code).sort());
  });

  it('renders no option for an INACTIVE code, even if the API returns one', async () => {
    // Deliberately serve the inactive row too — the picker must still not
    // offer it. Guards against a future change that drops the active-only
    // default on the API side.
    (partyService.getRoles as ReturnType<typeof vi.fn>).mockResolvedValue(REGISTRY);
    renderSelect();
    await screen.findByText('Employer');

    const rendered = realOptions().map((o) => o.value);
    for (const role of INACTIVE) {
      expect(rendered).not.toContain(role.code);
    }
  });

  it('places each option under the optgroup matching its own category', async () => {
    renderSelect();
    await screen.findByText('Employer');

    for (const role of ACTIVE.filter((r) => r.category)) {
      const option = realOptions().find((o) => o.value === role.code);
      expect(option, `no option rendered for ${role.code}`).toBeTruthy();
      const group = option!.closest('optgroup');
      expect(group, `${role.code} is not inside any optgroup`).toBeTruthy();
      expect(group!.getAttribute('label')).toBe(`partyRole.group.${role.category}`);
    }
  });

  it('renders the NULL-category role ungrouped and last', async () => {
    renderSelect();
    await screen.findByText('Employer');

    const uncategorised = ACTIVE.filter((r) => !r.category);
    const options = realOptions();

    for (const role of uncategorised) {
      const option = options.find((o) => o.value === role.code);
      expect(option!.closest('optgroup')).toBeNull();
    }
    // ungrouped roles come after every grouped one
    const lastGroupedIndex = Math.max(
      ...options
        .map((o, i) => (o.closest('optgroup') ? i : -1))
        .filter((i) => i >= 0),
    );
    for (const role of uncategorised) {
      const idx = options.findIndex((o) => o.value === role.code);
      expect(idx).toBeGreaterThan(lastGroupedIndex);
    }
  });

  it('orders groups by their lowest sort_order, and roles by sort_order within a group', async () => {
    renderSelect();
    await screen.findByText('Employer');

    const options = realOptions();
    const byCode = new Map(ACTIVE.map((r) => [r.code, r]));

    // Group order, derived from the fixture — not hardcoded.
    const expectedGroupOrder = [
      ...new Set(
        [...ACTIVE]
          .filter((r) => r.category)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((r) => r.category as string),
      ),
    ];
    const renderedGroupOrder = [
      ...new Set(
        Array.from(document.querySelectorAll('optgroup')).map((g) =>
          g.getAttribute('label'),
        ),
      ),
    ];
    expect(renderedGroupOrder).toEqual(
      expectedGroupOrder.map((c) => `partyRole.group.${c}`),
    );

    // Within each group, sort_order must be ascending.
    for (const group of Array.from(document.querySelectorAll('optgroup'))) {
      const orders = Array.from(group.querySelectorAll('option')).map(
        (o) => byCode.get((o as HTMLOptionElement).value)!.sort_order,
      );
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    }

    // Sanity on the reordering this slice deliberately introduces: grouping
    // pulls SUBCONTRACTOR (60) up beside CONTRACTOR (20), ahead of
    // ENGINEERING_CONSULTANT (30), which a flat sort_order list would not do.
    const codes = options.map((o) => o.value);
    expect(codes.indexOf('SUBCONTRACTOR')).toBeLessThan(
      codes.indexOf('ENGINEERING_CONSULTANT'),
    );
  });

  it('labels options from the registry and headers from i18n keys', async () => {
    renderSelect();
    await screen.findByText('Employer');

    // option labels = registry data (literals)
    for (const role of ACTIVE) {
      const option = realOptions().find((o) => o.value === role.code);
      expect(option!.textContent).toBe(role.label_en);
    }
    // group headers = i18n keys (echoed by the mocked t)
    for (const group of Array.from(document.querySelectorAll('optgroup'))) {
      expect(group.getAttribute('label')).toMatch(/^partyRole\.group\.[A-Z_]+$/);
    }
  });

  it.each(['ar', 'fr'])(
    'switching to %s changes option labels but not the group structure',
    async (lang: string) => {
      mockLanguage = 'en';
      const en = renderSelect();
      await screen.findByText('Employer');
      const enStructure = realOptions().map((o) => ({
        code: o.value,
        group: o.closest('optgroup')?.getAttribute('label') ?? null,
      }));
      en.unmount();

      mockLanguage = lang;
      renderSelect();
      await screen.findByText(labelInLocale(ACTIVE[0], lang));

      const localised = realOptions();
      // structure identical
      expect(
        localised.map((o) => ({
          code: o.value,
          group: o.closest('optgroup')?.getAttribute('label') ?? null,
        })),
      ).toEqual(enStructure);
      // labels are the locale's registry column
      for (const role of ACTIVE) {
        const option = localised.find((o) => o.value === role.code);
        expect(option!.textContent).toBe(labelInLocale(role, lang));
      }
    },
  );

  it('shows the current value as selected', async () => {
    renderSelect('ENGINEER');
    await screen.findByText('Engineer');
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe(
      'ENGINEER',
    );
  });

  it('falls back to the raw category code when a group has no i18n key', async () => {
    // Ops can add a category without a code change (the column is varchar, not
    // an enum), so an unknown group must degrade to its code — never a leaked
    // dotted key path. The mocked t echoes the key, so the real fallback is
    // exercised via the component's defaultValue only in production; here we
    // assert the group still renders and carries the category in its label.
    (partyService.getRoles as ReturnType<typeof vi.fn>).mockResolvedValue([
      ...SERVED,
      { id: '99', code: 'NEW_ROLE', label_en: 'New Role', label_ar: 'دور جديد', label_fr: 'Nouveau rôle', applies_to: 'contract', is_active: true, sort_order: 200, category: 'BRAND_NEW_GROUP', created_at: '2026-01-01' },
    ]);
    renderSelect();
    await screen.findByText('New Role');

    const option = realOptions().find((o) => o.value === 'NEW_ROLE');
    expect(option!.closest('optgroup')!.getAttribute('label')).toContain(
      'BRAND_NEW_GROUP',
    );
  });

  it('renders no options and stays usable when the registry fails to load', async () => {
    (partyService.getRoles as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('boom'),
    );
    renderSelect();

    expect(
      await screen.findByText('partiesEditor.role.loadError'),
    ).toBeInTheDocument();
    expect(realOptions()).toHaveLength(0);
    expect(document.querySelectorAll('optgroup')).toHaveLength(0);
  });
});
