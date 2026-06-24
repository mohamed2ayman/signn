import {
  containsArabic,
  prepareArabicText,
  arabicFontDescriptors,
  arabicVfs,
  arabicTextStyle,
  arabicHeadingText,
  wrapArabicLines,
  emitArabicParagraph,
  segmentToVisualRuns,
  tableCellWidthFallback,
  A4_PAGE_WIDTH_PT,
  EXPORT_BODY_WIDTH_PT,
  PORTFOLIO_BODY_WIDTH_PT,
} from './pdf-arabic';

/**
 * pdf-arabic helper — unit tests for Option A (pre-measure + pre-wrap).
 *
 * Two earlier cuts of this helper were obsoleted by this session's
 * empirical diagnosis (see helper banner for the full story):
 *   (1) reshape + bidi pipeline → caused isolated letters because
 *       presentation forms blocked Amiri's GSUB joining lookups.
 *   (2) `buildHeadingText` word-reversal hack → fixed heading-number
 *       position but produced inconsistent body multi-word ordering.
 * Both removed. This spec covers ONLY the Option A surface:
 *   - containsArabic / arabicTextStyle / VFS + font descriptors (unchanged)
 *   - prepareArabicText identity passthrough (kept for backward compat)
 *   - arabicHeadingText (digit-prefix shape, no reversal)
 *   - wrapArabicLines (the new measurement+packing primitive)
 *   - emitArabicParagraph (the call-site shape for the 3 generators)
 *   - Central width constants
 */

