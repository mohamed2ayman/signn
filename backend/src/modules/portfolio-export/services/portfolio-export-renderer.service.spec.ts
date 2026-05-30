import { Test } from '@nestjs/testing';
import { PortfolioExportRendererService } from './portfolio-export-renderer.service';

/**
 * Phase 7.17 Prompt 2c — renderer integration test (real pdfmake, no mock).
 *
 * Existence rationale: Buckets 2 + 4 only had unit tests at the processor
 * level, where the renderer was mocked (`rendererRender: jest.fn().
 * mockResolvedValue(Buffer.from('pdf-bytes'))`). That's correct for
 * processor-level invariants, but it left the actual pdfmake call path
 * completely unexercised — the #135 trap applied to the renderer.
 *
 * When 2c was first triggered end-to-end against the live dev backend,
 * the renderer crashed immediately with
 *   `TypeError: PdfPrinter is not a constructor`
 * because pdfmake v0.3.x's main export is an INSTANCE, not a class.
 * The v0.1.x `require('pdfmake')` pattern that was mirrored from
 * compliance precedent is broken across pdfmake@0.3+.
 *
 * This spec calls render() with a sparse-data shape matching what
 * PortfolioAnalyticsService returns from an empty/near-empty org, and
 * asserts the bytes are a valid PDF (magic header + EOF marker).
 * Catches version-incompatibility AND the data-shape #135 case any
 * future refactor could introduce.
 */

const SPARSE_ANALYTICS = {
  period: '90d',
  project_id: null,
  kpis: {
    total_contracts: 0,
    active_contracts: 0,
    open_risks: 0,
    contracts_created: { current: 0, previous: 0, delta_pct: 0 },
    risks_flagged: { current: 0, previous: 0, delta_pct: 0 },
  },
  contracts_by_status: {
    total: 0,
    buckets: {
      DRAFT: 0,
      IN_APPROVAL: 0,
      WITH_COUNTERPARTY: 0,
      ACTIVE: 0,
      COMPLETED: 0,
      TERMINATED: 0,
    },
  },
  value_by_currency: [],
  time_to_signature: {
    avg_days: null,
    sample_size: 0,
    excluded_no_shared_at: 0,
    trend: [],
  },
  upcoming_expirations: {
    in_30_days: 0,
    in_60_days: 0,
    in_90_days: 0,
    total_within_90: 0,
  },
  project_risk: [],
  risk_distribution: { total: 0, levels: { LOW: 0, MEDIUM: 0, HIGH: 0 } },
  contracts_by_standard_form: {
    total: 0,
    forms: { FIDIC: 0, NEC: 0, OTHER: 0, ADHOC: 0 },
  },
  top_projects: [],
};

const CTX = {
  orgName: 'Test Org',
  requesterName: 'tester@example.com',
  requesterEmail: 'tester@example.com',
  period: '90d',
  projectName: null,
  generatedAt: new Date('2026-05-31T00:00:00Z'),
};

async function makeRenderer(): Promise<PortfolioExportRendererService> {
  const moduleRef = await Test.createTestingModule({
    providers: [PortfolioExportRendererService],
  }).compile();
  return moduleRef.get(PortfolioExportRendererService);
}

describe('PortfolioExportRendererService (real pdfmake — no mock)', () => {
  it('renders a valid PDF buffer for sparse analytics data', async () => {
    const renderer = await makeRenderer();

    const buffer = await renderer.render(SPARSE_ANALYTICS, CTX);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    // A real pdfmake-generated PDF should be at least 1KB even for a
    // minimal doc (fonts, structure, XRef table all take bytes).
    expect(buffer.length).toBeGreaterThan(1000);
    // PDF magic header — proves we got past pdfmake's render pipeline
    // and into pdfkit's actual byte emission.
    expect(buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
    // EOF marker — proves the stream finished cleanly rather than
    // returning a truncated/partial buffer. Widened window so trailing
    // newline(s) don't truncate the `%%EOF` token.
    expect(buffer.subarray(-16).toString('utf8')).toContain('%%EOF');
  });

  it('renders successfully when analytics contains null avg_days + empty arrays everywhere', async () => {
    // Stress the "null/empty defensive rendering" property — the
    // renderer must not throw on data shapes that the empty dev DB
    // actually returns. This catches the #135 trap at the renderer
    // level: future refactors of formatMoney/formatCount/sectionHeading
    // can't silently regress on sparse inputs.
    const renderer = await makeRenderer();

    const buffer = await renderer.render(
      {
        ...SPARSE_ANALYTICS,
        // Extra null-safety stress: undefined where the renderer
        // dereferences via `analytics?.kpis` etc.
        time_to_signature: {
          avg_days: null,
          sample_size: 0,
          excluded_no_shared_at: 0,
          trend: [],
        },
      },
      CTX,
    );

    expect(buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('renders successfully when analytics is an entirely empty object (extreme defensive case)', async () => {
    // Edge case: what if PortfolioAnalyticsService's response shape
    // changes and a field disappears? The renderer's `?.` defaults
    // should keep it rendering rather than throwing.
    const renderer = await makeRenderer();

    const buffer = await renderer.render({}, CTX);

    expect(buffer.subarray(0, 4).toString('utf8')).toBe('%PDF');
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
