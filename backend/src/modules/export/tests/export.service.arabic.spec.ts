import { ExportService } from '../export.service';

/**
 * Export PDF — Arabic rendering integration test (real pdfmake, no mock).
 *
 * The companion to export.service.pdfmake.spec.ts. That spec verified the
 * pdfmake 0.3.x wiring; this one verifies the Arabic helper (Amiri font
 * registration + shaping + bidi) actually plugs into createPdfBuffer
 * without throwing and produces a PDF that embeds Amiri.
 *
 * What this spec CAN prove:
 *   - createPdfBuffer renders an Arabic-bearing docDef without throwing
 *   - The resulting PDF buffer is structurally valid (%PDF magic + %%EOF tail)
 *   - The embedded font dictionary contains 'Amiri'
 *   - Mixed Arabic + Latin + digits content also renders without throwing
 *
 * What this spec CANNOT prove (visual properties, eyeball-required):
 *   - Contextual joining is correct (initial/medial/final form selection)
 *   - Right-to-left reading order on the page
 *   - Bidi reordering of mixed-direction runs
 * Those need a human looking at the exported PDF — out of scope for an
 * automated test.
 */

function makeService(): ExportService {
  // createPdfBuffer never touches the injected repos; trivial stubs suffice.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ExportService({} as any, {} as any, {} as any);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPdf(service: ExportService, docDef: any): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (service as any).createPdfBuffer(docDef);
}

describe('ExportService Arabic rendering (real pdfmake — no mock)', () => {
  it('renders a pure-Arabic docDef without throwing and embeds Amiri', async () => {
    const service = makeService();

    const docDef = {
      content: [
        { text: 'عقد البناء', style: 'title' },
        { text: 'هذا اتفاقية بين الطرف الأول والطرف الثاني.' },
      ],
      styles: { title: { fontSize: 18, bold: true } },
      defaultStyle: { font: 'Amiri' },
    };

    const buffer = await renderPdf(service, docDef);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.subarray(-16).toString('utf8')).toContain('%%EOF');
    // The Amiri font name must appear in the PDF's font dictionary. After
    // subsetting pdfmake writes the font's PostScript name (or its subset
    // tag prefix) into the /BaseFont and /FontName entries. Either way the
    // string 'Amiri' will appear in the raw byte stream.
    expect(buffer.toString('latin1')).toContain('Amiri');
    // Helvetica should NOT appear — we removed it from the printer config.
    expect(buffer.toString('latin1')).not.toContain('Helvetica');
  });

  it('renders mixed Arabic + Latin + digits without throwing', async () => {
    const service = makeService();

    const docDef = {
      content: [
        { text: 'Article 3: عقد البناء' },
        { text: 'Total amount: $1,250.00 (ألف ومائتان وخمسون دولار)' },
        {
          table: {
            widths: ['*', 'auto'],
            body: [
              [{ text: 'البند', bold: true }, { text: 'Severity', bold: true }],
              ['شروط الدفع', 'HIGH'],
              ['Liability cap', 'متوسط'],
            ],
          },
        },
      ],
      defaultStyle: { font: 'Amiri' },
    };

    const buffer = await renderPdf(service, docDef);

    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.subarray(-16).toString('utf8')).toContain('%%EOF');
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.toString('latin1')).toContain('Amiri');
  });

  it('renders a Latin-only docDef under the Amiri default (regression guard)', async () => {
    // Confirms Amiri's Latin glyph coverage is functional — pure-Latin contracts
    // (the majority of SIGN's user base) must still produce a valid PDF after
    // the font switch.
    const service = makeService();

    const docDef = {
      content: [
        { text: 'SIGN Platform Contract', style: 'title' },
        { text: 'This is a pure-Latin contract for the regression guard.' },
        { text: 'Article 1: governing law and jurisdiction.' },
      ],
      styles: { title: { fontSize: 18, bold: true } },
      defaultStyle: { font: 'Amiri' },
    };

    const buffer = await renderPdf(service, docDef);

    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.subarray(-16).toString('utf8')).toContain('%%EOF');
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.toString('latin1')).toContain('Amiri');
  });
});

// ─── Option A regression guards via real-PDF Tm+TJ extraction ──────────
//
// These tests assert the architectural property that distinguishes Option A
// from the previous broken cuts:
//
//   - Multi-line Arabic content emits ONE Tm+TJ block per visual line, NOT
//     one block per word. That's the ONLY architectural shape that lets
//     fontkit do paragraph-level UAX #9 bidi (without it, word order on the
//     page is logical-LTR — the original session-19 bug).
//
//   - Latin content stays as a single Tm+TJ block per text node (it goes
//     through pdfmake's normal tokenizer; we don't touch it).
//
// The same Tm+TJ extraction technique exposed the original bug — using it
// here is the regression guard.
//
// eslint-disable-next-line @typescript-eslint/no-require-imports
const zlib = require('zlib');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  emitArabicParagraph,
  arabicHeadingText,
  EXPORT_BODY_WIDTH_PT,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('../../../common/utils/pdf-arabic');

interface TjBlock {
  x: number;
  glyphCount: number;
}

function extractTjBlocks(pdfBuffer: Buffer): TjBlock[] {
  const blocks: TjBlock[] = [];
  const str = pdfBuffer.toString('latin1');
  let i = 0;
  while (true) {
    const s = str.indexOf('stream\n', i);
    if (s === -1) break;
    const e = str.indexOf('\nendstream', s);
    if (e === -1) break;
    try {
      const inflated = zlib
        .inflateSync(pdfBuffer.subarray(s + 7, e))
        .toString('latin1');
      // Match each "BT  1 0 0 1 X Y Tm  /F\d+ N Tf  [<hex>...]  TJ"
      const re =
        /BT\s+1 0 0 1 ([\d.]+) [\d.]+ Tm\s+\/F\d+ \d+ Tf\s+\[<([0-9a-fA-F]+)>[^\]]*\]\s+TJ/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(inflated)) !== null) {
        const hex = m[2];
        const glyphCount = Math.floor(hex.length / 4);
        blocks.push({ x: parseFloat(m[1]), glyphCount });
      }
    } catch (_e) {
      /* not deflate-encoded; skip */
    }
    i = e + 10;
  }
  return blocks;
}