describe('pdf-arabic helper — Option A', () => {
  describe('containsArabic', () => {
    it('returns true for Arabic-block codepoints', () => {
      expect(containsArabic('عقد البناء')).toBe(true);
      expect(containsArabic('Article 3: عقد')).toBe(true);
    });

    it('returns true for presentation-form codepoints (FB50–FEFF)', () => {
      expect(containsArabic('ﻋﻘﺪ')).toBe(true);
    });

    it('returns false for pure-Latin and empty / nullish input', () => {
      expect(containsArabic('Hello world')).toBe(false);
      expect(containsArabic('')).toBe(false);
      expect(containsArabic(null)).toBe(false);
      expect(containsArabic(undefined)).toBe(false);
      expect(containsArabic(42 as unknown)).toBe(false);
      expect(containsArabic({} as unknown)).toBe(false);
    });
  });

  describe('prepareArabicText (identity passthrough — kept for compat)', () => {
    it('returns input unchanged', () => {
      expect(prepareArabicText('Article 3')).toBe('Article 3');
      expect(prepareArabicText('عقد البناء')).toBe('عقد البناء');
    });

    it('collapses null / undefined to ""', () => {
      expect(prepareArabicText(null)).toBe('');
      expect(prepareArabicText(undefined)).toBe('');
    });
  });

  describe('arabicTextStyle (for single-node emit; stacks set alignment per-line)', () => {
    it('applies alignment:right when text contains Arabic', () => {
      const s = arabicTextStyle('عقد البناء');
      expect(s.font).toBe('Amiri');
      expect(s.alignment).toBe('right');
    });

    it('omits alignment for Latin-only or empty input', () => {
      expect(arabicTextStyle('Hello').alignment).toBeUndefined();
      expect(arabicTextStyle('').alignment).toBeUndefined();
      expect(arabicTextStyle(null).alignment).toBeUndefined();
    });
  });

  describe('arabicFontDescriptors / arabicVfs', () => {
    it('descriptors point to the Amiri TTFs', () => {
      const fd = arabicFontDescriptors();
      expect(fd.Amiri.normal).toBe('Amiri-Regular.ttf');
      expect(fd.Amiri.bold).toBe('Amiri-Bold.ttf');
    });

    it('vfs adapter implements existsSync + readFileSync', () => {
      const vfs = arabicVfs();
      expect(vfs.existsSync('Amiri-Regular.ttf')).toBe(true);
      expect(vfs.existsSync('Amiri-Bold.ttf')).toBe(true);
      expect(vfs.existsSync('nope.ttf')).toBe(false);
      const reg = vfs.readFileSync('Amiri-Regular.ttf');
      expect(reg.length).toBeGreaterThan(100_000);
      expect(reg.readUInt32BE(0)).toBe(0x00010000); // TrueType magic
    });
  });

  describe('arabicHeadingText (digit-prefix shape, NO word reversal)', () => {
    it('Latin title: returns "N. title" verbatim', () => {
      expect(arabicHeadingText('3', 'Governing law')).toBe('3. Governing law');
      expect(arabicHeadingText(7, 'Termination')).toBe('7. Termination');
      expect(arabicHeadingText('1.1', 'Definitions')).toBe(
        '1.1. Definitions',
      );
    });

    it('Arabic title: converts digits to Arabic-Indic, NO reversal', () => {
      const out = arabicHeadingText('3', 'المحاسبة على الاعمال');
      expect(out).toBe('٣. المحاسبة على الاعمال');
      // CRITICAL regression guard: the title must NOT be word-reversed.
      // The earlier hack produced "الاعمال على المحاسبة ٣." — verify it's
      // truly gone (logical word order preserved).
      expect(out.indexOf('المحاسبة')).toBeLessThan(out.indexOf('الاعمال'));
    });

    it('Arabic title: converts multi-digit numbers fully', () => {
      expect(arabicHeadingText('12', 'البنود التكميلية')).toBe(
        '١٢. البنود التكميلية',
      );
      expect(arabicHeadingText('1.1', 'البنود')).toBe('١.١. البنود');
    });

    it('Edge cases: empty / null defensive collapses', () => {
      expect(arabicHeadingText(null, 'Foo')).toBe('Foo');
      expect(arabicHeadingText(undefined, 'Foo')).toBe('Foo');
      expect(arabicHeadingText('', 'Foo')).toBe('Foo');
      expect(arabicHeadingText('3', null)).toBe('');
      expect(arabicHeadingText('3', '')).toBe('');
      expect(arabicHeadingText(null, null)).toBe('');
    });
  });

  describe('wrapArabicLines (the measurement + packing primitive)', () => {
    it('Latin / empty input: returns single-line passthrough', () => {
      expect(wrapArabicLines('Hello world', 10, 500)).toEqual(['Hello world']);
      expect(wrapArabicLines('', 10, 500)).toEqual(['']);
      expect(wrapArabicLines(null, 10, 500)).toEqual(['']);
      expect(wrapArabicLines(undefined, 10, 500)).toEqual(['']);
    });

    it('Short Arabic that fits in one line: returns one line', () => {
      const out = wrapArabicLines('عقد البناء', 10, 500);
      expect(out.length).toBe(1);
      expect(out[0]).toBe('عقد البناء');
    });

    it('Long Arabic paragraph: wraps into multiple lines, words in LOGICAL order', () => {
      // Synthetic 30-word paragraph
      const word = 'الكلمة';
      const para = Array(30).fill(word).join(' ');
      const lines = wrapArabicLines(para, 10, 200);
      expect(lines.length).toBeGreaterThan(1);
      // Each emitted line must end with the last full word (no partial trailing token)
      for (const line of lines) {
        expect(line.endsWith(word)).toBe(true);
      }
      // Joined back together, the sequence of words is preserved (no word lost,
      // no word reordered). This is the CORE invariant: pre-wrap MUST NOT
      // change logical word order — fontkit's bidi handles visual at render.
      const recombined = lines.join(' ').replace(/\s+/g, ' ').trim();
      const original = para.replace(/\s+/g, ' ').trim();
      expect(recombined).toBe(original);
    });

    it('Multi-line wrap: every line fits within maxWidthPt (within safety margin)', () => {
      const para =
        'هذا نص تجريبي طويل يتكون من عدة كلمات للتحقق من أن كل سطر مولّد لا يتجاوز عرض العمود المسموح به في خطة التغليف.';
      const maxWidth = 150;
      const lines = wrapArabicLines(para, 10, maxWidth);
      expect(lines.length).toBeGreaterThan(1);
      // We don't assert exact widths here — the integration test does that
      // against the real PDF. Unit test asserts the wrap actually triggered.
    });

    it('Single super-long word (no break opportunity): emitted as one overflowing line (v1 acceptable)', () => {
      // A 60-char single Arabic "word" with no spaces — no break candidates
      // inside it. Helper accepts it as one line; render will overflow.
      const huge = 'ا'.repeat(60);
      const lines = wrapArabicLines(huge, 10, 50);
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe(huge);
    });

    it('Bold metrics differ from regular (sanity)', () => {
      // Same input, same maxWidth. Bold glyphs are wider → may wrap more.
      const para = 'هذا نص تجريبي للتحقق من اختلاف القياسات بين العادي والعريض.';
      const regularLines = wrapArabicLines(para, 10, 150, false);
      const boldLines = wrapArabicLines(para, 10, 150, true);
      // Both produce content; this doesn't have to be a strict inequality —
      // some text may pack identically in both fonts. The invariant is that
      // BOTH calls return non-empty line arrays without throwing.
      expect(regularLines.length).toBeGreaterThan(0);
      expect(boldLines.length).toBeGreaterThan(0);
    });
  });

  describe('emitArabicParagraph (the call-site shape)', () => {
    it('Latin content: returns single text node, no noWrap, no stack', () => {
      const node = emitArabicParagraph(
        'Article 3: governing law',
        10,
        500,
        false,
        { style: 'body', margin: [0, 4, 0, 0] },
      );
      expect(node.text).toBe('Article 3: governing law');
      expect(node.stack).toBeUndefined();
      expect(node.noWrap).toBeUndefined();
      expect(node.alignment).toBeUndefined();
      expect(node.style).toBe('body');
    });

    it('Empty input: emits an empty text node (caller can drop if needed)', () => {
      const node = emitArabicParagraph('', 10, 500, false);
      expect(node.text).toBe('');
      expect(node.stack).toBeUndefined();
    });

    it('Null input: same as empty', () => {
      const node = emitArabicParagraph(null, 10, 500, false);
      expect(node.text).toBe('');
    });

    it('Single-line Arabic: outer node carries alignment:right; text is per-run inline array with RTL run carrying noWrap+fontFeatures:[]', () => {
      const input = 'عقد البناء';
      const node = emitArabicParagraph(input, 10, 500, false, {
        style: 'body',
      });
      // Outer alignment + style preserved.
      expect(node.alignment).toBe('right');
      expect(node.style).toBe('body');
      expect(node.stack).toBeUndefined();
      // text is now an inlines array (per-run emission).
      expect(Array.isArray(node.text)).toBe(true);
      expect(node.text.length).toBeGreaterThan(0);
      // For pure-Arabic input there is exactly one RTL run; the run's
      // text carries the logical chars bracketed by the WHOLE-LINE
      // sentinels (ZWNJ U+200C prefix + ZWJ U+200D suffix) that trigger
      // /Span /ActualText emission at render time. The sentinels are
      // stripped before pdfkit's _fragment so they leave no visible
      // artifact, and they are zero-width per Amiri.
      const arabicRuns = node.text.filter((r: any) => r.noWrap === true);
      expect(arabicRuns.length).toBe(1);
      expect(arabicRuns[0].text).toBe('‌' + input + '‍');
      expect(arabicRuns[0].fontFeatures).toEqual([]);
    });

    it('Multi-line Arabic: returns a stack; each child is a per-run inline-array node with alignment:right', () => {
      const para = Array(20).fill('الكلمة').join(' ');
      const node = emitArabicParagraph(para, 10, 100, false, {
        style: 'body',
        margin: [0, 4, 0, 0],
      });
      expect(node.stack).toBeDefined();
      expect(Array.isArray(node.stack)).toBe(true);
      expect(node.stack.length).toBeGreaterThan(1);
      for (const child of node.stack) {
        expect(child.alignment).toBe('right');
        expect(Array.isArray(child.text)).toBe(true);
        // At least one RTL run per Arabic line.
        const rtl = child.text.filter((r: any) => r.noWrap === true);
        expect(rtl.length).toBeGreaterThanOrEqual(1);
        for (const r of rtl) {
          expect(r.fontFeatures).toEqual([]);
        }
      }
      // OUTER extras apply to the stack as a whole
      expect(node.style).toBe('body');
      expect(node.margin).toEqual([0, 4, 0, 0]);
    });

    it('Mixed Arabic + Latin in one line: routed through the Arabic path; text is multi-run', () => {
      const node = emitArabicParagraph('Article 3: عقد البناء', 10, 500, false);
      expect(node.alignment).toBe('right');
      expect(Array.isArray(node.text)).toBe(true);
      // Mixed content must produce more than one run.
      expect(node.text.length).toBeGreaterThanOrEqual(2);
      // At least one Arabic-path run (carries noWrap+fontFeatures:[]) and
      // at least one Arabic-path or plain run. Under the WHOLE-LINE
      // /ActualText design, all runs on Arabic-bearing lines are
      // emitted via the Arabic path so the sentinel can ride the FIRST
      // run's text and trigger markContent at render time.
      const arabicPath = node.text.filter((r: any) => r.noWrap === true);
      expect(arabicPath.length).toBeGreaterThanOrEqual(1);
    });

    it('Multi-line wrap: wrapArabicLines preserves logical word order (bidi happens AFTER, in emit)', () => {
      // The wrap helper itself must keep words in logical order — that's its
      // contract. bidi reorder happens in `emitArabicParagraph`, per emitted
      // line, AFTER the wrap decision. So the joined wrap output equals input.
      const para = 'الأول الثاني الثالث الرابع الخامس السادس السابع الثامن';
      const lines = wrapArabicLines(para, 10, 60, false);
      expect(lines.length).toBeGreaterThan(1);
      const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
      expect(joined).toBe(para);
    });

    it('Multi-line emit: each stack child preserves chars per logical line, plus the two whole-line sentinels (START + END)', () => {
      // Per-run emission keeps chars in LOGICAL order WITHIN each run; runs
      // themselves are ordered VISUALLY (UAX #9). For a pure-Arabic paragraph
      // there is exactly one RTL run per line. After the whole-line
      // /ActualText design lands, the FIRST inline of each line carries
      // a START sentinel (ZWNJ U+200C) prefix and the LAST inline carries
      // an END sentinel (ZWJ U+200D) suffix. Both are stripped from the
      // glyph stream by the monkey-patch — they only exist to trigger
      // markContent/endMarkedContent. Concatenated inlines on a line
      // therefore have logical chars PLUS exactly those two sentinels.
      const para = 'الأول الثاني الثالث الرابع الخامس السادس السابع الثامن';
      const node = emitArabicParagraph(para, 10, 60, false);
      const logicalLines = wrapArabicLines(para, 10, 60, false);
      expect(node.stack.length).toBe(logicalLines.length);
      for (let i = 0; i < node.stack.length; i++) {
        const inlines: any[] = node.stack[i].text;
        const concat = inlines.map((r) => r.text).join('');
        const logical = logicalLines[i];
        // Same chars, plus two sentinels (ZWNJ + ZWJ).
        expect(concat.length).toBe(logical.length + 2);
        // Concat stripped of the sentinels equals the logical line.
        expect(concat.replace(/[‌‍]/g, '')).toBe(logical);
      }
    });
  });

  describe('segmentToVisualRuns', () => {
    it('Empty input: returns empty array', () => {
      expect(segmentToVisualRuns('')).toEqual([]);
    });

    it('Latin-only: returns a single LTR run with original text', () => {
      const runs = segmentToVisualRuns('Article 3');
      expect(runs.length).toBe(1);
      expect(runs[0].isRtl).toBe(false);
      expect(runs[0].text).toBe('Article 3');
    });

    it('Pure Arabic: returns a single RTL run with chars in LOGICAL order', () => {
      const input = 'عقد البناء';
      const runs = segmentToVisualRuns(input);
      expect(runs.length).toBe(1);
      expect(runs[0].isRtl).toBe(true);
      // Within the run, chars stay in logical (input) order — fontkit will
      // shape + reverse them. The reordering is at the RUN level, not char level.
      expect(runs[0].text).toBe(input);
    });

    it('Mixed Arabic + Latin: produces multiple runs whose concatenation in LOGICAL order equals the input', () => {
      const input = 'Article 3: عقد';
      const runs = segmentToVisualRuns(input);
      expect(runs.length).toBeGreaterThanOrEqual(2);
      // At least one RTL and one non-RTL.
      expect(runs.some((r) => r.isRtl)).toBe(true);
      expect(runs.some((r) => !r.isRtl)).toBe(true);
      // Per-run chars are in LOGICAL order — char-set is preserved.
      const all = runs.map((r) => r.text).join('');
      expect(new Set([...all])).toEqual(new Set([...input]));
      expect(all.length).toBe(input.length);
    });

    it('Visual ordering: in mixed text starting with Arabic, the RTL run appears at the END of the visual run sequence (UAX #9)', () => {
      // Embedding base is 'rtl' (we pass 'rtl' to bidi). Latin in an RTL para
      // gets level 2; Arabic gets level 1. Level-2 runs are reordered before
      // level-1 runs in the visual sequence — so the Arabic (RTL) run ends up
      // LATER in the visual array than the Latin one for this input shape.
      const input = 'عقد Article';
      const runs = segmentToVisualRuns(input);
      const lastRtl = runs.findIndex((r) => r.isRtl);
      const lastLtr = runs.findIndex((r) => !r.isRtl);
      expect(lastRtl).toBeGreaterThan(lastLtr);
    });
  });

  describe('Width constants', () => {
    it('A4 page width is the pdfmake default', () => {
      expect(A4_PAGE_WIDTH_PT).toBe(595.28);
    });

    it('Export body width = A4 minus 40+40 pageMargins', () => {
      expect(EXPORT_BODY_WIDTH_PT).toBeCloseTo(515.28, 2);
    });

    it('Portfolio body width = A4 minus 50+50 pageMargins', () => {
      expect(PORTFOLIO_BODY_WIDTH_PT).toBeCloseTo(495.28, 2);
    });

    it('tableCellWidthFallback splits body width across columns minus safety padding', () => {
      // 4-column table on body width 515.28 → ~127pt per cell minus safety margin
      const cell = tableCellWidthFallback(EXPORT_BODY_WIDTH_PT, 4);
      expect(cell).toBeGreaterThan(100);
      expect(cell).toBeLessThan(140);
      // Defensive: zero columns shouldn't divide by zero
      const cellGuard = tableCellWidthFallback(500, 0);
      expect(Number.isFinite(cellGuard)).toBe(true);
    });
  });
});
