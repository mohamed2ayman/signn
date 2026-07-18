import { render } from '@testing-library/react';

import SharedByLine from '@/components/sharedWithMe/SharedByLine';
import en from '@/i18n/locales/en/common.json';

// Resolve keys against the REAL English locale file so these tests pin the
// exact shipped strings (the four shared-by cases are the load-bearing UI of
// this page — the API deliberately sends un-composed atoms, lesson #260).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const val = key
        .split('.')
        .reduce<unknown>(
          (acc, part) =>
            acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
          en,
        );
      return typeof val === 'string' ? val : key;
    },
  }),
}));

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function renderedText(org: string | null, user: string | null): string {
  const { container } = render(<SharedByLine org={org} user={user} />);
  // Collapse the JSX text nodes exactly as a reader sees them.
  return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('SharedByLine — the four shared-by cases (exact rendered strings)', () => {
  it('both atoms → "{org} · shared by {person}"', () => {
    expect(renderedText('Acme Construction', 'Sara Ahmed')).toBe(
      'Acme Construction · shared by Sara Ahmed',
    );
  });

  it('org only → "{org}" (no "shared by" fragment)', () => {
    const text = renderedText('Acme Construction', null);
    expect(text).toBe('Acme Construction');
    expect(text).not.toMatch(/shared by/i);
  });

  it('person only → "Shared by {person}"', () => {
    expect(renderedText(null, 'Sara Ahmed')).toBe('Shared by Sara Ahmed');
  });

  it('both null → the "Shared with you" fallback (never a blank line)', () => {
    expect(renderedText(null, null)).toBe('Shared with you');
  });
});

describe('SharedByLine — a degenerate atom never renders as blank/null/undefined/UUID', () => {
  const cases: Array<[string | null, string | null]> = [
    [null, null],
    ['', ''],
    ['   ', null],
    [null, '   '],
    ['   ', '   '],
    ['Acme Construction', '  '],
    ['  ', 'Sara Ahmed'],
  ];

  it.each(cases)('org=%j user=%j renders a real line', (org: string | null, user: string | null) => {
    const text = renderedText(org, user);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/\bnull\b/);
    expect(text).not.toMatch(/\bundefined\b/);
    expect(text).not.toMatch(UUID_RE);
  });

  it('whitespace-only org with a real person degrades to the person-only case', () => {
    expect(renderedText('   ', 'Sara Ahmed')).toBe('Shared by Sara Ahmed');
  });

  it('whitespace-only person with a real org degrades to the org-only case', () => {
    expect(renderedText('Acme Construction', '   ')).toBe('Acme Construction');
  });
});