describe('ExportService — Option A architectural regression guards', () => {
  it('Latin paragraph: emits the pdfmake-natural per-word Tm+TJ blocks (no Option-A path)', async () => {
    const service = makeService();
    const docDef = {
      content: [
        emitArabicParagraph(
          'Latin paragraph with several words for the regression guard',
          10,
          EXPORT_BODY_WIDTH_PT,
          false,
        ),
      ],
      defaultStyle: { font: 'Amiri' },
    };
    const buf = await renderPdf(service, docDef);
    const blocks = extractTjBlocks(buf);
    // Latin content goes through pdfmake's normal tokenizer → multiple blocks
    // (one per word). We don't care about the exact count — just that we
    // didn't accidentally route Latin through the Arabic noWrap-stack path.
    expect(blocks.length).toBeGreaterThan(1);
  });

  it('Short Arabic phrase: emits ONE Tm+TJ block (Option A noWrap path)', async () => {
    const service = makeService();
    const docDef = {
      content: [
        emitArabicParagraph(
          'عقد البناء والتشييد',
          10,
          EXPORT_BODY_WIDTH_PT,
          false,
        ),
      ],
      defaultStyle: { font: 'Amiri' },
    };
    const buf = await renderPdf(service, docDef);
    const blocks = extractTjBlocks(buf);
    // Single noWrap line → exactly 1 Tm+TJ block. The CRITICAL architectural
    // invariant: fontkit got the whole phrase as one paragraph, so UAX #9
    // bidi placed glyphs in correct visual RTL order within the block.
    expect(blocks.length).toBe(1);
  });

  it('Long Arabic paragraph: emits ONE BT block PER VISUAL LINE (not per word)', async () => {
    const service = makeService();
    // ~30-word Arabic paragraph; at body width it will wrap to several lines.
    const para = Array(30)
      .fill('هذا نص تجريبي للفقرة')
      .join(' ');
    const docDef = {
      content: [
        emitArabicParagraph(para, 10, EXPORT_BODY_WIDTH_PT, false),
      ],
      defaultStyle: { font: 'Amiri' },
    };
    const buf = await renderPdf(service, docDef);

    // With fontFeatures:[] activating fontkit's whole-string layout, pdfkit
    // emits each visual line as ONE BT...ET block — but inside that block
    // there may be MANY Tm+TJ pairs (one per kerning segment). Counting
    // unique Y coordinates is the right way to count visual lines.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const localZlib = require('zlib');
    const str = buf.toString('latin1');
    const yValues = new Set<number>();
    let i = 0;
    while (i < str.length) {
      const s = str.indexOf('stream\n', i);
      if (s === -1) break;
      const e = str.indexOf('\nendstream', s);
      if (e === -1) break;
      try {
        const inflated = localZlib
          .inflateSync(buf.subarray(s + 7, e))
          .toString('latin1');
        const tmRe = /1 0 0 1 [\d.-]+ ([\d.]+) Tm/g;
        let m: RegExpExecArray | null;
        while ((m = tmRe.exec(inflated)) !== null) {
          yValues.add(parseFloat(m[1]));
        }
      } catch (_e) {
        /* skip */
      }
      i = e + 10;
    }
    // 5 visual lines expected for the 30-phrase paragraph at body width.
    // Allow tolerance — anywhere between 2 and 10 lines proves multi-line
    // wrap is happening. The CRITICAL property (cross-line bidi correct)
    // is proven by the CMap test below, not by line count.
    expect(yValues.size).toBeGreaterThan(1);
    expect(yValues.size).toBeLessThan(20);
  });

  it('Arabic heading via arabicHeadingText: emits per-script-run BT blocks, total glyph count covers full heading', async () => {
    const service = makeService();
    const heading = arabicHeadingText('3', 'المحاسبة على الاعمال');
    expect(heading).toBe('٣. المحاسبة على الاعمال'); // no word reversal
    const docDef = {
      content: [
        emitArabicParagraph(heading, 12, EXPORT_BODY_WIDTH_PT, true, {
          style: 'clauseTitle',
        }),
      ],
      styles: { clauseTitle: { fontSize: 12, bold: true } },
      defaultStyle: { font: 'Amiri' },
    };
    const buf = await renderPdf(service, docDef);
    const blocks = extractTjBlocks(buf);
    // Under per-script-run inline emission, the heading splits at the bidi
    // boundary between the Arabic-Indic digit run (٣) and the Arabic-script
    // run (المحاسبة على الاعمال), producing AT LEAST 2 BT blocks. Each
    // RTL run carries noWrap+fontFeatures:[] so fontkit shapes the WHOLE
    // run as one (joining + direction). The total emitted glyph count must
    // still cover the full heading.
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const totalGlyphs = blocks.reduce((sum, b) => sum + b.glyphCount, 0);
    expect(totalGlyphs).toBeGreaterThan(10);
  });

  it('Arabic heading: ToUnicode CMap covers BOTH the Arabic-Indic digit (U+0663) AND the Arabic-script chars — proves both shaping paths ran end-to-end', async () => {
    // Under per-script-run inline emission, the heading "٣. ..." splits at
    // the digit↔Arabic bidi boundary into separate runs, each emitted as
    // its own BT/TJ block in UAX #9 visual order. Runs are concatenated
    // left-to-right by pdfmake; alignment:'right' pushes the whole
    // assembly to the right margin (visually that places the Arabic run
    // on the right under bidi resolution rules — see lifecycle comments).
    //
    // The architecturally meaningful assertion across the new shape is:
    // the rendered subset CMap covers BOTH (a) U+0663 (the digit ٣) AND
    // (b) the Arabic-script codepoints in the title. That proves fontkit
    // ran on BOTH runs and produced valid glyphs for each — i.e. neither
    // shaping path was silently dropped. (The position-correct joining
    // proof lives in the dedicated U+062A test above.)
    const service = makeService();
    const heading = arabicHeadingText('3', 'المحاسبة على الاعمال');
    expect(heading.codePointAt(0)).toBe(0x0663); // sanity: heading starts with ٣
    const docDef = {
      content: [
        emitArabicParagraph(heading, 12, EXPORT_BODY_WIDTH_PT, true, {
          style: 'clauseTitle',
        }),
      ],
      styles: { clauseTitle: { fontSize: 12, bold: true } },
      defaultStyle: { font: 'Amiri' },
    };
    const buf = await renderPdf(service, docDef);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const localZlib = require('zlib');
    const fullStr = buf.toString('latin1');

    // Walk every deflate-encoded stream. Extract: (a) the heading's TJ
    // glyph IDs, (b) the /ToUnicode CMap mappings.
    let headingGlyphIds: number[] | null = null;
    const cmap: Record<number, number> = {};
    let i = 0;
    while (i < fullStr.length) {
      const s = fullStr.indexOf('stream\n', i);
      if (s === -1) break;
      const e = fullStr.indexOf('\nendstream', s);
      if (e === -1) break;
      try {
        const inflated = localZlib
          .inflateSync(buf.subarray(s + 7, e))
          .toString('latin1');
        // (a) Text content stream — the heading's BT...TJ
        if (headingGlyphIds === null && inflated.indexOf(' TJ') !== -1) {
          const m =
            /BT\s+1 0 0 1 [\d.]+ [\d.]+ Tm\s+\/F\d+ \d+ Tf\s+\[<([0-9a-fA-F]+)>[^\]]*\]\s+TJ/.exec(
              inflated,
            );
          if (m) {
            const hex = m[1];
            const ids: number[] = [];
            for (let k = 0; k < hex.length; k += 4) {
              ids.push(parseInt(hex.substring(k, k + 4), 16));
            }
            headingGlyphIds = ids;
          }
        }
        // (b) /ToUnicode CMap — pdfkit emits `beginbfrange ... endbfrange`
        // with the format: `<startGid> <endGid> [<cp0> <cp1> ... <cpN>]`
        // where each cp_k maps to gid (startGid + k).
        if (inflated.indexOf('beginbfrange') !== -1) {
          const rangeBlocks =
            inflated.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
          for (const block of rangeBlocks) {
            const lineRe =
              /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/g;
            let lineMatch: RegExpExecArray | null;
            while ((lineMatch = lineRe.exec(block)) !== null) {
              const startGid = parseInt(lineMatch[1], 16);
              const cpHexes =
                lineMatch[3].match(/<([0-9a-fA-F]+)>/g) || [];
              for (let k = 0; k < cpHexes.length; k++) {
                const cpStr = cpHexes[k].replace(/[<>]/g, '');
                cmap[startGid + k] = parseInt(cpStr, 16);
              }
            }
          }
        }
      } catch (_e) {
        /* not a deflate-encoded stream */
      }
      i = e + 10;
    }

    expect(Object.keys(cmap).length).toBeGreaterThan(0);

    // Collect every codepoint covered by the CMap.
    const coveredCps = new Set<number>(Object.values(cmap));

    // (a) U+0663 (Arabic-Indic digit ٣) must be present — the digit run
    // produced a glyph that maps back to it.
    expect(coveredCps.has(0x0663)).toBe(true);

    // (b) Arabic-script chars from the title must be present — the Arabic
    // run produced glyphs that map back to (logical) Unicode codepoints.
    // Pick a few unambiguous letters from "المحاسبة على الاعمال":
    //   م U+0645, ح U+062D, س U+0633, ل U+0644
    // At least 3 of these must be in the CMap (proves the Arabic run was
    // shaped and emitted, not silently dropped).
    const arabicSamples = [0x0645, 0x062d, 0x0633, 0x0644];
    const covered = arabicSamples.filter((cp) => coveredCps.has(cp)).length;
    expect(covered).toBeGreaterThanOrEqual(3);
  });

  it('Mixed Arabic + Latin word + multi-digit number + brackets: all fragments render correctly (split-font proof)', async () => {
    // The user-reported regression class. A single line containing:
    //   - Arabic words (Amiri-shaped, RTL via fontkit)
    //   - A Latin word "Retention Money" (must read forward L→R)
    //   - A multi-digit number "2018" (digits forward L→R)
    //   - A short multi-digit number "30" (digits forward L→R)
    //   - Brackets + Arabic-Indic digits ٢٨١ (visual mirror, logical /ActualText)
    //
    // POST-FIX ARCHITECTURE (Acrobat-strict, 2026-06-24): Latin runs and
    // ASCII digit runs now route to Helvetica (PDF base-14 Type1,
    // /WinAnsiEncoding). They DO NOT appear in the Amiri /ToUnicode
    // CMap stream — they are emitted as PDF literal-string Tj ops with
    // direct WinAnsi bytes inside the Helvetica content stream. Arabic
    // letters + Arabic-Indic digits + the mirrored brackets stay in the
    // Amiri subset and DO appear in its CMap.
    //
    // This test therefore proves two channels:
    //   (1) The Helvetica content stream contains the Latin fragments as
    //       LITERAL byte sequences (no scrambling, no missing chars) —
    //       proves Latin renders forward in the rendered PDF.
    //   (2) The Amiri CMap walk contains the brackets (codepoints) and
    //       the three Arabic-Indic digits — proves the Arabic-bearing
    //       fragments still render with correct codepoints.
    const service = makeService();
    const input = 'البند رقم 30 (٢٨١) ينطبق على Retention Money 2018 فقط';
    const docDef = {
      content: [
        emitArabicParagraph(input, 10, EXPORT_BODY_WIDTH_PT, false, {
          style: 'body',
        }),
      ],
      styles: { body: { fontSize: 10 } },
      // Post-fix default: Helvetica for chrome; emitArabicParagraph
      // sets `font: 'Amiri'` on its Arabic-path inlines and
      // `font: 'Helvetica'` on its LTR/Latin inlines.
      defaultStyle: { font: 'Helvetica' },
    };
    const buf = await renderPdf(service, docDef);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const localZlib = require('zlib');
    const fullStr = buf.toString('latin1');
    const allGids: number[] = [];
    const cmap: Record<number, number> = {};
    // Decoded ENTIRE content-stream payloads concatenated — used to find
    // Helvetica-emitted Latin literal strings (Tj ops with PDF literal
    // `(...)` text). For Helvetica/Type1 with /WinAnsiEncoding the inner
    // bytes ARE the WinAnsi-encoded chars — ASCII letters appear verbatim.
    let allDecodedStreams = '';
    let i = 0;
    while (i < fullStr.length) {
      const s = fullStr.indexOf('stream\n', i);
      if (s === -1) break;
      const e = fullStr.indexOf('\nendstream', s);
      if (e === -1) break;
      try {
        const inflated = localZlib
          .inflateSync(buf.subarray(s + 7, e))
          .toString('latin1');
        if (inflated.indexOf(' TJ') !== -1 || inflated.indexOf(' Tj') !== -1) {
          allDecodedStreams += inflated;
        }
        // Capture Amiri CMap-walked gids (Arabic runs only — Latin via
        // Helvetica uses /WinAnsiEncoding, not a CMap, and so won't
        // contribute gids to allGids/cmap).
        if (inflated.indexOf(' TJ') !== -1) {
          const tjRe = /\[([^\]]+)\]\s+TJ/g;
          let tjM: RegExpExecArray | null;
          while ((tjM = tjRe.exec(inflated)) !== null) {
            const hexes = tjM[1].match(/<([0-9a-fA-F]+)>/g) || [];
            for (const hexTag of hexes) {
              const hex = hexTag.replace(/[<>]/g, '');
              for (let k = 0; k < hex.length; k += 4) {
                allGids.push(parseInt(hex.substring(k, k + 4), 16));
              }
            }
          }
        }
        if (inflated.indexOf('beginbfrange') !== -1) {
          const rangeBlocks =
            inflated.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
          for (const block of rangeBlocks) {
            const lineRe =
              /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/g;
            let lineMatch: RegExpExecArray | null;
            while ((lineMatch = lineRe.exec(block)) !== null) {
              const startGid = parseInt(lineMatch[1], 16);
              const cpHexes =
                lineMatch[3].match(/<([0-9a-fA-F]+)>/g) || [];
              for (let k = 0; k < cpHexes.length; k++) {
                cmap[startGid + k] = parseInt(
                  cpHexes[k].replace(/[<>]/g, ''),
                  16,
                );
              }
            }
          }
        }
      } catch (_e) {
        /* skip */
      }
      i = e + 10;
    }

    expect(allGids.length).toBeGreaterThan(0);
    expect(Object.keys(cmap).length).toBeGreaterThan(0);

    // ── (1) Helvetica content stream: Latin bytes forward ──
    // For /Type1 Helvetica with /WinAnsiEncoding, pdfkit emits text in
    // hex-encoded TJ form: `[<526574656e74696f6e20> 0] TJ`. The hex
    // bytes inside `<...>` ARE the WinAnsi-encoded char codes (1 byte
    // per char for ASCII), so for "Retention " we get
    // `52 65 74 65 6e 74 69 6f 6e 20` directly. To find "Retention
    // Money" forward we walk every TJ op while tracking the current
    // /Fn, and for ops emitted under the Helvetica font (identified
    // dynamically as the font whose ToUnicode CMap is empty / which has
    // no /ToUnicode reference — pdfkit's standard fonts don't get one),
    // we decode hex segments as latin1 byte strings. For Type0 Amiri
    // ops the hex bytes are 2-byte subset gids that don't decode as
    // text, so we naturally skip them by font filter.
    //
    // Simpler in practice: WinAnsi 1-byte hex bytes for ASCII letters
    // are in 0x20–0x7E. Glyph IDs from Amiri's 736-glyph subset have
    // some bytes outside that range. The strict test: under a /Fn that
    // resolves to a Type1 (Helvetica) font, decode hex as bytes.
    function decodeHelveticaTjBytes(payload: string): string {
      // Find the Helvetica font's /Fn label. The Type1 dict has
      // `/BaseFont /Helvetica /Subtype /Type1` and is referenced as
      // `/Fn M 0 R` in the Resources Font dict.
      // Easier shortcut: pdfkit assigns one /Fn per registered font and
      // each TJ op preceded by that /Fn Tf emits Helvetica WinAnsi
      // bytes. We scan tokens and decode hex blobs while the current
      // /Fn matches the Helvetica binding. Since the Type1 font dict
      // has no /ToUnicode reference and uses /Encoding /WinAnsiEncoding,
      // we identify Helvetica from the doc-level dict.
      // Identify Helvetica's /Fn from the full PDF text.
      const helveticaFn = ((): string | null => {
        // Find: `/Fn M 0 R` then look at object M's body — if it
        // contains `/BaseFont /Helvetica` and `/Subtype /Type1`, that's it.
        const fnMatches = [...fullStr.matchAll(/\/(F\d+) (\d+) 0 R/g)];
        for (const fnMatch of fnMatches) {
          const fName = fnMatch[1];
          const objNum = parseInt(fnMatch[2]);
          // Quick check: scan for "objNum 0 obj" body containing
          // /BaseFont /Helvetica + /Subtype /Type1.
          const objIdx = fullStr.indexOf(objNum + ' 0 obj');
          if (objIdx === -1) continue;
          const objEnd = fullStr.indexOf('endobj', objIdx);
          const body = fullStr.substring(objIdx, objEnd);
          if (
            body.includes('/BaseFont /Helvetica') &&
            body.includes('/Subtype /Type1')
          ) {
            return fName;
          }
        }
        return null;
      })();
      if (!helveticaFn) return '';
      // Walk the (concatenated) content stream payload, track current
      // /Fn, and when current is the Helvetica /Fn, decode hex blobs
      // inside `[...]TJ` ops as latin1 byte strings.
      let current = '?';
      const tokens =
        /\/(F\d+) [\d.]+ Tf|\[([^\]]+)\]\s+TJ|<([0-9a-fA-F]+)>\s+Tj/g;
      let out = '';
      let mm: RegExpExecArray | null;
      while ((mm = tokens.exec(payload)) !== null) {
        if (mm[1]) {
          current = mm[1];
        } else if (current === helveticaFn) {
          const hexBody = mm[2] || mm[3];
          if (!hexBody) continue;
          const hexes = mm[2]
            ? hexBody.match(/<([0-9a-fA-F]+)>/g) || []
            : [`<${hexBody}>`];
          for (const tag of hexes) {
            const hex = tag.replace(/[<>]/g, '');
            for (let k = 0; k + 1 < hex.length; k += 2) {
              out += String.fromCharCode(parseInt(hex.substring(k, k + 2), 16));
            }
          }
          // No separator: consecutive Helvetica TJ ops should
          // concatenate, since pdfkit's TextBreaker often splits a
          // logical word across kern-adjusted ops (e.g. "Money" emitted
          // as `<4d6f6e65> 20 <7920>` — "Mone" + kern + "y ").
        }
      }
      return out;
    }
    const helveticaText = decodeHelveticaTjBytes(allDecodedStreams);
    // Latin word "Retention Money" forward:
    expect(helveticaText).toContain('Retention Money');
    // Multi-digit ASCII "30" forward:
    expect(helveticaText).toContain('30');
    // Multi-digit ASCII "2018" forward:
    expect(helveticaText).toContain('2018');

    // ── (2) Amiri CMap walk: Arabic-bearing fragments ──
    const visualCps = allGids.map((g) => cmap[g] ?? 0);
    // Brackets are mirror-swapped in the Arabic run text, but BOTH paren
    // codepoints still appear in the Amiri CMap walk (the mirror swap
    // just exchanges WHICH gid maps to U+0028 vs U+0029):
    expect(visualCps).toContain(0x0028); // (
    expect(visualCps).toContain(0x0029); // )
    // The three Arabic-Indic digits in (٢٨١) ride in the Arabic run as
    // a non-RTL sub-run that still contains Arabic block chars — they
    // get the Amiri whole-string-shaping path:
    expect(visualCps).toContain(0x0662); // ٢
    expect(visualCps).toContain(0x0668); // ٨
    expect(visualCps).toContain(0x0661); // ١
  });

  // ──────────────────────────────────────────────────────────────────────
  // BRACKET MIRRORING — Option B (visual mirror + /ActualText for copy)
  // ──────────────────────────────────────────────────────────────────────
  // Three guards that together prove Option B end-to-end:
  //   (V) VISUAL: the GLYPH at the visually-leftmost paren position has the
  //       Arabic-correct concavity (concave-right, the Latin "(" shape) —
  //       proves the swap inside isRtl runs DID swap bracket codepoints
  //       before fontkit, so the rendered glyph has the right orientation
  //       for an Arabic reader (closer on the left side of the parenthetical).
  //   (C) COPY/PARSE: the PDF /Span /ActualText markers carry the ORIGINAL
  //       (unswapped) codepoints in their ORIGINAL logical order — proves any
  //       compliant PDF text extractor returns the source string, not the
  //       swapped one. This is the proof point that justifies Option B over A.
  //   (R) REGRESSION: an LTR-only Latin run is NOT swapped and NOT wrapped
  //       in /ActualText — the patch only fires for RTL-with-mirrorables.

  // Helper: walk every deflated content stream, collect /Span /ActualText
  // markers in document order. Each marker is the literal PDF string body —
  // (utf16be-or-ascii) — handed back decoded.
  function extractActualTextMarkers(buf: Buffer): string[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lz = require('zlib');
    const out: string[] = [];
    const full = buf.toString('latin1');
    let i = 0;
    while (i < full.length) {
      const s = full.indexOf('stream\n', i);
      if (s === -1) break;
      const e = full.indexOf('\nendstream', s);
      if (e === -1) break;
      try {
        const z = lz.inflateSync(buf.subarray(s + 7, e)).toString('latin1');
        // Find every  /Span <<\n/ActualText (<body>)\n>> BDC  occurrence.
        // The literal-string body uses PDF escapes ( \( \) \\ ) and may be
        // ASCII or UTF-16BE w/ leading 0xFE 0xFF BOM.
        const re = /\/ActualText\s*\(((?:\\.|[^\\)])*)\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(z)) !== null) out.push(m[1]);
      } catch (_e) {
        /* */
      }
      i = e + 10;
    }
    return out;
  }
  // Decode a PDF literal-string body (latin1 representation of bytes) to a
  // JS string of codepoints. Honors `\(` `\)` `\\` escapes and the
  // FEFF UTF-16BE BOM. Anything else is treated as 1 byte = 1 codepoint.
  function decodePdfLiteralString(body: string): string {
    // Step 1: unescape PDF literal escapes → byte string (latin1).
    let bytes = '';
    for (let k = 0; k < body.length; k++) {
      if (body[k] === '\\' && k + 1 < body.length) {
        const n = body[k + 1];
        if (n === '(' || n === ')' || n === '\\') {
          bytes += n;
          k++;
          continue;
        }
        // Other escapes (octal etc.) — pass the next char through
        bytes += n;
        k++;
        continue;
      }
      bytes += body[k];
    }
    // Step 2: detect BOM 0xFEFF → UTF-16BE.
    if (
      bytes.length >= 2 &&
      bytes.charCodeAt(0) === 0xfe &&
      bytes.charCodeAt(1) === 0xff
    ) {
      let r = '';
      for (let k = 2; k < bytes.length; k += 2) {
        const hi = bytes.charCodeAt(k);
        const lo = bytes.charCodeAt(k + 1);
        r += String.fromCodePoint((hi << 8) | lo);
      }
      return r;
    }
    return bytes;
  }

  // ──────────────────────────────────────────────────────────────────────
  // ARABIC TEXT-LAYER EXTRACTION — Option A extension of the /ActualText
  // mechanism to ALL isRtl runs (not just bracket-bearing ones).
  // ──────────────────────────────────────────────────────────────────────
  // The rendered visual is unchanged by this work (fontkit's GSUB +
  // reversal is the same), but every Arabic run now ships an /ActualText
  // override carrying its ORIGINAL LOGICAL text. A compliant extractor
  // (PDF 32000-1 §14.6) returns those values verbatim instead of the
  // CMap-walked visual-order codepoint sequence.
  //
  // The "/ActualText-honoring extractor" simulated by `extractLogicalText`
  // below is the simplest correct behavior: scan the content stream in
  // emission order; whenever a `/Span /ActualText (X) BDC ... EMC` block
  // appears, append X; for unwrapped text, append the CMap-walked TJ
  // glyphs. This is exactly what pdfminer / pdfjs-dist / pdf-lib do for
  // the /ActualText path, modulo PDF-object-string decoding nuances.

  function extractLogicalText(buf: Buffer): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lz = require('zlib');
    // Build CMap (single-codepoint per gid from beginbfrange/beginbfchar).
    const cmap: Record<number, number[]> = {};
    const streamPayloads: string[] = [];
    const full = buf.toString('latin1');
    let i = 0;
    while (i < full.length) {
      const a = full.indexOf('stream\n', i);
      if (a === -1) break;
      const e = full.indexOf('\nendstream', a);
      if (e === -1) break;
      try {
        const z = lz.inflateSync(buf.subarray(a + 7, e)).toString('latin1');
        streamPayloads.push(z);
        if (z.indexOf('beginbfrange') !== -1) {
          const rb = z.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
          for (const block of rb) {
            const lineRe =
              /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/g;
            let lm: RegExpExecArray | null;
            while ((lm = lineRe.exec(block)) !== null) {
              const startGid = parseInt(lm[1], 16);
              const cps = lm[3].match(/<([0-9a-fA-F]+)>/g) || [];
              for (let k = 0; k < cps.length; k++) {
                const raw = cps[k].replace(/[<>]/g, '');
                const arr: number[] = [];
                for (let p = 0; p < raw.length; p += 4) {
                  arr.push(parseInt(raw.substring(p, p + 4), 16));
                }
                cmap[startGid + k] = arr;
              }
            }
          }
        }
      } catch (_e) {
        /* */
      }
      i = e + 10;
    }
    // Find the text-bearing stream (first one containing TJ).
    let textStream = '';
    for (const z of streamPayloads) {
      if (z.indexOf(' TJ') !== -1) {
        textStream = z;
        break;
      }
    }
    if (!textStream) return '';
    // Walk the stream in order, emitting either /ActualText overrides
    // for marked-content spans, or CMap-walked TJ glyphs for unwrapped text.
    let out = '';
    // Token-walk: find every `/Span << /ActualText (X) >> BDC ... EMC`
    // OR `[...] TJ` outside such a span, in document order.
    const tokens: Array<
      | { kind: 'span'; actual: string; start: number; end: number }
      | { kind: 'tj'; hexParts: string[]; start: number; end: number }
    > = [];
    const spanRe =
      /\/Span\s*<<\s*\/ActualText\s*\(((?:\\.|[^\\)])*)\)\s*>>\s*BDC([\s\S]*?)EMC/g;
    let sm: RegExpExecArray | null;
    while ((sm = spanRe.exec(textStream)) !== null) {
      tokens.push({
        kind: 'span',
        actual: decodePdfLiteralString(sm[1]),
        start: sm.index,
        end: sm.index + sm[0].length,
      });
    }
    const tjRe = /\[([^\]]+)\]\s+TJ/g;
    let tm: RegExpExecArray | null;
    while ((tm = tjRe.exec(textStream)) !== null) {
      const insideSpan = tokens.some(
        (t) => t.kind === 'span' && tm!.index >= t.start && tm!.index < t.end,
      );
      if (insideSpan) continue;
      const hexes = (tm[1].match(/<([0-9a-fA-F]+)>/g) || []).map((h) =>
        h.replace(/[<>]/g, ''),
      );
      tokens.push({
        kind: 'tj',
        hexParts: hexes,
        start: tm.index,
        end: tm.index + tm[0].length,
      });
    }
    tokens.sort((a, b) => a.start - b.start);
    for (const t of tokens) {
      if (t.kind === 'span') {
        out += t.actual;
      } else {
        for (const hex of t.hexParts) {
          for (let p = 0; p < hex.length; p += 4) {
            const gid = parseInt(hex.substring(p, p + 4), 16);
            const cps = cmap[gid];
            if (cps) {
              for (const cp of cps) out += String.fromCodePoint(cp);
            }
          }
        }
      }
    }
    return out;
  }

  function containsAnyPresentationForm(s: string): boolean {
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      // Arabic Presentation Forms-A: U+FB50–U+FDFF
      // Arabic Presentation Forms-B: U+FE70–U+FEFF
      if (cp >= 0xfb50 && cp <= 0xfdff) return true;
      if (cp >= 0xfe70 && cp <= 0xfeff) return true;
    }
    return false;
  }

  function containsAnyBidiControl(s: string): boolean {
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp === 0x200c || cp === 0x200d) return true; // ZWNJ, ZWJ
      if (cp === 0x200e || cp === 0x200f) return true; // LRM, RLM
      if (cp === 0x061c) return true; // ALM
      if (cp >= 0x202a && cp <= 0x202e) return true; // embedding marks
      if (cp >= 0x2066 && cp <= 0x2069) return true; // isolates
    }
    return false;
  }

  // ──────────────────────────────────────────────────────────────────────
  // WHOLE-LINE /ActualText — structural proof
  // ──────────────────────────────────────────────────────────────────────
  //
  // CONTEXT ON THE TEST APPROACH (READ THIS FIRST):
  // After installing pdfjs-dist as a devDep to validate copy semantics, we
  // discovered pdfjs does NOT honor /ActualText (confirmed across v3, v4,
  // v5 — zero references to "ActualText" in any published build). The
  // same is true for poppler's pdftotext, MuPDF's mutool, and pdfminer.six
  // — empirically tested in this container. pdfjs-dist was removed.
  //
  // The PDF spec (32000-1 §14.6) DOES require compliant text extractors to
  // honor /ActualText. The readers that actually do (and which the user's
  // copy/paste flow uses): Adobe Acrobat, Microsoft Word's PDF importer,
  // and other commercial / spec-compliant readers. Most open-source
  // extractors focus on visual layout and skip the /ActualText override.
  //
  // The proof we CAN give automatically is structural: every Arabic line
  // emits exactly ONE /Span << /ActualText (...) >> BDC ... EMC pair, the
  // /ActualText value equals the full logical line text in logical order,
  // and every visible TJ op of the line sits between BDC and EMC. A
  // spec-compliant reader sees that span and returns the /ActualText
  // value verbatim, replacing the underlying glyph stream — that's the
  // mechanism Word/Acrobat use for copy. The user verifies behavior in
  // their actual reader; this test verifies the PDF carries the right
  // signal.

  function extractActualTextValues(buf: Buffer): string[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lz = require('zlib');
    const out: string[] = [];
    const full = buf.toString('latin1');
    let i = 0;
    while (i < full.length) {
      const a = full.indexOf('stream\n', i);
      if (a === -1) break;
      const e = full.indexOf('\nendstream', a);
      if (e === -1) break;
      try {
        const z = lz.inflateSync(buf.subarray(a + 7, e)).toString('latin1');
        const re =
          /\/Span\s*<<\s*\/ActualText\s*\(((?:\\.|[^\\)])*)\)\s*>>\s*BDC/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(z)) !== null) {
          out.push(decodePdfLiteralString(m[1]));
        }
      } catch (_e) {
        /* */
      }
      i = e + 10;
    }
    return out;
  }

  function countMarkers(buf: Buffer): { bdc: number; emc: number } {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lz = require('zlib');
    let bdc = 0;
    let emc = 0;
    const full = buf.toString('latin1');
    let i = 0;
    while (i < full.length) {
      const a = full.indexOf('stream\n', i);
      if (a === -1) break;
      const e = full.indexOf('\nendstream', a);
      if (e === -1) break;
      try {
        const z = lz.inflateSync(buf.subarray(a + 7, e)).toString('latin1');
        const bdcRe = /\/Span[\s\S]*?BDC/g;
        const emcRe = /\bEMC\b/g;
        let m: RegExpExecArray | null;
        while ((m = bdcRe.exec(z)) !== null) bdc++;
        while ((m = emcRe.exec(z)) !== null) emc++;
      } catch (_e) {
        /* */
      }
      i = e + 10;
    }
    return { bdc, emc };
  }

  it('WHOLE-LINE /ActualText: mixed Arabic + Latin + digits + brackets — emits ONE marker with the full logical line, covering all TJ ops', async () => {
    // The user-reported failing case. After the whole-line redesign the
    // mixed line emits ONE /Span /ActualText that wraps the entire line's
    // TJ ops. The marker's text MUST equal the original logical input
    // (the same string a spec-compliant reader will return on copy).
    const service = makeService();
    const input =
      'البند رقم 30 (٢٨١) ينطبق على Retention Money 2018 فقط';
    const buf = await renderPdf(service, {
      content: [emitArabicParagraph(input, 12, EXPORT_BODY_WIDTH_PT, false)],
      defaultStyle: { font: 'Amiri' },
    });

    const markers = extractActualTextValues(buf);
    // eslint-disable-next-line no-console
    console.log('[mixed /ActualText markers]:', JSON.stringify(markers));
    // eslint-disable-next-line no-console
    console.log('[LOGICAL INPUT            ]:', JSON.stringify(input));
    expect(markers).toHaveLength(1);
    expect(markers[0]).toBe(input);
    // Every BDC paired with an EMC — proves the wrap brackets the full
    // line emission and does not leak the marked-content state.
    const counts = countMarkers(buf);
    expect(counts.bdc).toBe(counts.emc);
    // Defensive guards stay.
    expect(containsAnyPresentationForm(markers[0])).toBe(false);
    expect(containsAnyBidiControl(markers[0])).toBe(false);
  });

  it('WHOLE-LINE /ActualText: pure Arabic line — one marker carrying the full logical line', async () => {
    const service = makeService();
    const input = 'العرض الفني والمالي المقدم';
    const buf = await renderPdf(service, {
      content: [emitArabicParagraph(input, 12, EXPORT_BODY_WIDTH_PT, false)],
      defaultStyle: { font: 'Amiri' },
    });
    const markers = extractActualTextValues(buf);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toBe(input);
    expect(containsAnyPresentationForm(markers[0])).toBe(false);
    expect(containsAnyBidiControl(markers[0])).toBe(false);
  });

  it('WHOLE-LINE /ActualText: multi-line wrapped Arabic — one marker per emitted line, every input word recoverable from the union', async () => {
    const service = makeService();
    const para = Array(15)
      .fill('هذا نص تجريبي للفقرة الطويلة')
      .join(' ');
    const buf = await renderPdf(service, {
      content: [emitArabicParagraph(para, 12, 200, false)],
      defaultStyle: { font: 'Amiri' },
    });
    const markers = extractActualTextValues(buf);
    expect(markers.length).toBeGreaterThan(1); // wrap produced multiple lines
    // Each marker is a logical-order slice of the paragraph.
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    const normPara = normalize(para);
    for (const m of markers) {
      // Each marker text must appear (as a substring) inside the original
      // logical input — proves no marker is reverse-ordered or scrambled.
      const norm = normalize(m);
      expect(normPara.includes(norm)).toBe(true);
      expect(containsAnyPresentationForm(m)).toBe(false);
      expect(containsAnyBidiControl(m)).toBe(false);
    }
    // Every input word must appear in at least one marker.
    const markerUnion = markers.map(normalize).join(' ');
    for (const w of new Set(normPara.split(' '))) {
      expect(markerUnion).toContain(w);
    }
  });

  it('WHOLE-LINE /ActualText: English-only doc — ZERO markers (no wrap needed for LTR-only content)', async () => {
    const service = makeService();
    const input = 'Pure Latin contract — Article 1: governing law.';
    const buf = await renderPdf(service, {
      content: [{ text: input }],
      defaultStyle: { font: 'Amiri' },
    });
    const markers = extractActualTextValues(buf);
    expect(markers).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // STRUCTURAL VALIDITY — multi-clause Arabic doc + balanced marked content
  // ──────────────────────────────────────────────────────────────────────
  //
  // HONEST SCOPE: this test guards STRUCTURAL invariants on the rendered
  // PDF — operator balance per content stream, no page-boundary crossing,
  // /ActualText payload well-formedness. It does NOT and CANNOT catch
  // every Acrobat-specific crash class: Adobe Reader rejects some
  // spec-valid documents on the basis of tag semantics that no
  // open-source validator (qpdf / pdfcpu / mutool) flags. Real
  // Acrobat-compatibility verification remains a HUMAN eyeball step on
  // every Arabic PDF release. This test is the regression guard against
  // FUTURE marked-content code changes accidentally breaking the
  // invariants the current code already satisfies (unbalanced BDC/EMC,
  // /ActualText spanning a page boundary, malformed UTF-16BE payload,
  // q/Q or BT/ET leaks).

  function unzlibAllStreams(buf: Buffer): string[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lz = require('zlib');
    const out: string[] = [];
    const full = buf.toString('latin1');
    let i = 0;
    while (i < full.length) {
      const a = full.indexOf('stream\n', i);
      if (a === -1) break;
      const e = full.indexOf('\nendstream', a);
      if (e === -1) break;
      try {
        out.push(lz.inflateSync(buf.subarray(a + 7, e)).toString('latin1'));
      } catch (_e) {
        /* not a deflate stream — skip */
      }
      i = e + 10;
    }
    return out;
  }

  // For each content stream (i.e. each containing TJ ops — page text
  // streams), count BDC, EMC, q, Q, BT, ET operators and compute the
  // running depth. Returns one summary per content-bearing stream.
  function operatorBalancePerStream(buf: Buffer): Array<{
    bdc: number;
    emc: number;
    q: number;
    Q: number;
    bt: number;
    et: number;
    finalBdcDepth: number;
    finalQDepth: number;
    finalBtDepth: number;
    maxBdcNesting: number;
  }> {
    const results: ReturnType<typeof operatorBalancePerStream> = [];
    for (const z of unzlibAllStreams(buf)) {
      if (z.indexOf(' TJ') === -1) continue; // skip non-text streams
      let bdc = 0,
        emc = 0,
        q = 0,
        Q = 0,
        bt = 0,
        et = 0;
      let bdcDepth = 0,
        qDepth = 0,
        btDepth = 0;
      let maxBdc = 0;
      // Token scan: split on whitespace, count operator tokens.
      // PDF content-stream operators we care about are single-token
      // words (BDC/EMC/q/Q/BT/ET) at the end of an operator sequence.
      const tokens = z.split(/[\s\n]+/);
      for (const t of tokens) {
        if (t === 'BDC' || t === 'BMC') {
          bdc++;
          bdcDepth++;
          if (bdcDepth > maxBdc) maxBdc = bdcDepth;
        } else if (t === 'EMC') {
          emc++;
          bdcDepth--;
        } else if (t === 'q') {
          q++;
          qDepth++;
        } else if (t === 'Q') {
          Q++;
          qDepth--;
        } else if (t === 'BT') {
          bt++;
          btDepth++;
        } else if (t === 'ET') {
          et++;
          btDepth--;
        }
      }
      results.push({
        bdc,
        emc,
        q,
        Q,
        bt,
        et,
        finalBdcDepth: bdcDepth,
        finalQDepth: qDepth,
        finalBtDepth: btDepth,
        maxBdcNesting: maxBdc,
      });
    }
    return results;
  }

  // Walk every /ActualText payload (both literal `(þÿ…)` and hex `<feff…>`
  // forms) and validate well-formedness.
  function validateActualTextPayloads(buf: Buffer): {
    count: number;
    malformed: string[];
  } {
    const malformed: string[] = [];
    let count = 0;
    for (const z of unzlibAllStreams(buf)) {
      // Hex form: `/ActualText <feff[hex]>` — must start with feff, even length.
      const hexRe = /\/ActualText <([0-9a-fA-F]+)>/g;
      let m: RegExpExecArray | null;
      while ((m = hexRe.exec(z)) !== null) {
        count++;
        const hex = m[1].toLowerCase();
        if (!hex.startsWith('feff')) {
          malformed.push('hex without BOM: ' + hex.substring(0, 20));
        }
        if (hex.length % 2 !== 0) {
          malformed.push('hex odd length: ' + hex.length);
        }
      }
      // Literal form: `/ActualText (...)` — must start with bytes 0xFE 0xFF.
      const litRe = /\/ActualText \(((?:\\.|[^\\)])*)\)/g;
      while ((m = litRe.exec(z)) !== null) {
        count++;
        // Unescape to bytes and check leading 0xFE 0xFF.
        const body = m[1];
        let first = -1,
          second = -1;
        if (body.length > 0) {
          if (body[0] === '\\' && body.length > 1) {
            first = body.charCodeAt(1);
          } else {
            first = body.charCodeAt(0);
          }
        }
        if (body.length > 1) {
          const start = body[0] === '\\' ? 2 : 1;
          if (start < body.length) {
            if (body[start] === '\\' && start + 1 < body.length) {
              second = body.charCodeAt(start + 1);
            } else {
              second = body.charCodeAt(start);
            }
          }
        }
        if (first !== 0xfe || second !== 0xff) {
          malformed.push(
            'literal without BOM: first=' + first + ' second=' + second,
          );
        }
      }
    }
    return { count, malformed };
  }

  it('STRUCTURAL: multi-clause Arabic doc passes qpdf check + every marked-content invariant holds', async () => {
    // The regression guard: build a representative multi-clause Arabic
    // document (multi-page, mixed content lines, parens, digits, Latin
    // embeds) and assert structural invariants. Future code changes that
    // accidentally:
    //   - leak BDC without a paired EMC
    //   - leave q or BT depth non-zero at stream end
    //   - emit /ActualText payloads without the FEFF BOM
    //   - nest BDC inside another BDC (max nesting must stay at 1)
    // will fail loud on this test.
    const service = makeService();
    const arabicBody =
      'هذا نص تجريبي للفقرة الطويلة يحتوي على كلمات عربية لمحاكاة عقد';
    const mixed =
      'البند رقم 30 (٢٨١) ينطبق على Retention Money 2018 فقط';
    const content: unknown[] = [];
    for (let i = 1; i <= 15; i++) {
      content.push(
        emitArabicParagraph(
          'البند ' + i + ': ' + arabicBody,
          12,
          EXPORT_BODY_WIDTH_PT,
          true,
          { style: 'h2' },
        ),
      );
      content.push(
        emitArabicParagraph(
          arabicBody + ' ' + arabicBody,
          11,
          EXPORT_BODY_WIDTH_PT,
          false,
        ),
      );
      content.push(emitArabicParagraph(mixed, 11, EXPORT_BODY_WIDTH_PT, false));
    }
    const buf = await renderPdf(service, {
      content,
      styles: { h2: { fontSize: 14, bold: true } },
      defaultStyle: { font: 'Amiri' },
    });

    // (1) qpdf --check returns 0 ("no syntax or stream encoding errors").
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('child_process');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fsmod = require('fs');
    const tmpPath = '/tmp/structural-validity-test.pdf';
    fsmod.writeFileSync(tmpPath, buf);
    let qpdfOut = '';
    let qpdfFailed = false;
    try {
      qpdfOut = execSync('qpdf --check ' + tmpPath, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e: unknown) {
      qpdfFailed = true;
      qpdfOut = String(e);
    }
    expect(qpdfFailed).toBe(false);
    expect(qpdfOut).toContain('No syntax or stream encoding errors');

    // (2) Per-content-stream operator balance — every stream's BDC count
    // equals its EMC count, final depth is zero on EVERY counter, max
    // BDC nesting is at most 1 (we never nest /Span inside /Span), and
    // /Span never spans a page boundary (which is implied by final
    // BDC depth = 0 per stream — each page is its own content stream
    // under pdfmake).
    const streams = operatorBalancePerStream(buf);
    expect(streams.length).toBeGreaterThan(0);
    for (const s of streams) {
      expect(s.bdc).toBe(s.emc);
      expect(s.q).toBe(s.Q);
      expect(s.bt).toBe(s.et);
      expect(s.finalBdcDepth).toBe(0);
      expect(s.finalQDepth).toBe(0);
      expect(s.finalBtDepth).toBe(0);
      expect(s.maxBdcNesting).toBeLessThanOrEqual(1);
    }
    // We rendered at least 15 lines × 3 nodes each ≈ 45 emit calls; the
    // marked-content count should be at LEAST that many. (Multi-line wraps
    // create more lines than emit calls.)
    const totalBdc = streams.reduce((a, s) => a + s.bdc, 0);
    expect(totalBdc).toBeGreaterThan(40);

    // (3) Every /ActualText payload is well-formed: starts with FEFF BOM,
    // even byte count (UTF-16BE pairs). Catches any future encoding
    // regression.
    const payloads = validateActualTextPayloads(buf);
    expect(payloads.count).toBeGreaterThan(0);
    expect(payloads.malformed).toEqual([]);

    // (4) Stream-boundary check: every text-bearing content stream that
    // OPENS a /Span must CLOSE it within the same stream (no marked
    // content can span across stream boundaries, which would also mean
    // crossing page boundaries since pdfmake gives each page its own
    // content stream).
    // Already covered by (2)'s finalBdcDepth === 0 invariant, but we
    // assert it explicitly here for the page-boundary case:
    for (const s of streams) {
      // "BDC opens but EMC missing within same stream" = depth != 0 at end.
      expect(s.finalBdcDepth).toBe(0);
    }
  });

  it('VISUAL bracket mirroring: leftmost paren glyph in an Arabic run has Arabic-reader-correct concavity (CMap proof)', async () => {
    // Pure Arabic input with one parenthetical. We render it through the
    // Arabic emitter, parse the visual codepoint sequence from the CMap,
    // and find the FIRST paren codepoint that appears L→R on the page (=
    // the bracket the Arabic reader sees on the LEFT edge of the paren-
    // thetical = the CLOSER from the reader's perspective).
    //
    // For an Arabic reader, the LEFT bracket of a parenthetical (the one
    // encountered LAST in R→L reading) should have CONCAVITY POINTING
    // RIGHT (it "closes" the parenthetical with its concave side facing
    // the now-finished content on its right). That is the GLYPH SHAPE of
    // the natural Latin "(" — which Amiri's font maps to codepoint U+0028.
    //
    // Without Option B's swap inside RTL runs, fontkit reverses the
    // codepoint sequence but keeps natural glyphs: the LEFT bracket lands
    // as natural ")" (concave-LEFT) — wrong shape for the closer. With
    // the swap applied, the LEFT bracket's CMap entry → U+0028 (the
    // natural "(" glyph). This test asserts that.
    const service = makeService();
    const input = 'العرض الفني والمالي (المقدم) المقدم';
    const docDef = {
      content: [emitArabicParagraph(input, 12, EXPORT_BODY_WIDTH_PT, false)],
      defaultStyle: { font: 'Amiri' },
    };
    const buf = await renderPdf(service, docDef);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lz = require('zlib');
    const full = buf.toString('latin1');
    const allGids: number[] = [];
    const cmap: Record<number, number> = {};
    let i = 0;
    while (i < full.length) {
      const s = full.indexOf('stream\n', i);
      if (s === -1) break;
      const e = full.indexOf('\nendstream', s);
      if (e === -1) break;
      try {
        const z = lz.inflateSync(buf.subarray(s + 7, e)).toString('latin1');
        if (z.indexOf(' TJ') !== -1) {
          const tjRe = /\[([^\]]+)\]\s+TJ/g;
          let tm: RegExpExecArray | null;
          while ((tm = tjRe.exec(z)) !== null) {
            const hexes = tm[1].match(/<([0-9a-fA-F]+)>/g) || [];
            for (const t of hexes) {
              const hex = t.replace(/[<>]/g, '');
              for (let k = 0; k < hex.length; k += 4) {
                allGids.push(parseInt(hex.substring(k, k + 4), 16));
              }
            }
          }
        }
        if (z.indexOf('beginbfrange') !== -1) {
          const rb = z.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
          for (const block of rb) {
            const lineRe =
              /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/g;
            let lm: RegExpExecArray | null;
            while ((lm = lineRe.exec(block)) !== null) {
              const startGid = parseInt(lm[1], 16);
              const cps = lm[3].match(/<([0-9a-fA-F]+)>/g) || [];
              for (let k = 0; k < cps.length; k++) {
                cmap[startGid + k] = parseInt(
                  cps[k].replace(/[<>]/g, ''),
                  16,
                );
              }
            }
          }
        }
      } catch (_e) {
        /* */
      }
      i = e + 10;
    }
    expect(allGids.length).toBeGreaterThan(0);
    const visualCps = allGids.map((g) => cmap[g] ?? 0);
    const leftmostParenIdx = visualCps.findIndex(
      (cp) => cp === 0x0028 || cp === 0x0029,
    );
    expect(leftmostParenIdx).toBeGreaterThanOrEqual(0);
    // CRITICAL: leftmost paren CMap entry must be U+0028.
    // — Without fix: fontkit picks the natural ")" glyph for the LEFT side
    //   of the parenthetical (= the CMap → U+0029) → wrong concavity for
    //   the reader → this assertion FAILS.
    // — With Option B swap: the run text fed to fontkit has the brackets
    //   swapped, so the LEFT-side emitted glyph is the natural "(" glyph,
    //   CMap → U+0028 → reader-correct CLOSER on the left edge → PASSES.
    expect(visualCps[leftmostParenIdx]).toBe(0x0028);
  });

  it('COPY/PARSE bracket preservation: /Span /ActualText markers carry the ORIGINAL codepoints in ORIGINAL logical order (text-extraction proof)', async () => {
    // Option B's whole point: visual rendering is mirrored for the reader,
    // BUT a downstream PDF text extractor (which honors /ActualText per PDF
    // 32000-1 §14.6) returns the ORIGINAL codepoints, in ORIGINAL logical
    // order. So we render the user's exact failing class of input — Arabic
    // around a parenthetical — and inspect the /Span /ActualText markers
    // emitted into the content stream. The marker text MUST equal the
    // unswapped logical input for that run.
    const service = makeService();
    // A single Arabic line with one parenthetical. Mirror-swap would
    // logically swap "(" and ")" in this string; /ActualText must restore
    // the original codepoint order.
    const original = 'العرض الفني والمالي (المقدم) المقدم';
    const docDef = {
      content: [emitArabicParagraph(original, 12, EXPORT_BODY_WIDTH_PT, false)],
      defaultStyle: { font: 'Amiri' },
    };
    const buf = await renderPdf(service, docDef);

    const markers = extractActualTextMarkers(buf);
    // At LEAST one /ActualText marker must be emitted for this input
    // (the helper registers one per RTL run that contained a mirrorable).
    expect(markers.length).toBeGreaterThanOrEqual(1);
    const decoded = markers.map(decodePdfLiteralString);
    // The original logical line must appear in the decoded markers.
    // Critically: this asserts the marker contains "(" and ")" in their
    // ORIGINAL logical positions — NOT the swapped positions. Any compliant
    // PDF reader/extractor returns this string on copy, regardless of what
    // glyph is rendered to the page.
    const containsOriginal = decoded.some((s) => s.includes(original));
    expect(containsOriginal).toBe(true);
    // Tightest assertion: locate the marker's "(" and ")" indices and
    // confirm the "(" appears BEFORE the ")" in the LOGICAL extracted text
    // — proves the swap did NOT bleed into the copy semantics.
    for (const s of decoded) {
      if (!s.includes(original)) continue;
      const openIdx = s.indexOf('(');
      const closeIdx = s.indexOf(')');
      expect(openIdx).toBeGreaterThanOrEqual(0);
      expect(closeIdx).toBeGreaterThan(openIdx);
    }
  });

  it('LTR regression: a Latin-only run is NOT swapped AND NOT wrapped in /ActualText', async () => {
    // The mirror-swap MUST only fire inside isRtl runs. A pure-Latin doc
    // (no Arabic anywhere) should: (a) keep natural "(" glyph orientation;
    // (b) emit ZERO /Span /ActualText markers. If either fails, the patch
    // is over-firing.
    const service = makeService();
    const docDef = {
      content: [{ text: 'Hello (world) goodbye' }],
      defaultStyle: { font: 'Amiri' },
    };
    const buf = await renderPdf(service, docDef);

    // (a) Latin "(" glyph: same GID as the natural cmap entry.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lz = require('zlib');
    const full = buf.toString('latin1');
    const allGids: number[] = [];
    const cmap: Record<number, number> = {};
    let i = 0;
    while (i < full.length) {
      const s = full.indexOf('stream\n', i);
      if (s === -1) break;
      const e = full.indexOf('\nendstream', s);
      if (e === -1) break;
      try {
        const z = lz.inflateSync(buf.subarray(s + 7, e)).toString('latin1');
        const tjRe = /\[([^\]]+)\]\s+TJ/g;
        let m: RegExpExecArray | null;
        while ((m = tjRe.exec(z)) !== null) {
          const hexes = m[1].match(/<([0-9a-fA-F]+)>/g) || [];
          for (const t of hexes) {
            const hex = t.replace(/[<>]/g, '');
            for (let k = 0; k < hex.length; k += 4) {
              allGids.push(parseInt(hex.substring(k, k + 4), 16));
            }
          }
        }
        if (z.indexOf('beginbfrange') !== -1) {
          const rb = z.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
          for (const block of rb) {
            const lineRe =
              /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/g;
            let lm: RegExpExecArray | null;
            while ((lm = lineRe.exec(block)) !== null) {
              const startGid = parseInt(lm[1], 16);
              const cps = lm[3].match(/<([0-9a-fA-F]+)>/g) || [];
              for (let k = 0; k < cps.length; k++) {
                cmap[startGid + k] = parseInt(
                  cps[k].replace(/[<>]/g, ''),
                  16,
                );
              }
            }
          }
        }
      } catch (_e) {
        /* */
      }
      i = e + 10;
    }
    const visualCps = allGids.map((g) => cmap[g] ?? 0);
    // The visual sequence in this LTR doc starts with "Hello (" — so the
    // FIRST paren codepoint encountered L→R must be U+0028, exactly as the
    // input. Any other value means the patch over-fired into LTR.
    const firstParenIdx = visualCps.findIndex(
      (cp) => cp === 0x0028 || cp === 0x0029,
    );
    expect(firstParenIdx).toBeGreaterThanOrEqual(0);
    expect(visualCps[firstParenIdx]).toBe(0x0028);

    // (b) NO /Span /ActualText markers should be emitted for this doc.
    const markers = extractActualTextMarkers(buf);
    expect(markers.length).toBe(0);
  });

  it('Position-based contextual joining: ت in initial vs final position emits DIFFERENT subset GIDs both mapping to U+062A (GSUB proof)', async () => {
    // The NON-NEGOTIABLE joining regression guard.
    //
    // Mechanism: render two Arabic words on the same line where the SHARED
    // letter ت (U+062A) sits at DIFFERENT positions:
    //   - "تب"  : ت is INITIAL (start of word, joiner follows)   → initial form
    //   - "بت"  : ت is FINAL   (end of word, joiner precedes)    → final   form
    // Amiri ships distinct glyphs for the four positional forms of ت
    // (initial / medial / final / isolated). When fontkit runs Arabic GSUB
    // contextual joining on each word, it must select the position-correct
    // glyph in each case — so the two ت occurrences in the rendered PDF
    // resolve to TWO DIFFERENT original Amiri glyphs.
    //
    // pdfkit's font subsetter assigns each used glyph a distinct subset GID
    // and emits a /ToUnicode CMap mapping every subset GID back to the
    // ORIGINAL logical Unicode codepoint. So in the CMap of this rendered
    // PDF there must be AT LEAST TWO distinct subset GIDs mapping to U+062A.
    //
    // If joining regresses (e.g. presentation-forms input, or chars reach
    // fontkit out of joining context), Amiri's GSUB picks the same isolated
    // form for both ت positions → only ONE subset GID maps to U+062A → this
    // test FAILS. The check is direction-agnostic — joining is a shaping
    // property independent of bidi reordering.
    const service = makeService();
    const docDef = {
      content: [
        emitArabicParagraph('تب بت', 12, EXPORT_BODY_WIDTH_PT, false, {
          style: 'body',
        }),
      ],
      styles: { body: { fontSize: 12 } },
      defaultStyle: { font: 'Amiri' },
    };
    const buf = await renderPdf(service, docDef);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const localZlib = require('zlib');
    const fullStr = buf.toString('latin1');

    // Build the CMap from every beginbfrange block.
    const cmap: Record<number, number> = {};
    let i = 0;
    while (i < fullStr.length) {
      const s = fullStr.indexOf('stream\n', i);
      if (s === -1) break;
      const e = fullStr.indexOf('\nendstream', s);
      if (e === -1) break;
      try {
        const inflated = localZlib
          .inflateSync(buf.subarray(s + 7, e))
          .toString('latin1');
        if (inflated.indexOf('beginbfrange') !== -1) {
          const rangeBlocks =
            inflated.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
          for (const block of rangeBlocks) {
            const lineRe =
              /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/g;
            let lm: RegExpExecArray | null;
            while ((lm = lineRe.exec(block)) !== null) {
              const startGid = parseInt(lm[1], 16);
              const cpHexes = lm[3].match(/<([0-9a-fA-F]+)>/g) || [];
              for (let k = 0; k < cpHexes.length; k++) {
                cmap[startGid + k] = parseInt(
                  cpHexes[k].replace(/[<>]/g, ''),
                  16,
                );
              }
            }
          }
        }
      } catch (_e) {
        /* skip */
      }
      i = e + 10;
    }

    expect(Object.keys(cmap).length).toBeGreaterThan(0);

    // Collect every subset GID whose CMap entry is U+062A (ت).
    const gidsMappingToTaa: number[] = [];
    for (const gidStr of Object.keys(cmap)) {
      if (cmap[parseInt(gidStr, 10)] === 0x062a) {
        gidsMappingToTaa.push(parseInt(gidStr, 10));
      }
    }

    // CRITICAL: ≥2 distinct subset GIDs must map back to U+062A. That is
    // ONLY possible if fontkit picked TWO DIFFERENT original Amiri glyphs
    // for the two ت occurrences — i.e. position-correct contextual GSUB
    // joining ran end-to-end. A regression where joining is broken (e.g.
    // pre-shaped presentation forms, or chars sent to fontkit one at a
    // time so context is lost) would resolve both ت to the same isolated
    // form and this count would drop to 1.
    expect(gidsMappingToTaa.length).toBeGreaterThanOrEqual(2);
  });

  it('Latin-only docDef: monkey-patch leaves the text-content stream glyph-identical across renders', async () => {
    // The EmbeddedFont.layoutRun monkey-patch (in pdf-arabic.ts module init)
    // forces direction='ltr' on every fontkit.layout call. For Latin-only
    // text fontkit's auto-detect WOULD have picked 'ltr' anyway. The
    // strongest verification is: the GLYPH SEQUENCE pdfkit emits for the
    // same Latin input is deterministic and matches the codepoints
    // forward (no reordering, no surprise reshuffling).
    //
    // We do NOT compare full PDF buffers because pdfmake injects
    // non-deterministic metadata per render (creation timestamps, internal
    // IDs). The text-content STREAM by itself is glyph-deterministic.
    const service = makeService();
    const sentence =
      'Schedule 30 — Retention Money payable on 2018-01-15.';
    const docDef = {
      content: [{ text: sentence }],
      defaultStyle: { font: 'Amiri' },
    };
    const a = await renderPdf(service, docDef);
    const b = await renderPdf(service, docDef);

    // Structural sanity: both are valid PDFs containing Amiri
    expect(a.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(a.subarray(-16).toString('utf8')).toContain('%%EOF');
    expect(a.toString('latin1')).toContain('Amiri');
    expect(a.toString('latin1')).not.toContain('Helvetica');

    // Extract text-stream + CMap and verify the rendered glyph sequence
    // for a known Latin substring appears in FORWARD codepoint order.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const localZlib = require('zlib');
    function extract(buf: Buffer): { gids: number[]; cmap: Record<number, number> } {
      const fullStr = buf.toString('latin1');
      const gids: number[] = [];
      const cmap: Record<number, number> = {};
      let i = 0;
      while (i < fullStr.length) {
        const s = fullStr.indexOf('stream\n', i);
        if (s === -1) break;
        const e = fullStr.indexOf('\nendstream', s);
        if (e === -1) break;
        try {
          const inflated = localZlib
            .inflateSync(buf.subarray(s + 7, e))
            .toString('latin1');
          if (inflated.indexOf(' TJ') !== -1 && gids.length === 0) {
            // Each TJ is `[<hex1> kern <hex2> kern ... <hexN>] TJ`. Capture
            // ALL hex groups within each TJ (pdfkit kerning splits a single
            // text run into multiple <hex> segments).
            const tjRe = /\[([^\]]+)\]\s+TJ/g;
            let m: RegExpExecArray | null;
            while ((m = tjRe.exec(inflated)) !== null) {
              const hexes = m[1].match(/<([0-9a-fA-F]+)>/g) || [];
              for (const hexTag of hexes) {
                const hex = hexTag.replace(/[<>]/g, '');
                for (let k = 0; k < hex.length; k += 4) {
                  gids.push(parseInt(hex.substring(k, k + 4), 16));
                }
              }
            }
          }
          if (inflated.indexOf('beginbfrange') !== -1) {
            const rb = inflated.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
            for (const block of rb) {
              const lineRe =
                /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]+)\]/g;
              let lm: RegExpExecArray | null;
              while ((lm = lineRe.exec(block)) !== null) {
                const startGid = parseInt(lm[1], 16);
                const cps = lm[3].match(/<([0-9a-fA-F]+)>/g) || [];
                for (let k = 0; k < cps.length; k++) {
                  cmap[startGid + k] = parseInt(
                    cps[k].replace(/[<>]/g, ''),
                    16,
                  );
                }
              }
            }
          }
        } catch (_e) {
          /* skip */
        }
        i = e + 10;
      }
      return { gids, cmap };
    }

    const aOut = extract(a);
    const bOut = extract(b);

    // The TEXT-CONTENT stream (glyph IDs in emission order) must be
    // byte-identical across two renders of the same Latin doc — proves the
    // patch has no per-render state mutation that would affect text output.
    expect(aOut.gids).toEqual(bOut.gids);

    // And the codepoint sequence (after CMap mapping) for "Retention Money"
    // must appear in FORWARD codepoint order in the visual stream — proves
    // the LTR auto-detect path under the patch is unchanged from native.
    const visualCps = aOut.gids.map((g) => aOut.cmap[g] ?? 0);
    const retentionMoneyCps = [
      0x52, 0x65, 0x74, 0x65, 0x6e, 0x74, 0x69, 0x6f, 0x6e, 0x20, 0x4d,
      0x6f, 0x6e, 0x65, 0x79,
    ];
    let foundAt = -1;
    outer: for (
      let start = 0;
      start <= visualCps.length - retentionMoneyCps.length;
      start++
    ) {
      for (let j = 0; j < retentionMoneyCps.length; j++) {
        if (visualCps[start + j] !== retentionMoneyCps[j]) continue outer;
      }
      foundAt = start;
      break;
    }
    expect(foundAt).toBeGreaterThanOrEqual(0);
  });

  // ──────────────────────────────────────────────────────────────────────
  // FONT-VALIDITY GATE — Acrobat-strict embedded-font shape (2026-06-24)
  // ──────────────────────────────────────────────────────────────────────
  //
  // Background: pdfkit's stock embedding pipeline uses fontkit's
  // TTFSubset, which produces a minimal subset with sfntVersion='true'
  // (Apple TrueType magic, 0x74727565) and only 7 tables (head hhea
  // loca maxp prep glyf hmtx). qpdf, fontTools, Chrome's PDF viewer all
  // accept this minimal shape. Adobe Acrobat is strict — for real
  // contract exports with large glyph diversity it either renders
  // garbled Latin or crashes with EXCEPTION_ACCESS_VIOLATION inside
  // CTJPEGReader / Font Capture.
  //
  // This test asserts the SPEC-VALID OpenType shape:
  //   - sfntVersion == 0x00010000 (Windows-style TrueType / OpenType)
  //   - cmap + head + hhea + hmtx + maxp + name + post + OS/2 + glyf +
  //     loca all present (the OpenType-required table set)
  //
  // RED-first design: the same extraction+assertion logic, applied to
  // the PRE-fix `real-muhlbauer-endpoint.pdf` (captured during
  // diagnostic, sha256 da0de67141c94d937b2bc6284ead17731cf9d92edf4500ac7c95f52a9f520f43,
  // sfntVersion='true', 7 tables), FAILS. We verified that out-of-test
  // before adding this guard. The test below renders a fresh Arabic
  // export through the current code path and asserts the spec-valid
  // shape — PASSES after the full-Amiri-embed monkey-patch installed
  // in `pdf-arabic.ts` (Acrobat-strict fix 2026-06-24).
  //
  // This is the test the OTHER validators couldn't catch — qpdf says
  // clean, fontTools accepts 'true' magic, Chrome renders it. Only
  // Acrobat strict-rejects. The structural-validity guard above
  // (BDC/EMC balance) is necessary but insufficient — this guard
  // closes the gap.

  it('FONT VALIDITY (Acrobat strict): every embedded FontFile2 has sfntVersion 0x00010000 + all required OpenType tables', async () => {
    const service = makeService();
    // A representative Arabic doc — exercises the contract-export emit
    // path with the Arabic helper, bold heading + body body. The
    // resulting buffer's embedded FontFile2 streams MUST conform to
    // the strict OpenType shape Acrobat accepts.
    const docDef = {
      content: [
        // Pure-Latin chrome (footer-like) — inherits Helvetica from
        // defaultStyle, no embedded font.
        { text: 'Generated by Sign Platform Page 1 of 28' },
        // Bold Arabic heading via the helper — emits font: 'Amiri'
        // explicitly so it routes to the embedded TTF.
        emitArabicParagraph(
          arabicHeadingText('3', 'المحاسبة على الاعمال'),
          12,
          EXPORT_BODY_WIDTH_PT,
          true,
          { style: 'clauseTitle' },
        ),
        // Regular Arabic body via the helper, mixed with Latin + digits.
        emitArabicParagraph(
          'البند رقم 30 (٢٨١) ينطبق على Retention Money 2018 فقط',
          10,
          EXPORT_BODY_WIDTH_PT,
          false,
          { style: 'body' },
        ),
        emitArabicParagraph(
          'هذا اتفاقية بين الطرف الأول والطرف الثاني والمستندات التعاقدية',
          10,
          EXPORT_BODY_WIDTH_PT,
          false,
          { style: 'body' },
        ),
      ],
      styles: {
        clauseTitle: { fontSize: 12, bold: true },
        body: { fontSize: 10 },
      },
      defaultStyle: { font: 'Helvetica' },
    };
    const buf = await renderPdf(service, docDef);

    // Walk every FontFile2 stream and validate its shape.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lz = require('zlib');
    const fullStr = buf.toString('latin1');
    const ff2Refs = [...fullStr.matchAll(/FontFile2 (\d+) 0 R/g)].map((m) =>
      parseInt(m[1]),
    );
    expect(ff2Refs.length).toBeGreaterThan(0); // we expect at least Amiri-Regular
    const REQUIRED_TABLES = [
      'cmap',
      'head',
      'hhea',
      'hmtx',
      'maxp',
      'name',
      'post',
      'OS/2',
      'glyf',
      'loca',
    ];
    const failures: string[] = [];
    for (const objNum of ff2Refs) {
      const tag = objNum + ' 0 obj';
      const objStart = fullStr.indexOf(tag);
      if (objStart === -1) {
        failures.push(`obj ${objNum}: no body`);
        continue;
      }
      const streamStart = fullStr.indexOf('stream\n', objStart);
      const endstream = fullStr.indexOf('endstream', streamStart);
      let actualEnd = endstream;
      while (
        actualEnd > streamStart + 7 &&
        (fullStr.charCodeAt(actualEnd - 1) === 0x0a ||
          fullStr.charCodeAt(actualEnd - 1) === 0x0d)
      )
        actualEnd--;
      let inflated: Buffer;
      try {
        inflated = lz.inflateSync(buf.subarray(streamStart + 7, actualEnd));
      } catch (e) {
        failures.push(`obj ${objNum}: inflate failed: ${(e as Error).message}`);
        continue;
      }
      // sfntVersion check — first 4 bytes
      const sfntHex = inflated.subarray(0, 4).toString('hex');
      if (sfntHex !== '00010000') {
        failures.push(
          `obj ${objNum}: sfntVersion=${sfntHex} (expected 00010000; ` +
            `Acrobat rejects 'true'/74727565 minimal subsets)`,
        );
      }
      // Required tables present?
      const numTables = inflated.readUInt16BE(4);
      const tableTags: string[] = [];
      for (let i = 0; i < numTables; i++) {
        tableTags.push(
          inflated.subarray(12 + i * 16, 12 + i * 16 + 4).toString('latin1'),
        );
      }
      const missing = REQUIRED_TABLES.filter((t) => !tableTags.includes(t));
      if (missing.length > 0) {
        failures.push(
          `obj ${objNum}: missing required tables [${missing.join(', ')}] ` +
            `— have only [${tableTags.join(' ')}]`,
        );
      }
    }
    expect(failures).toEqual([]);
  });
});

