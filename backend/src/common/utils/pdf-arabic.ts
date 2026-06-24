import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fontkit = require('fontkit');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LineBreaker = require('linebreak');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bidiFactory = require('bidi-js');

// ─── Architecture: per-script-run inline emission (Option C) ──────────────
//
// History of failed approaches on this branch (each documented to prevent
// regression):
//
// 1) Pre-shape via `arabic-persian-reshaper` (decomposed→presentation forms)
//    + bidi-reverse. Broke joining because Amiri's GSUB lookups expect
//    base codepoints U+0600–U+06FF, NOT presentation forms FB50–FEFF.
//
// 2) Identity passthrough + `noWrap: true` + `fontFeatures: []`. Fixed
//    Arabic letter joining (fontkit auto-RTL detected Arabic, shaped GSUB
//    correctly), but pdfkit's `EmbeddedFont.layout` space-split text into
//    per-word inlines so cross-word bidi was lost. Caused `٣. عقد` to
//    render with ٣ on the LEFT and reversed word order in long paragraphs.
//
// 3) bidi-js pre-reorder + monkey-patch `EmbeddedFont.layoutRun` to pass
//    `dir='ltr'` to fontkit. Fixed mixed-content ordering (Retention Money
//    forward, 2018 forward, brackets correct) BUT broke joining: feeding
//    fontkit visual-order Arabic confuses the joining-position algorithm
//    (init/medi/fina assignment uses LOGICAL adjacency, not input order),
//    so contextual GSUB lookups produced wrong forms / disconnected letters.
//
// THIS approach (Option C, current):
//   - bidi-js is used for SEGMENTATION ONLY (split text into directional
//     runs in visual order). Within each run, chars stay in LOGICAL order.
//   - Each run is emitted as a separate inline in pdfmake's `text: [...]`
//     array. Arabic runs get `fontFeatures: []` to force fontkit's
//     whole-string layout path (within the run); fontkit's auto-detect
//     picks RTL for Arabic runs and LTR for Latin runs — and within each
//     run the joining context is preserved because we hand fontkit
//     LOGICAL order. Latin runs are passed unchanged.
//   - pdfmake places inlines L→R at increasing X. We emit segments in
//     VISUAL order so the final visual layout matches what an Arabic
//     reader expects (digit/bracket/Latin runs in correct positions).
//   - NO monkey-patch on pdfkit. fontkit's per-run auto-direction is what
//     we want now.
//   - `wrapArabicLines` is unchanged — it still operates on LOGICAL text
//     and decides line breaks at Unicode line-break boundaries. The
//     per-run segmentation happens AFTER wrap, per emitted line.
//
// Joining proof in the test suite asserts that a single Arabic word
// renders MULTIPLE subset gids mapping to the same Unicode codepoint
// (init/medi/fina forms of the same letter), proving GSUB shaping ran.
// Mixed-content proof asserts Latin/digit codepoint sequences appear in
// correct forward order. Both proofs hold on the same rendered output.

const BIDI = bidiFactory();

// ─── Option B: bracket mirroring + /ActualText copy preservation ─────────
//
// Empirical diagnosis (2026-06-23): Amiri ships GSUB lookups for Arabic
// joining (init/medi/fina/isol) but does NOT ship 'rtlm' lookups for paired
// punctuation. fontkit's RTL pipeline therefore correctly REVERSES the
// codepoint sequence but does NOT mirror the bracket GLYPH SHAPE in RTL
// context. PDF readers don't auto-mirror at draw time either. Result: a
// pure-Arabic line like "نص (محتوى) نص" renders with the natural "("
// concave-right glyph on the visual RIGHT side and natural ")" concave-left
// on the LEFT — backwards for an Arabic reader (the right-edge bracket
// should "open" with concavity-LEFT, the left-edge bracket should "close"
// with concavity-RIGHT).
//
// Fix surface: in RTL runs only, pre-swap each mirrored codepoint to its
// pair BEFORE handing to fontkit. fontkit then picks the natural glyph for
// the SWAPPED codepoint, which is visually the correct one for the
// reader's perspective on that side of the parenthetical.
//
// Copy-fidelity preservation: the swap changes what /ToUnicode CMap sees.
// To keep PDF text extraction returning the ORIGINAL logical codepoints,
// every swapped RTL inline gets wrapped in a `/Span << /ActualText (orig)
// >> BDC ... EMC` marked-content block via pdfkit's NATIVE `markContent` /
// `endMarkedContent` API (not a hand-rolled content-stream injection). PDF
// 32000-1 §14.6 mandates that compliant text extractors return /ActualText
// for the wrapped span.
//
// Mechanism for the marker emission:
//   - `segmentToVisualRuns` mirror-swaps RTL run text in-place.
//   - `emitArabicParagraph` registers each swapped/original pair in the
//     module-scoped FIFO queue `actualTextRegistry` (keyed by the SWAPPED
//     text — the exact string pdfmake will hand to pdfkit's `_fragment`).
//   - A module-init monkey-patch on `PDFDocument.prototype._fragment`
//     consumes from the queue: if the incoming fragment text matches a
//     registered key, the patch wraps the original `_fragment` call in
//     `markContent('Span', { actual: originalText })` / `endMarkedContent()`.
//   - The queue is FIFO per key — under the noWrap+fontFeatures:[] path
//     pdfmake hands the WHOLE RTL run text to `_fragment` as ONE call
//     (empirically verified), so registration order matches consumption
//     order within a render. Cross-render bleed is not possible in
//     NestJS's sequential request handling (one PDF buffer per request).
//
// ─── Whole-line /ActualText redesign (2026-06-24) ────────────────────────
//
// The per-fragment /ActualText approach (commented above) is correct for
// pure-Arabic single-run lines but FAILS for mixed Arabic+Latin+digit lines
// in real PDF readers. Diagnosis: per-fragment /ActualText only gives the
// reader each fragment's local logical slice. The reader still walks
// fragments in VISUAL emission order (page L→R) and reassembles them in
// that order — for Arabic-dominant lines, that's REVERSE-LOGICAL. Proven
// by the user's copy/paste test into Word/WPS: the mixed line pasted as
// "فقط Retention Money 2018 ( ينطبق على١٨٢ )30 البند رقم" — visual order.
//
// Whole-line redesign: wrap the ENTIRE line's TJ ops inside ONE `/Span
// << /ActualText (full-logical-line) >> BDC ... EMC` pair. PDF readers
// honor /ActualText for the WHOLE wrapped span — they return the
// /ActualText string verbatim, ignoring internal fragment ordering or
// positioning. Mozilla pdf.js (the canonical reference implementation
// used by Firefox) implements this exactly. Empirically verified
// end-to-end via the REAL pdfjs EXTRACT tests in
// `export.service.arabic.spec.ts`.
//
// Implementation: pdfmake calls pdfkit's `_fragment` per inline. To
// bracket the WHOLE LINE we add invisible zero-width sentinel inlines at
// the start and end of each line's `text:[...]` array. The same
// monkey-patch detects them via the START/END queues and emits
// `markContent('Span', { actual: fullLogicalLine })` / `endMarkedContent()`
// — WITHOUT calling original `_fragment` for the sentinel chars (so no
// glyph is rendered for them either). The Bidi_Mirrored swap on RTL
// runs stays (for visual correctness); per-fragment registration is
// DROPPED (nested /ActualText would let inner spans override outer in
// some readers, defeating the whole-line approach).
//
// Sentinels: U+200B (ZWSP) for START, U+FEFF (ZWNBSP) for END. Both have
// EXPLICIT zero-width glyphs in Amiri (gid 370 / 1061, advW=0). Even if
// the patch misfires and a sentinel reaches fontkit, it renders as
// zero-width and leaves no visible artifact. Sentinels MUST always pair
// — the START queue tracks pending actualText values; the END queue is
// just a counter. Mismatched counts (e.g. helper registers but pdfmake
// skips the inline) become loud test failures because the real pdfjs
// extract no longer round-trips.
//
// Mirror table: the seven Bidi_Mirrored=Y paired punctuation marks that
// appear in real legal-contract Arabic text. CJK angle brackets and
// less-common pairs are intentionally NOT included — they would need
// independent visual verification and risk over-firing.

