import { ExportService } from '../export.service';
import * as pdfArabic from '../../../common/utils/pdf-arabic';

/**
 * Guest version review — Sub-slice 2a, PART A (export leak fix, unit).
 *
 * generateContractPdf hydrates `contract.contract_clauses` and renders them.
 * The fix excludes guest-proposed clauses (is_proposed=true) in-memory, so the
 * host's exported PDF never contains them. `arabicHeadingText` is invoked once
 * per RENDERED clause (export.service render loop), so its call count is the
 * rendered-clause count — the cleanest signal that the proposed clause was
 * filtered out. The real pdfmake render (`createPdfBuffer`) is stubbed: this
 * isolates the filter (no fonts / no Postgres needed → runs in CI).
 *
 * RED (no filter): arabicHeadingText called twice (live + proposed).
 * GREEN (filter):  arabicHeadingText called once (live only).
 */
describe('ExportService.generateContractPdf — proposed-clause leak fix (unit)', () => {
  const makeContract = () => ({
    id: 'c1',
    name: 'Export Contract',
    contract_type: 'FIDIC_RED_BOOK',
    status: 'ACTIVE',
    created_at: new Date('2026-01-01T00:00:00Z'),
    project: { name: 'Proj' },
    creator: { first_name: 'A', last_name: 'B' },
    contract_clauses: [
      {
        id: 'cc-live',
        order_index: 0,
        section_number: '1',
        is_proposed: false,
        clause: { title: 'Live Clause', content: 'live body' },
      },
      {
        id: 'cc-proposed',
        order_index: 0,
        section_number: '1',
        is_proposed: true,
        clause: { title: 'Proposed Clause', content: 'proposed body' },
      },
    ],
  });

  it('GREEN — renders ONLY the live clause; the proposed clause is excluded', async () => {
    const contractRepo = { findOne: jest.fn().mockResolvedValue(makeContract()) };
    const svc = new ExportService(contractRepo as any, {} as any, {} as any);

    // Stub the real pdfmake render — we are testing the filter, not pdfkit.
    const createBuffer = jest
      .spyOn(svc as any, 'createPdfBuffer')
      .mockResolvedValue(Buffer.from('%PDF-stub'));
    // Spy (keep real impl) — count = number of clauses actually rendered.
    const heading = jest.spyOn(pdfArabic, 'arabicHeadingText');
    heading.mockClear();

    const out = await svc.generateContractPdf('c1');

    expect(Buffer.isBuffer(out)).toBe(true);
    expect(createBuffer).toHaveBeenCalledTimes(1);
    // EXACTLY one clause rendered — the live one. The proposed clause is gone.
    expect(heading).toHaveBeenCalledTimes(1);
    expect(heading.mock.calls[0][1]).toBe('Live Clause');
    expect(
      heading.mock.calls.some((call) => call[1] === 'Proposed Clause'),
    ).toBe(false);

    heading.mockRestore();
  });
});
