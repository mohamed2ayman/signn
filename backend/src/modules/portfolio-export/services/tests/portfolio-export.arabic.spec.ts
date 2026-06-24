import { Test } from '@nestjs/testing';
import { PortfolioExportRendererService } from '../portfolio-export-renderer.service';

/**
 * Portfolio Export PDF — Arabic rendering integration test (real pdfmake,
 * no mock). Companion to portfolio-export-renderer.service.spec.ts which
 * verifies sparse-data renders without throwing; this spec verifies the
 * Arabic helper (Amiri font + shaping + bidi) plugs into render() under
 * the same data shape with Arabic org / project / requester names and
 * Arabic per-project-risk rows.
 *
 * What this CAN prove:
 *   - Arabic-bearing context + per-project Arabic names render without throwing
 *   - The resulting PDF is structurally valid (%PDF magic + %%EOF tail)
 *   - The embedded font dictionary contains 'Amiri', not 'Helvetica'
 *
 * What this CANNOT prove (visual properties, eyeball-required):
 *   - Letter joining (initial/medial/final form selection)
 *   - Right-to-left reading order on the rendered page
 */

function arabicAnalytics() {
  return {
    period: '90d',
    project_id: null,
    kpis: {
      total_contracts: 3,
      active_contracts: 2,
      open_risks: 5,
      contracts_created: { current: 3, previous: 2, delta_pct: 50 },
      risks_flagged: { current: 5, previous: 4, delta_pct: 25 },
    },
    contracts_by_status: {
      total: 3,
      buckets: { DRAFT: 1, IN_APPROVAL: 0, WITH_COUNTERPARTY: 0, ACTIVE: 2, COMPLETED: 0, TERMINATED: 0 },
    },
    contracts_by_standard_form: { total: 3, forms: { FIDIC: 2, NEC: 1 } },
    risk_distribution: { total: 5, levels: { LOW: 1, MEDIUM: 2, HIGH: 2 } },
    // Arabic project names — high-risk path in the renderer.
    project_risk: [
      { project_name: 'مشروع البناء الأول', score: 8 },
      { project_name: 'الجسر الجديد', score: 5 },
    ],
    time_to_signature: {
      avg_days: 14,
      trend: [
        { month: '2026-04', avg_days: 12, count: 1 },
        { month: '2026-05', avg_days: 16, count: 2 },
      ],
    },
    value_by_currency: [{ currency: 'EGP', total: 5_000_000, contract_count: 3 }],
    upcoming_expirations: { within_30: 0, within_60: 1, within_90: 1, total: 2 },
    // Arabic project names in the top-projects table too.
    top_projects: [
      { project_name: 'مشروع البناء الأول', currency: 'EGP', total_value: 3_000_000, contract_count: 2 },
      { project_name: 'الجسر الجديد', currency: 'EGP', total_value: 2_000_000, contract_count: 1 },
    ],
  };
}

const ARABIC_CTX = {
  orgName: 'شركة الإنشاءات المصرية',
  requesterName: 'محمد عبد الله',
  requesterEmail: 'm.abdullah@example.com',
  period: '90d',
  projectName: 'مشروع البناء الأول',
  generatedAt: new Date('2026-06-22T10:00:00Z'),
};

async function makeRenderer(): Promise<PortfolioExportRendererService> {
  const mod = await Test.createTestingModule({
    providers: [PortfolioExportRendererService],
  }).compile();
  return mod.get(PortfolioExportRendererService);
}

describe('PortfolioExportRendererService Arabic rendering (real pdfmake — no mock)', () => {
  it('renders with Arabic org / project / requester names embedded in cover page', async () => {
    const renderer = await makeRenderer();

    const buffer = await renderer.render(arabicAnalytics(), ARABIC_CTX);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.subarray(-16).toString('utf8')).toContain('%%EOF');
    // Amiri must be embedded (Arabic content routes through it via the
    // emitArabicParagraph helper). Helvetica is ALSO present after the
    // 2026-06-24 Acrobat-strict font-routing fix — pure-Latin chrome
    // (footer, brand, English labels) goes through pdfkit's base-14
    // Helvetica AFM path. Both being in the PDF is the expected
    // post-fix shape; the prior `not.toContain('Helvetica')` reflected
    // the pre-fix design where Amiri handled Latin too (causing the
    // Acrobat subset crash).
    expect(buffer.toString('latin1')).toContain('Amiri');
    expect(buffer.toString('latin1')).toContain('Helvetica');
  });

  it('renders a Latin-only context as a regression guard — Helvetica is the chosen Latin font', async () => {
    const renderer = await makeRenderer();

    const latinCtx = {
      orgName: 'SIGN Test Org',
      requesterName: 'John Doe',
      requesterEmail: 'j.doe@example.com',
      period: '90d',
      projectName: 'Construction Project Alpha',
      generatedAt: new Date('2026-06-22T10:00:00Z'),
    };

    const latinAnalytics = {
      ...arabicAnalytics(),
      project_risk: [
        { project_name: 'Construction Project Alpha', score: 8 },
        { project_name: 'New Bridge', score: 5 },
      ],
      top_projects: [
        { project_name: 'Construction Project Alpha', currency: 'USD', total_value: 3_000_000, contract_count: 2 },
        { project_name: 'New Bridge', currency: 'USD', total_value: 2_000_000, contract_count: 1 },
      ],
    };

    const buffer = await renderer.render(latinAnalytics, latinCtx);

    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.subarray(-16).toString('utf8')).toContain('%%EOF');
    expect(buffer.length).toBeGreaterThan(1000);
    // Latin-only doc: Helvetica must be in the PDF (the new default
    // Latin font). Amiri may also be there if the renderer touches
    // any Arabic-helper code path; that's allowed but not asserted.
    expect(buffer.toString('latin1')).toContain('Helvetica');
  });
});
