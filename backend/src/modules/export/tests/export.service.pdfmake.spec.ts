import { ExportService } from '../export.service';

/**
 * Export PDF — renderer integration test (real pdfmake, no mock).
 *
 * Existence rationale: the other export specs in this directory mock the
 * PDF render path (or never reach it), so they pass regardless of whether
 * `createPdfBuffer` is actually wired to pdfmake correctly — the #135 trap
 * applied to the export renderer, and the #140 lesson that any service whose
 * RISK is the external library call itself needs at least one no-mock test.
 *
 * export.service.ts shipped with the legacy pdfmake v0.1.x pattern
 * (`require('pdfmake')` + `new PdfPrinter(...)`), which crashes with
 *   `TypeError: PdfPrinter is not a constructor`
 * on pdfmake@0.3.x (the installed version) because the main export is an
 * INSTANCE, not a class. A constructor-only fix then crashes with
 *   `Cannot read properties of undefined (reading 'resolve')`
 * because the v0.3.x constructor requires a URLResolver. This spec calls the
 * REAL `createPdfBuffer` with a small hand-built docDefinition and asserts the
 * bytes are a valid PDF (magic header + non-zero length). It FAILS on the old
 * v0.1.x pattern and PASSES once the d4dc54a-style fix is applied.
 */

// createPdfBuffer never touches the injected repositories; trivial stubs keep
// this a pure pdfmake-path test with no DB and no pdfmake mocks.
function makeService(): ExportService {
  return new ExportService({} as any, {} as any, {} as any);
}

// Bracket access — createPdfBuffer is private but is the exact pdfmake call
// path we need to exercise without a real contract / DB round-trip.
function renderPdf(service: ExportService, docDef: any): Promise<Buffer> {
  return (service as any).createPdfBuffer(docDef);
}

describe('ExportService.createPdfBuffer (real pdfmake — no mock)', () => {
  it('renders a valid PDF buffer for a minimal docDefinition', async () => {
    const service = makeService();

    const docDefinition = {
      content: [
        { text: 'SIGN Export Test', style: 'title' },
        { text: 'Contract PDF / risk-report / summary path.' },
      ],
      styles: {
        title: { fontSize: 18, bold: true },
      },
      defaultStyle: { font: 'Helvetica' },
    };

    const buffer = await renderPdf(service, docDefinition);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    // A real pdfmake-generated PDF is at least ~1KB even for a minimal doc
    // (fonts, structure, XRef table all take bytes).
    expect(buffer.length).toBeGreaterThan(1000);
    // PDF magic header — proves we got past pdfmake's render pipeline and
    // into pdfkit's actual byte emission.
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    // EOF marker — proves the stream finished cleanly rather than returning a
    // truncated/partial buffer.
    expect(buffer.subarray(-16).toString('utf8')).toContain('%%EOF');
  });

  it('renders a table-bearing docDefinition (mirrors the export layouts)', async () => {
    // The real export documents lean heavily on tables; stress that shape too
    // so a future refactor can't silently regress on it.
    const service = makeService();

    const docDefinition = {
      content: [
        { text: 'Risk Report', style: 'title' },
        {
          table: {
            widths: ['*', 'auto'],
            body: [
              [
                { text: 'Clause', bold: true },
                { text: 'Severity', bold: true },
              ],
              ['Payment terms', 'HIGH'],
              ['Liability cap', 'MEDIUM'],
            ],
          },
        },
      ],
      styles: { title: { fontSize: 18, bold: true } },
      defaultStyle: { font: 'Helvetica' },
    };

    const buffer = await renderPdf(service, docDefinition);

    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