const MIRROR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [0x0028, 0x0029], // ( )  parentheses
  [0x005b, 0x005d], // [ ]  square brackets
  [0x007b, 0x007d], // { }  curly braces
  [0x003c, 0x003e], // < >  less-than / greater-than
  [0x00ab, 0x00bb], // « »  guillemets
];
const MIRROR_MAP: Map<number, number> = (() => {
  const m = new Map<number, number>();
  for (const [a, b] of MIRROR_PAIRS) {
    m.set(a, b);
    m.set(b, a);
  }
  return m;
})();

/** True iff swapping mirror chars would change the input string. */
function hasMirrorables(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (MIRROR_MAP.has(text.charCodeAt(i))) return true;
  }
  return false;
}

/** Swap every Bidi_Mirrored mirrorable codepoint with its mirror pair. */
function swapMirrorChars(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    const m = MIRROR_MAP.get(cp);
    out += m === undefined ? text[i] : String.fromCharCode(m);
  }
  return out;
}

// Sentinel codepoints for the whole-line wrap. Each pair of sentinels
// brackets one logical line in the inline stream:
//   START prefix prepended to the line's FIRST run text;
//   END   suffix appended  to the line's LAST  run text.
// They are prefix/suffix (not standalone inlines) because pdfmake's
// tokenizer silently drops zero-width-only inlines — empirically
// verified. They are NOT ZWSP (U+200B) / ZWNBSP (U+FEFF) because those
// are stripped at line boundaries as whitespace — also empirically
// verified by probe.
//
// ZWNJ (U+200C) and ZWJ (U+200D):
//   - have explicit zero-width glyphs in Amiri (gid 371 / 372, advW=0),
//     so even if the monkey-patch ever misses them and they reach the
//     glyph stream, there is zero visible artifact;
//   - survive pdfmake's tokenizer in EVERY tested position (leading,
//     trailing, mid-inline) including immediately adjacent to Arabic
//     letters and spaces;
//   - are mutually distinct → the patch tells START from END by char;
//   - their Arabic-joining semantics never reach fontkit's rendering
//     pipeline because the patch strips them before calling original
//     `_fragment`. They DO pass through pdfmake's measurement (which
//     uses fontkit too), but since both have zero width that adds 0
//     to layout. Empirically: text "U+200C فقط" measures identically
//     to " فقط".
const ACTUAL_TEXT_START_SENTINEL = '‌'; // ZWNJ
const ACTUAL_TEXT_END_SENTINEL = '‍'; // ZWJ

/**
 * FIFO queue of pending /ActualText values, one per emitted line that
 * needs /ActualText. The patch consumes one value per START sentinel
 * encounter, then emits `markContent('Span', { actual: value })`. The
 * END sentinel is just a paired marker — it triggers `endMarkedContent()`.
 *
 * Lifecycle: helper appends during docDef construction; monkey-patched
 * `_fragment` consumes during render. The queue grows during line emit
 * and shrinks during render. In normal flow the queue is empty at the
 * end of each PDF render (one entry per START sentinel, one consumption
 * per matched fragment). Imbalance would mean the helper registered
 * lines that pdfmake never emitted — surfaced as test failures because
 * the real pdfjs extract would no longer return the expected logical
 * string.
 */
const pendingLineActualText: string[] = [];

function registerLineActualText(actualText: string): void {
  pendingLineActualText.push(actualText);
}

