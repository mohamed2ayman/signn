import * as zlib from 'zlib';

import { ExportService } from '../export.service';

/**
 * Feature #3 — Guest Watermarked Download: watermark wiring + render proof.
 *
 * Two independent guarantees, both deterministic and PG-free:
 *
 *  1. WIRING (docDef layer) — `generateContractPdf(id, stamp)` injects a
 *     top-level `watermark.text === stamp`; `generateContractPdf(id)` (the
 *     managing-user path) injects NO `watermark` key at all. Proven by spying
 *     the private `createPdfBuffer` and inspecting the docDefinition it
 *     receives — immune to PDF stream compression.
 *
 *  2. RENDER (byte layer) — the REAL pdfmake path (no createPdfBuffer mock)
 *     produces a valid %PDF whose content stream actually carries the stamp
 *     email (proving the watermark is really drawn, not just present in the
 *     doc). The managing-path render carries NO 'CONFIDENTIAL' marker. This is
 *     the #140 no-mock discipline applied to the watermark.
 *
 * The watermark is rendered with the doc's default font (Helvetica — a
 * standard-14, non-subsetted font), so its text appears as literal WinAnsi in
 * the (Flate-compressed) content stream. `pdfContainsText` inflates every
 * FlateDecode stream and searches, so the pure-ASCII email substring survives.
 */

/** Byte-scan every `stream`…`endstream` body out of the PDF. */
function extractStreams(pdf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  const S = Buffer.from('stream');
  const E = Buffer.from('endstream');
  let i = 0;
  for (;;) {
    const s = pdf.indexOf(S, i);
    if (s < 0) break;
    let start = s + S.length;
    if (pdf[start] === 0x0d) start++;
    if (pdf[start] === 0x0a) start++;
    const e = pdf.indexOf(E, start);
    if (e < 0) break;
    let end = e;
    if (pdf[end - 1] === 0x0a) end--;
    if (pdf[end - 1] === 0x0d) end--;
    out.push(pdf.subarray(start, end));
    i = e + E.length;
  }
  return out;
}

/**
 * Search the drawn text of a PDF. pdfmake/pdfkit writes text as hex strings
 * inside TJ arrays (`[<5369676e> 0] TJ`), frequently kern-split — so a literal
 * substring search on the raw/inflated bytes fails. This inflates every stream,
 * decodes every `<hex>` token, and concatenates, reconstructing the drawn text
 * regardless of kerning.
 */
function pdfContainsText(pdf: Buffer, needle: string): boolean {
  let content = pdf.toString('latin1');
  for (const s of extractStreams(pdf)) {
    try {
      content += zlib.inflateSync(s).toString('latin1');
    } catch {
      // not a Flate stream — skip
    }
  }
  if (content.includes(needle)) return true;
  let decoded = '';
  const reHex = /<([0-9A-Fa-f\s]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = reHex.exec(content)) !== null) {
    const hex = m[1].replace(/\s+/g, '');
    if (hex.length >= 2 && hex.length % 2 === 0) {
      try {
        decoded += Buffer.from(hex, 'hex').toString('latin1');
      } catch {
        // skip non-decodable token
      }
    }
  }
  return decoded.includes(needle);
}

const CONTRACT: any = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Watermark Test Contract',
  contract_type: 'FIDIC_RED_BOOK',
  status: 'ACTIVE',
  created_at: new Date('2026-01-15T00:00:00Z'),
  project: { name: 'Test Project' },
  creator: { first_name: 'Managing', last_name: 'User' },
  contract_clauses: [
    {
      order_index: 0,
      section_number: '1',
      clause: { title: 'Payment Terms', content: 'Paid within 28 days.' },
    },
  ],
};

const GUEST_EMAIL = 'guest.party@example.com';
const STAMP = `CONFIDENTIAL — ${GUEST_EMAIL} — Thu, 01 Jan 2026 00:00:00 GMT`;

// createPdfBuffer + generateContractPdf only touch the Contract repo; the two
// scoped repos are unused by generateContractPdf, so trivial stubs suffice.
function makeService(): ExportService {
  const contractRepo = { findOne: jest.fn().mockResolvedValue(CONTRACT) };
  return new ExportService(contractRepo as any, {} as any, {} as any);
}

describe('ExportService.generateContractPdf — watermark wiring (docDef layer)', () => {
  it('injects NO watermark on the managing path (no watermarkText)', async () => {
    const service = makeService();
    const spy = jest
      .spyOn(service as any, 'createPdfBuffer')
      .mockResolvedValue(Buffer.from('%PDF-stub'));

    await service.generateContractPdf(CONTRACT.id);

    const docDef = spy.mock.calls[0][0] as any;
    expect(docDef).toBeDefined();
    expect('watermark' in docDef).toBe(false);
    expect(docDef.watermark).toBeUndefined();
  });

  it('injects the exact caller-supplied stamp as the watermark text', async () => {
    const service = makeService();
    const spy = jest
      .spyOn(service as any, 'createPdfBuffer')
      .mockResolvedValue(Buffer.from('%PDF-stub'));

    await service.generateContractPdf(CONTRACT.id, STAMP);

    const docDef = spy.mock.calls[0][0] as any;
    expect(docDef.watermark).toBeDefined();
    expect(docDef.watermark.text).toBe(STAMP);
    // Light-enough-to-read-under defaults.
    expect(docDef.watermark.opacity).toBeLessThanOrEqual(0.4);
  });
});

describe('ExportService.generateContractPdf — real render (no-mock byte layer)', () => {
  it('renders a valid %PDF that actually carries the stamp email', async () => {
    const service = makeService();

    const buffer = await service.generateContractPdf(CONTRACT.id, STAMP);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.subarray(-16).toString('utf8')).toContain('%%EOF');
    // The watermark is REALLY drawn — the email shows up in the content stream.
    expect(pdfContainsText(buffer, GUEST_EMAIL)).toBe(true);
  });

  it('managing-path render carries NO watermark marker', async () => {
    const service = makeService();

    const buffer = await service.generateContractPdf(CONTRACT.id);

    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdfContainsText(buffer, 'CONFIDENTIAL')).toBe(false);
    expect(pdfContainsText(buffer, GUEST_EMAIL)).toBe(false);
  });
});
