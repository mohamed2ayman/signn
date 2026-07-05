import {
  buildGuestCitations,
  normalizeSectionRef,
  parseSectionRefs,
  scrollToGuestClause,
} from './guestChatCitations';

describe('guestChatCitations — §ref parser', () => {
  it('parses §N refs in order, de-duplicated', () => {
    const text =
      'Payment is due per §14. See also §14 and the retention rules in §12.3.';
    expect(parseSectionRefs(text)).toEqual(['14', '12.3']);
  });

  it('parses Arabic-Indic digits and normalizes them to Latin', () => {
    expect(parseSectionRefs('راجع §١٤ من العقد')).toEqual(['14']);
  });

  it('parses Arabic clause-heading references (البند / المادة, with رقم and parens)', () => {
    expect(parseSectionRefs('كما ورد في البند رقم (3) والمادة ٧')).toEqual([
      '3',
      '7',
    ]);
  });

  it('normalizes sub-section separators (12/3, 12-3 → 12.3)', () => {
    expect(normalizeSectionRef('١٢/3')).toBe('12.3');
    expect(normalizeSectionRef('12-3')).toBe('12.3');
  });

  it('returns [] for garbage / no refs / empty input', () => {
    expect(parseSectionRefs('No citations here at all.')).toEqual([]);
    expect(parseSectionRefs('')).toEqual([]);
    expect(parseSectionRefs(null)).toEqual([]);
    expect(parseSectionRefs('§ paragraph sign without a number')).toEqual([]);
  });
});

describe('guestChatCitations — chip building (never invent)', () => {
  const CLAUSES = [
    { section_number: '14', title: 'Payment', content: 'x'.repeat(300) },
    { section_number: '3', title: 'التعريفات', content: 'short body' },
  ];

  it('builds chips only for refs that match a REAL clause section', () => {
    const chips = buildGuestCitations('See §14 and §99 and البند 3.', CLAUSES);
    expect(chips.map((c) => c.section)).toEqual(['14', '3']);
    expect(chips[0].title).toBe('Payment');
  });

  it('truncates the excerpt to ~200 chars and keeps short bodies intact', () => {
    const chips = buildGuestCitations('Per §14 and §3.', CLAUSES);
    expect(chips[0].excerpt).toHaveLength(201); // 200 + ellipsis
    expect(chips[1].excerpt).toBe('short body');
  });

  it('matches Arabic-Indic stored sections against Latin refs (normalized)', () => {
    const chips = buildGuestCitations('راجع §5', [
      { section_number: '٥', title: 'بند', content: 'نص' },
    ]);
    expect(chips.map((c) => c.section)).toEqual(['٥']); // anchor = stored form
  });

  it('returns [] when there are no clauses or no parseable refs', () => {
    expect(buildGuestCitations('See §14.', [])).toEqual([]);
    expect(buildGuestCitations('No refs.', CLAUSES)).toEqual([]);
  });
});

describe('guestChatCitations — scroll-and-highlight', () => {
  it('scrolls the matching clause anchor and pulses the highlight class', () => {
    const el = document.createElement('div');
    el.setAttribute('data-guest-clause-section', '14');
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);

    expect(scrollToGuestClause('14')).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
    expect(el.classList.contains('guest-clause-highlight')).toBe(true);
    el.remove();
  });

  it('is a safe no-op when the anchor is absent', () => {
    expect(scrollToGuestClause('nope')).toBe(false);
  });
});