// Module-init monkey-patch on pdfkit's per-fragment text emission.
// Same single-install gate as the prior architecture (idempotent across
// hot-reload / repeated module imports). Same fail-safe on missing
// pdfkit. The patch detects our sentinel chars by exact text equality
// and emits `markContent('Span', { actual })` / `endMarkedContent()`
// without calling original `_fragment` (so the sentinel itself does not
// render — its zero-width glyph never reaches the page). All other
// fragments call the original `_fragment` unchanged → glyph stream is
// byte-identical to native pdfkit.
//
// Defensive single-install guard pattern stays: `__pdfArabicFragmentPatched`
// flag on the prototype + idempotent install + native `markContent` /
// `endMarkedContent` public API.
//
// Regression surface:
//   - Still tied to `PDFDocument.prototype._fragment(text, x, y, options)`
//     signature. The REAL pdfjs EXTRACT tests are the loud canaries —
//     they fail end-to-end if the patch ever stops firing OR if the
//     sentinel encoding stops matching the pdfmake path.
//   - Sentinel chars must match exactly. If pdfmake ever trims or
//     normalizes the inline text (it currently does not, empirically
//     verified), the START/END queue desyncs and the same canary tests
//     catch it.
(function installFragmentPatch() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PDFDocument: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PDFDocument = require('pdfkit');
  } catch (_e) {
    return; // pdfkit not installed — patch is a no-op
  }
  if (!PDFDocument || !PDFDocument.prototype) return;
  if (PDFDocument.prototype.__pdfArabicFragmentPatched === true) return;
  const original = PDFDocument.prototype._fragment;
  if (typeof original !== 'function') return;
  PDFDocument.prototype._fragment = function (
    this: { markContent: Function; endMarkedContent: Function },
    text: string,
    x: number,
    y: number,
    options: unknown,
  ): unknown {
    return original.call(this, text, x, y, options);
  };
  PDFDocument.prototype.__pdfArabicFragmentPatched = true;
  // Also patch text() — this is the entry point pdfmake calls per
  // inline. Empirically: by the time pdfkit's text() chain reaches
  // _fragment, the sentinel chars have been stripped (probably during
  // pdfkit's internal line-breaking pass). text() receives them intact,
  // so we install the markContent/endMarkedContent at THIS level. The
  // call to original text() then proceeds normally; the sentinels get
  // stripped down the chain and never make it to the PDF glyph stream
  // (zero visible artifact AND no influence on glyph positioning,
  // because their advance width was 0 throughout fontkit measurement).
  const originalText = PDFDocument.prototype.text;
  if (typeof originalText === 'function') {
    PDFDocument.prototype.text = function (
      this: { markContent: Function; endMarkedContent: Function },
      text: unknown,
      x: unknown,
      y: unknown,
      options: unknown,
    ): unknown {
      if (typeof text !== 'string') {
        return originalText.call(this, text, x, y, options);
      }
      const startsWithSentinel = text.startsWith(ACTUAL_TEXT_START_SENTINEL);
      const endsWithSentinel = text.endsWith(ACTUAL_TEXT_END_SENTINEL);
      if (!startsWithSentinel && !endsWithSentinel) {
        return originalText.call(this, text, x, y, options);
      }
      if (startsWithSentinel) {
        const actual = pendingLineActualText.shift();
        if (actual !== undefined) {
          this.markContent('Span', { actual });
        }
      }
      try {
        return originalText.call(this, text, x, y, options);
      } finally {
        if (endsWithSentinel) {
          this.endMarkedContent();
        }
      }
    };
  }
})();

/**
 * Arabic PDF rendering helper — Option A: pre-measure + pre-wrap.
 *
 * Architecture (post-eyeball-diagnosis 2026-06-23):
 * ─────────────────────────────────────────────────
 * pdfmake's TextBreaker splits every text node into per-word inlines (one
 * Tm+TJ block per word, at monotonically increasing X coordinates). fontkit
 * then lays out each WORD individually, so within-word OpenType GSUB shaping
 * (Arabic joining) works correctly — but the cross-word UAX #9 bidi NEVER
 * happens because fontkit only ever sees one word at a time. The result:
 * multi-word Arabic content reads BACKWARDS at the word level (each word
 * internally correct, but logical word #1 lands at the leftmost X position).
 *
 * Lever: setting `noWrap: true` on a text node collapses the whole string
 * into ONE Tm+TJ block — fontkit then sees the full line and does paragraph-
 * level bidi within it. Verified empirically:
 *   - `{ text: "المستندات التعاقدية للمشروع", noWrap: false }` → 3 Tm+TJ blocks
 *   - `{ text: "المستندات التعاقدية للمشروع", noWrap: true  }` → 1 Tm+TJ block
 *
 * Catch: noWrap disables pdfmake's auto-wrapping, so a long paragraph would
 * overflow. So we pre-wrap into visual lines ourselves (this file), and emit
 * each line as a separate noWrap text node in a `stack`. Each emitted line
 * reaches fontkit as one paragraph → bidi correct, words in correct visual
 * order, Arabic-Indic digits anchored on the right.
 *
 * Measurement uses fontkit's `Font.layout(text).advanceWidth` — the exact
 * same engine pdfkit uses internally, so widths are byte-identical to what
 * pdfmake will compute at render time. No rounding drift.
 *
 * Latin content short-circuits: no transform, no extra cost. Existing Latin
 * PDFs are byte-identical to pre-Option-A renders.
 *
 * v1 caveats (documented for future hardening):
 *   - A single Arabic word longer than the column overflows (no soft break).
 *     In practice Arabic words rarely exceed ~15 chars at 10pt in a 500pt
 *     column.
 *   - No justified Arabic — emitted lines are right-aligned only.
 *   - For 'auto' / '*' table-cell widths we use a ¼-of-body heuristic.
 *     First real edge case to harden if multi-line wrap inside cells bites.
 *   - Multi-line wrap respects word boundaries from the Unicode line-break
 *     algorithm (`linebreak` — the same package pdfmake uses internally).
 */

// ─── Arabic detection ────────────────────────────────────────────────────

// Arabic block + supplement + extended-A + presentation forms A/B.
const ARABIC_RE =
  /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/**
 * True iff `text` contains at least one codepoint in the Arabic ranges.
 * Type-safe: false for null / undefined / non-string.
 */
export function containsArabic(text: unknown): boolean {
  return typeof text === 'string' && ARABIC_RE.test(text);
}

// ─── Font assets + VFS ───────────────────────────────────────────────────

// `__dirname` at runtime = `dist/common/utils`; three levels up = `dist/`.
// Asset path resolves into the source tree mounted at /app/.
const FONT_DIR = path.resolve(__dirname, '..', '..', '..', 'assets', 'fonts');

const AMIRI_REGULAR_BUFFER = fs.readFileSync(
  path.join(FONT_DIR, 'Amiri-Regular.ttf'),
);
const AMIRI_BOLD_BUFFER = fs.readFileSync(
  path.join(FONT_DIR, 'Amiri-Bold.ttf'),
);

// Module-scoped fontkit instances for measurement. ONE per font cut; reused
// across every wrap call. fontkit.create() parses the TTF tables once.
const AMIRI_REGULAR_FONT = fontkit.create(AMIRI_REGULAR_BUFFER);
const AMIRI_BOLD_FONT = fontkit.create(AMIRI_BOLD_BUFFER);

// ─── Full Amiri embedding (Acrobat-strict fix, 2026-06-24) ───────────────
//
// pdfkit's default font embedding pipeline goes through fontkit's
// `TTFSubset.encode()`, which produces a stripped subset font with:
//   - sfntVersion = 'true' (Apple TrueType magic, not the standard
//     0x00010000 OpenType/Windows magic)
//   - 7 tables only (head hhea loca maxp prep glyf hmtx) — MISSING the
//     required `cmap`, `name`, `post`, `OS/2` tables
//
// Lenient parsers (qpdf, fontTools, Chrome's PDF viewer) accept this
// minimal subset. Adobe Acrobat is strict — for real-content Arabic
// PDFs with large glyph diversity (the 60+-clause Muhlbauer contract
// surfaced this), Acrobat strict-parses the FontFile2 and either
// crashes outright (CTJPEGReader / Font Capture access violations,
// EXCEPTION_ACCESS_VIOLATION) or renders glyph data incorrectly
// (visible garbled Latin in the footer). Same root cause.
//
// Fix: stop using fontkit's subset encoder. Embed the FULL Amiri TTF
// (Acrobat-valid sfntVersion 0x00010000, all 15 required + optional
// tables present) as the FontFile2 stream. Keep the content-stream
// gids as SUBSET gids (small numbers, e.g. 1..400) — pdfkit's
// encode() emits these via `subset.includeGlyph()`. Replace pdfkit's
// `/CIDToGIDMap = 'Identity'` with a STREAM that maps each subset gid
// to its original Amiri glyph ID (sourced from `subset.glyphs[]`).
// Acrobat then: reads subset gid X from content stream → consults
// /CIDToGIDMap → original Amiri gid Y → fetches glyph Y from full
// Amiri (the spec-valid embedded font) → renders the correct glyph.
//
// Why this preserves correct VISUAL rendering: the original Amiri gid
// is the SAME glyph the helper's measurement step (fontkit.layout)
// resolved. The subset's `mapping[originalGid] = subsetGid` IS the
// inverse — building the CIDToGIDMap from `subset.glyphs` (which
// stores the originals in subset order) means content stream gid N
// resolves to the same glyph fontkit measured. No glyph displacement.
//
// Side effect: PDF size grows by ~500 KB per Arabic export (full
// Amiri-Regular ~437 KB + Amiri-Bold ~414 KB, replacing ~30–60 KB
// subsets). The user accepted this trade for Acrobat correctness.
//
// Implementation: module-init monkey-patch on the internal EmbeddedFont
// class. pdfkit doesn't export this class directly; we find it via a
// throwaway PDFDocument + registerFont(). Patch is idempotent and only
// fires for fonts whose postscriptName is in `FULL_EMBED_BUFFERS`.

const FULL_EMBED_BUFFERS: Map<string, Buffer> = new Map([
  [AMIRI_REGULAR_FONT.postscriptName, AMIRI_REGULAR_BUFFER],
  [AMIRI_BOLD_FONT.postscriptName, AMIRI_BOLD_BUFFER],
]);

(function installFullEmbedPatch() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PDFDocument: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    PDFDocument = require('pdfkit');
  } catch (_e) {
    return;
  }
  if (!PDFDocument || !PDFDocument.prototype) return;
  if (PDFDocument.prototype.__pdfArabicFullEmbedPatched === true) return;
  // Find the EmbeddedFont class via a throwaway probe: register a TTF
  // and look at the resulting font instance's constructor.
  let EmbeddedFontClass = null as unknown as {
    prototype: {
      embed: (this: unknown) => unknown;
      font: { postscriptName: string };
      subset: { glyphs: number[] };
      document: unknown;
      dictionary: { data: Record<string, unknown> };
    };
  };
  try {
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.registerFont('__pdfArabicProbe__', AMIRI_REGULAR_BUFFER);
    // pdfkit's registerFont only stashes {src, family} in
    // _registeredFonts — the actual EmbeddedFont instance isn't
    // created until font() resolves the name. Force resolution so we
    // can grab the class via _font.constructor.
    doc.font('__pdfArabicProbe__');
    const probe = doc._font;
    if (!probe || typeof probe.embed !== 'function') return;
    EmbeddedFontClass = probe.constructor;
  } catch (_e) {
    return;
  }
  const origEmbed = EmbeddedFontClass.prototype.embed;
  if (typeof origEmbed !== 'function') return;
  EmbeddedFontClass.prototype.embed = function (this: {
    font: { postscriptName: string };
    subset: {
      glyphs: number[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      encode: () => any;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any;
  }): unknown {
    const ps = this.font.postscriptName;
    const fullBuf = FULL_EMBED_BUFFERS.get(ps);
    if (!fullBuf) {
      // Non-Amiri font (Helvetica's StandardFont path doesn't even
      // hit EmbeddedFont) — pass through.
      return origEmbed.call(this);
    }
    // (a) Force the subset to emit the FULL font bytes when pdfkit
    // calls `fontFile.end(this.subset.encode())` inside origEmbed.
    const origEncode = this.subset.encode.bind(this.subset);
    this.subset.encode = () => {
      // pdfkit wraps the result in `new Uint8Array(...)` indirectly;
      // returning a Uint8Array view of the full TTF buffer is safe.
      return new Uint8Array(fullBuf);
    };
    // (b) After origEmbed builds the dictionaries, override the
    // /CIDToGIDMap from 'Identity' (which would mis-route gids
    // because the embedded font is now full, not subset-ordered)
    // to a stream that maps each subset gid to its original Amiri
    // gid. Sourced from `subset.glyphs[]` per fontkit's Subset class.
    try {
      const result = origEmbed.call(this);
      // The descendant font dict was written inside origEmbed and
      // already flushed to PDF stream. We need to install the CIDToGIDMap
      // BEFORE origEmbed serializes the descendant dict — so swap
      // approach: redo origEmbed with a pre-built CIDToGIDMap ref.
      return result;
    } finally {
      this.subset.encode = origEncode;
    }
  };
  // The above attempts to override AFTER origEmbed but the dictionary
  // is already serialized. We need a different hook: pre-install the
  // CIDToGIDMap on the subset/dictionary BEFORE origEmbed runs.
  // Approach: monkey-patch the document.ref() factory locally inside
  // origEmbed to detect the descendant font dict and swap CIDToGIDMap.
  EmbeddedFontClass.prototype.embed = function (this: {
    font: { postscriptName: string };
    subset: {
      glyphs: number[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      encode: () => any;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    document: any;
  }): unknown {
    const ps = this.font.postscriptName;
    const fullBuf = FULL_EMBED_BUFFERS.get(ps);
    if (!fullBuf) return origEmbed.call(this);

    // (1) Build the CIDToGIDMap stream first. subset.glyphs is a list
    // of original Amiri gids in subset order. Position i in the
    // array = the i-th included glyph's original Amiri gid. The
    // CIDToGIDMap stream is a flat array of 2-byte big-endian gids
    // indexed by subset gid (the CID under /Identity-H encoding).
    const glyphs = this.subset.glyphs;
    const cidToGidBytes = Buffer.alloc(glyphs.length * 2);
    for (let i = 0; i < glyphs.length; i++) {
      cidToGidBytes.writeUInt16BE(glyphs[i] & 0xffff, i * 2);
    }
    const cidToGidRef = this.document.ref({});
    cidToGidRef.write(cidToGidBytes);
    cidToGidRef.end();

    // (2) Force the FontFile2 stream contents to be the FULL Amiri TTF.
    const origEncodeFn = this.subset.encode.bind(this.subset);
    this.subset.encode = () => new Uint8Array(fullBuf);

    // (3) Wrap document.ref() once: when origEmbed creates the
    // descendant font dict (which has /CIDToGIDMap = 'Identity'),
    // replace it with our stream ref.
    const origRef = this.document.ref.bind(this.document);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.document.ref = function (data: any) {
      if (
        data &&
        data.Type === 'Font' &&
        data.CIDToGIDMap === 'Identity'
      ) {
        data.CIDToGIDMap = cidToGidRef;
      }
      return origRef(data);
    };
    try {
      return origEmbed.call(this);
    } finally {
      this.subset.encode = origEncodeFn;
      this.document.ref = origRef;
    }
  };
  PDFDocument.prototype.__pdfArabicFullEmbedPatched = true;
})();

// Per-script-run inline emission helper. See architecture banner at top
// of file for the full rationale. Two key properties:
//
//   1. Each run's CHARS stay in LOGICAL order. fontkit's auto-direction
//      (RTL for Arabic, LTR for Latin) then handles per-run shaping +
//      reversal. Joining context preserved because Arabic-script lookups
//      use logical adjacency.
//
//   2. Runs are returned in VISUAL order (left-to-right on the page).
//      The caller emits them as inlines in this order so pdfmake's L→R
//      inline placement matches what an Arabic reader expects.
//
// Implementation: walk the bidi levels array to group adjacent same-level
// chars into LOGICAL runs, then apply UAX #9 §3.4 line-level reordering
// (reverse spans of runs at the highest odd level, then at level 1) to
// get visual run order. We DO NOT reverse chars within runs — fontkit
// does that natively per-run.
export interface VisualRun {
  text: string;
  isRtl: boolean;
}

export function segmentToVisualRuns(text: string): VisualRun[] {
  if (!text) return [];

  const embed = BIDI.getEmbeddingLevels(text, 'rtl');
  const levels: number[] = embed.levels;

  // Group adjacent same-level chars into logical runs.
  interface LogicalRun {
    start: number;
    end: number; // exclusive
    level: number;
  }
  const logical: LogicalRun[] = [];
  let runStart = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || levels[i] !== levels[runStart]) {
      logical.push({ start: runStart, end: i, level: levels[runStart] });
      runStart = i;
    }
  }

  // UAX #9 §3.4 line-level reordering on the RUN sequence (chars within
  // each run stay in logical order — fontkit reverses them per-run).
  // From max level down to 1, reverse contiguous spans of runs at
  // >= current level.
  const visual = logical.slice();
  let maxLevel = 0;
  for (const r of visual) if (r.level > maxLevel) maxLevel = r.level;
  for (let lvl = maxLevel; lvl >= 1; lvl--) {
    let spanStart = -1;
    for (let i = 0; i <= visual.length; i++) {
      const inSpan = i < visual.length && visual[i].level >= lvl;
      if (inSpan && spanStart === -1) spanStart = i;
      if (!inSpan && spanStart !== -1) {
        const span = visual.slice(spanStart, i).reverse();
        visual.splice(spanStart, span.length, ...span);
        spanStart = -1;
      }
    }
  }

  // Chars stay in LOGICAL order within each run; NO mirror swap here —
  // segmentation is a pure primitive. Mirror swap + /ActualText
  // registration happen in `emitArabicParagraph` so we still have access
  // to the unswapped text for the /ActualText marker.
  return visual.map((r) => ({
    text: text.slice(r.start, r.end),
    isRtl: r.level % 2 === 1,
  }));
}

/**
 * Minimal pdfmake-VFS adapter. pdfmake calls `.existsSync(path)` and
 * `.readFileSync(path)` on whatever is passed as the 2nd PdfPrinter arg.
 */
class FontVfs {
  constructor(private readonly files: Record<string, Buffer>) {}
  existsSync(p: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.files, p);
  }
  readFileSync(p: string): Buffer {
    return this.files[p];
  }
}

export function arabicFontDescriptors() {
  return {
    // Latin family — uses pdfkit's built-in PDF base-14 Helvetica AFM.
    // NO embedding required (every spec-compliant PDF reader has Helvetica
    // metrics built in). Used by the export services for pure-Latin runs
    // (footer, page numbers, brand, meta labels, English contract chrome),
    // routing them away from the Amiri-subset path that triggered Acrobat
    // crashes on real Arabic exports. See lesson banner above + the
    // emitArabicParagraph routing logic.
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
    Amiri: {
      normal: 'Amiri-Regular.ttf',
      bold: 'Amiri-Bold.ttf',
      italics: 'Amiri-Regular.ttf',
      bolditalics: 'Amiri-Bold.ttf',
    },
  };
}

export function arabicVfs() {
  return new FontVfs({
    'Amiri-Regular.ttf': AMIRI_REGULAR_BUFFER,
    'Amiri-Bold.ttf': AMIRI_BOLD_BUFFER,
  });
}

// ─── Width constants (central, per §1 decision in plan) ──────────────────

/** A4 portrait width in points. pdfmake's default page size. */
export const A4_PAGE_WIDTH_PT = 595.28;

/**
 * Content width for the ExportService generators (pageMargins [40, 40, 40, 60]).
 *   595.28 (A4 width) - 40 (left) - 40 (right) = 515.28 pt
 */
export const EXPORT_BODY_WIDTH_PT = A4_PAGE_WIDTH_PT - 40 - 40;

/**
 * Content width for PortfolioExportRendererService (pageMargins [50, 60, 50, 80]).
 *   595.28 (A4 width) - 50 (left) - 50 (right) = 495.28 pt
 */
export const PORTFOLIO_BODY_WIDTH_PT = A4_PAGE_WIDTH_PT - 50 - 50;

/**
 * Conservative per-cell width fallback for tables with 'auto' or '*' column
 * widths (pdfmake computes those at render time so we don't know the exact
 * width up-front). v1: split body width evenly across columns, then subtract
 * a small padding safety margin.
 *
 * KNOWN LIMITATION (per plan §8 effort estimate): if a table has wildly
 * unequal column allocations (e.g. one '*' wide column with three narrow
 * 'auto' columns), this estimate over-wraps the wide column or under-wraps
 * the narrow ones. First real edge case to harden if multi-line wrap inside
 * table cells bites in production — replace with a proper auto-layout
 * simulator that mirrors pdfmake's own widths algorithm.
 */
export function tableCellWidthFallback(
  bodyWidthPt: number,
  numColumns: number,
): number {
  const cellPaddingSafetyPt = 12;
  return bodyWidthPt / Math.max(numColumns, 1) - cellPaddingSafetyPt;
}

// ─── Identity-passthrough prepareArabicText (kept for backward compat) ───

/**
 * Identity passthrough kept for any caller that needs the OLD "transform a
 * string into a different string for pdfmake's text node" shape. New code
 * should use `emitArabicParagraph` instead — that's the one that handles
 * the noWrap-stack wrapping that fixes word-level RTL ordering.
 *
 * Null / undefined collapse to ''. Everything else returns unchanged.
 */
export function prepareArabicText(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return text;
}

// ─── Per-block style hint ────────────────────────────────────────────────

/**
 * Style hint for callers that emit a single text node (NOT a wrap-stack).
 * Returns `{ font: 'Amiri', alignment: 'right' }` for Arabic content, just
 * `{ font: 'Amiri' }` for Latin. Spread into a text node:
 *
 *   { text: prepareArabicText(s), ...arabicTextStyle(s) }
 *
 * For multi-line Arabic content, use `emitArabicParagraph` instead — it
 * applies alignment per emitted line directly.
 */
export function arabicTextStyle(text: unknown): {
  font: 'Amiri';
  alignment?: 'right';
} {
  return containsArabic(text)
    ? { font: 'Amiri', alignment: 'right' }
    : { font: 'Amiri' };
}

// ─── Arabic-Indic digit conversion (heading prefix shape) ────────────────

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/** Convert ASCII digits in `s` to Arabic-Indic digits (U+0660–U+0669). */
function toArabicIndic(s: string): string {
  return s.replace(/\d/g, (d) => ARABIC_INDIC[Number(d)]);
}

/**
 * Build a numbered-heading title string.
 *
 *   - Latin title:   `"3. Foo bar"`
 *   - Arabic title:  `"٣. المحاسبة على الاعمال"` (Arabic-Indic digit)
 *
 * The Option-A architecture means we do NOT word-reverse anymore. The
 * heading is emitted via `emitArabicParagraph` (or directly with
 * `noWrap: true`), so the WHOLE heading reaches fontkit as a single
 * layout call — fontkit's UAX #9 bidi places the Arabic-Indic digit at
 * the visual right edge automatically.
 *
 * Empty / null inputs collapse defensively: a number with no title yields
 * '' (no dangling prefix); a title with no number yields the title as-is.
 */
export function arabicHeadingText(
  numberOrPrefix: string | number | null | undefined,
  title: string | null | undefined,
): string {
  const num =
    numberOrPrefix === null || numberOrPrefix === undefined
      ? ''
      : String(numberOrPrefix);
  const t = title ?? '';
  if (!num) return t;
  if (!t) return '';
  if (!containsArabic(t)) return `${num}. ${t}`;
  return `${toArabicIndic(num)}. ${t}`;
}

// ─── Measurement + wrapping ──────────────────────────────────────────────

/**
 * Measure `text`'s advance width in points when rendered with Amiri at
 * `fontSizePt`. Uses the same fontkit engine pdfkit uses internally, so the
 * returned width matches what pdfmake will measure at render time.
 *
 * Width formula:
 *   width_pt = (advanceWidth_fontUnits / unitsPerEm) * fontSize_pt
 */
function measureWidthPt(
  text: string,
  fontSizePt: number,
  isBold: boolean,
): number {
  if (!text) return 0;
  const font = isBold ? AMIRI_BOLD_FONT : AMIRI_REGULAR_FONT;
  const run = font.layout(text);
  return (run.advanceWidth / font.unitsPerEm) * fontSizePt;
}

/**
 * Pre-wrap an Arabic-bearing paragraph into visual lines that each fit
 * within `maxWidthPt`. Each returned line is intended to be emitted as a
 * `noWrap: true` text node so fontkit lays it out as a single bidi-correct
 * run.
 *
 *   - Latin / empty input: returns `[text]` (single-line passthrough).
 *   - Arabic input: greedy line-packing at Unicode line-break candidates
 *     (`linebreak` package — same one pdfmake uses for its own tokenizer).
 *
 * A 2pt safety margin is subtracted from `maxWidthPt` before comparing,
 * absorbing any micro-drift between per-word and per-line measurements.
 *
 * Words remain in LOGICAL order — fontkit applies UAX #9 bidi within each
 * emitted line at render time, producing correct visual word order.
 *
 * @param text         The paragraph to wrap.
 * @param fontSizePt   The point size the line will be rendered at.
 * @param maxWidthPt   The maximum line width in points.
 * @param isBold       Use Amiri-Bold metrics (different width per glyph).
 * @returns            Array of complete-line strings, no leading/trailing
 *                     whitespace, joined by the same word boundaries pdfmake
 *                     would have chosen.
 */
export function wrapArabicLines(
  text: string | null | undefined,
  fontSizePt: number,
  maxWidthPt: number,
  isBold = false,
): string[] {
  if (text === null || text === undefined || text === '') return [''];
  if (!containsArabic(text)) return [text];

  // Discover candidate break positions via the same Unicode line-break algo
  // pdfmake uses internally. Each "word" is the slice between adjacent
  // breaker positions.
  const words: string[] = [];
  const breaker = new LineBreaker(text);
  let lastPos = 0;
  let br: { position: number; required: boolean } | null;
  // eslint-disable-next-line no-cond-assign
  while ((br = breaker.nextBreak())) {
    const word = text.slice(lastPos, br.position);
    if (word.length > 0) words.push(word);
    lastPos = br.position;
  }
  if (words.length === 0) return [text];

  // Pre-measure each word once. Joining-induced kerning across word
  // boundaries in Arabic is negligible (words are space-separated and
  // Arabic letters don't join across spaces by Unicode rules).
  const widths = words.map((w) => measureWidthPt(w, fontSizePt, isBold));

  // Safety margin: absorb any micro-drift between per-word measurement and
  // the joined-line render. Empirically 2pt is plenty for Amiri at 10–14pt.
  const safeWidthPt = Math.max(0, maxWidthPt - 2);

  const lines: string[] = [];
  let currentLine = '';
  let currentWidth = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const w = widths[i];
    if (currentLine === '') {
      // First word on the line — always accept it even if it overflows
      // (a single super-long word: v1 accepts overflow rather than mid-word
      // break — see banner caveats).
      currentLine = word;
      currentWidth = w;
      continue;
    }
    if (currentWidth + w <= safeWidthPt) {
      currentLine += word;
      currentWidth += w;
    } else {
      lines.push(currentLine.replace(/\s+$/, ''));
      // Carry-over: the new line starts with the current word, which already
      // begins with whitespace (the line-break boundary is BEFORE the word's
      // leading space). Strip leading whitespace at line start.
      currentLine = word.replace(/^\s+/, '');
      currentWidth = measureWidthPt(currentLine, fontSizePt, isBold);
    }
  }
  if (currentLine !== '') lines.push(currentLine.replace(/\s+$/, ''));

  return lines.length > 0 ? lines : [text];
}

// ─── The single call-site shape for the 3 PDF generators ─────────────────

/**
 * Extra pdfmake properties (style, margin, etc.) merged into the emitted
 * text-node or stack. `font` and `alignment` are handled by the helper for
 * Arabic content and should NOT be passed here unless the caller wants to
 * override.
 */
export type ArabicParagraphExtras = Record<string, unknown>;

/**
 * Emit a pdfmake docDefinition node for `text`, choosing between:
 *
 *   - Latin / empty content → a single `{ text, ...extras }` node, identical
 *     behavior to the previous direct-emit shape (no regression risk).
 *
 *   - Arabic content → a `{ stack: [...] }` of pre-wrapped lines, each with
 *     `noWrap: true` + `alignment: 'right'`. Each emitted line reaches
 *     fontkit as a single paragraph so UAX #9 bidi produces correct visual
 *     word order with the rightmost glyph hugging the right margin.
 *
 *   - Arabic content that fits in one line → a single `{ text, noWrap: true,
 *     alignment: 'right', ...extras }` node. Same result without wrapping
 *     in a `stack` (smaller doc-def, identical render).
 *
 * @param text          The text to render.
 * @param fontSizePt    Point size — must match what the named `style` (if
 *                      any) in `extras` defines, otherwise widths will drift.
 * @param maxWidthPt    Available width for wrapping. Use one of the central
 *                      constants (EXPORT_BODY_WIDTH_PT etc.) or
 *                      `tableCellWidthFallback` for cells.
 * @param isBold        Use Amiri-Bold metrics. Match the style's `bold` flag.
 * @param extras        Other pdfmake props (style, margin, color, etc.).
 *                      Applied to the OUTER node (the stack as a whole, or
 *                      the single text node).
 */
export function emitArabicParagraph(
  text: string | null | undefined,
  fontSizePt: number,
  maxWidthPt: number,
  isBold: boolean,
  extras: ArabicParagraphExtras = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const safe = text ?? '';
  if (!containsArabic(safe)) {
    // Pure-Latin / empty content: keep callers' explicit extras (style,
    // margin, color, etc.) and route the text through pdfkit's
    // base-14 Helvetica AFM path — NO embedded font, no fontkit
    // subset to mis-parse. The export services set `defaultStyle.font
    // = 'Helvetica'`, so a missing `font` here inherits correctly;
    // we set it explicitly anyway so the helper is self-contained.
    return { text: safe, font: 'Helvetica', ...extras };
  }
  // CRITICAL: set fontSize EXPLICITLY on each Arabic-emitted node so the
  // wrap math (computed at `fontSizePt`) is guaranteed to match what
  // pdfkit actually renders. Without this, a caller that forgets to set
  // a named style or a defaultStyle fontSize gets pdfmake's built-in
  // default (12pt) — at which point the rendered line is wider than the
  // wrap helper measured, and the line overflows.
  //
  // CRITICAL (Option A activator): `fontFeatures: []` is the SINGLE knob
  // that bypasses pdfkit's `EmbeddedFont.layout()` space-splitting path
  // (which calls fontkit per-chunk and concatenates results in logical
  // order — destroying paragraph-level bidi). With `features` truthy,
  // pdfkit routes through `layoutRun(text, features)` which calls
  // fontkit.layout() ONCE on the whole string. Empirically verified:
  // without it, "٣. المحاسبة على الاعمال" renders with ٣ on the LEFT
  // (rightmost cp = U+0627 alif, the title's last letter). With
  // `fontFeatures: []`, ٣ correctly lands at the rightmost position.
  // The empty array is enough — fontkit applies Arabic GSUB shaping
  // automatically by script detection.
  const lines = wrapArabicLines(safe, fontSizePt, maxWidthPt, isBold);

  // Per emitted line: split into directional runs in VISUAL ORDER (chars
  // within each run stay in LOGICAL order so fontkit can shape Arabic
  // correctly per-run). Each run becomes its own inline in the line's
  // `text: [...]` array. pdfmake places them L→R at increasing X.
  //   - Arabic runs: noWrap + fontFeatures:[] forces fontkit's whole-run
  //     layout (so cross-character bidi within the run works AND the
  //     joining context is preserved). fontkit auto-detects RTL and
  //     reverses the glyph order internally.
  //   - LTR (Latin/digit) runs: plain text node. fontkit auto-detects LTR.
  //
  // The OUTER line node carries `alignment: 'right'` + `fontSize` so the
  // block hugs the right margin and uses the wrap-math-matching size.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineNodeFor = (line: string): any => {
    const runs = segmentToVisualRuns(line);
    if (runs.length === 0) {
      return { text: '', fontSize: fontSizePt, alignment: 'right' };
    }
    // Build per-script-run inlines (rendering — unchanged). Per-fragment
    // /ActualText is GONE in the whole-line redesign — runs no longer
    // carry their own /ActualText. The single whole-line wrap below is
    // the only /ActualText emitted per line, so PDF readers return the
    // FULL logical line verbatim regardless of internal fragment ordering.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runInlines: any[] = runs.map((r) => {
      // A run needs the noWrap+features:[] whole-run shaping path if
      // EITHER (i) bidi-js classified it RTL, OR (ii) it contains any
      // Arabic-block codepoint. (ii) catches Arabic-Indic digits that
      // bidi-js puts in a level-2 LTR-in-RTL run but fontkit's script
      // detection still treats as RTL — without noWrap, the digits would
      // get split by pdfmake's tokenizer and lose cross-char bidi.
      const needsArabicPath = r.isRtl || containsArabic(r.text);
      if (!needsArabicPath) {
        // Latin run inside an Arabic-bearing line — route to Helvetica
        // explicitly so the Latin glyphs come from pdfkit's base-14 AFM
        // path (NO Amiri-subset, NO Acrobat crash). The export services
        // also default to Helvetica, so this is the consistent choice.
        return { text: r.text, font: 'Helvetica' };
      }
      // Apply Option B bracket-mirror swap so the rendered glyph has
      // the Arabic-reader-correct concavity. The whole-line /ActualText
      // wrap (below) carries the UNSWAPPED logical line, so PDF text
      // extraction returns logical codepoints regardless of the swap.
      // EXPLICIT `font: 'Amiri'` on every Arabic inline — the export
      // services' `defaultStyle.font` is `Helvetica` after the
      // 2026-06-24 routing fix, so Arabic runs must opt back in to
      // Amiri so they don't inherit Helvetica (which has no Arabic
      // coverage).
      const text = r.text;
      const swapped = hasMirrorables(text) ? swapMirrorChars(text) : text;
      return {
        text: swapped,
        font: 'Amiri',
        noWrap: true,
        fontFeatures: [],
      };
    });
    // Whole-line /ActualText: emit ONE marker per line, ONLY when the
    // line contains any Arabic-block content. LTR-only lines extract
    // verbatim from the CMap and don't need a wrap.
    //
    // Sentinels are PREPENDED to the FIRST run's text and APPENDED to
    // the LAST run's text — they ride INSIDE the body chars of those
    // runs so pdfmake's tokenizer keeps them alive (standalone
    // zero-width inlines get silently dropped — empirically verified).
    // The monkey-patch strips the sentinel chars BEFORE calling pdfkit's
    // original `_fragment`, so the rendered glyph stream is byte-identical
    // to the no-wrap version.
    if (containsArabic(line) && runInlines.length > 0) {
      registerLineActualText(line);
      // Prepend START to the first inline's text; append END to the last.
      // If first and last are the same inline (single-run line), apply both.
      const firstInline = runInlines[0];
      const lastInline = runInlines[runInlines.length - 1];
      firstInline.text = ACTUAL_TEXT_START_SENTINEL + firstInline.text;
      // Ensure the inline taking the sentinel uses the noWrap+features:[]
      // path — that's the only path that hands the WHOLE inline text to
      // `_fragment` as one call (so the prefix is reliably detected).
      // RTL/Arabic runs are already on that path; an LTR-leading line
      // (rare under containsArabic(line)) would need it set explicitly.
      if (!firstInline.noWrap) {
        firstInline.noWrap = true;
        firstInline.fontFeatures = [];
      }
      lastInline.text = lastInline.text + ACTUAL_TEXT_END_SENTINEL;
      if (!lastInline.noWrap) {
        lastInline.noWrap = true;
        lastInline.fontFeatures = [];
      }
    }
    return {
      text: runInlines,
      fontSize: fontSizePt,
      alignment: 'right',
    };
  };

  if (lines.length <= 1) {
    const lineNode = lineNodeFor(lines[0] ?? safe);
    return { ...lineNode, ...extras };
  }
  return {
    stack: lines.map((line) => lineNodeFor(line)),
    ...extras,
  };
}
