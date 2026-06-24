import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
// Arabic PDF rendering: Option A — pre-measure + pre-wrap. Multi-line
// Arabic content is emitted as a stack of noWrap text nodes so fontkit
// gets each line as one paragraph (correct UAX #9 bidi for word order +
// digit anchoring). Latin content passes through identity in the helper.
// See pdf-arabic.ts banner for the full diagnosis and architecture.
import {
  emitArabicParagraph,
  arabicFontDescriptors,
  arabicVfs,
  PORTFOLIO_BODY_WIDTH_PT,
  tableCellWidthFallback,
} from '../../../common/utils/pdf-arabic';

// pdfmake types are loose — match the convention from PdfReportService.
type DocDef = any;

const BRAND = {
  primary: '#4F6EF7',
  dark: '#0F1729',
  muted: '#6B7280',
  light: '#F8FAFF',
  red: '#DC2626',
  amber: '#D97706',
  green: '#059669',
};

/**
 * Phase 7.17 Prompt 2c Bucket 2 — portfolio analytics PDF renderer.
 *
 * Mirrors PdfReportService's shell (cover page, watermark, confidentiality
 * footer + page numbers, ownerPassword + permissions block — printing
 * allowed, edit/copy/annotate denied). Diverges in:
 *   - content sections (one per portfolio widget rather than the
 *     compliance findings layers)
 *   - EN-only labels and section headings (our own copy). User-supplied
 *     text (org / project / requester names, project_name in the per-project
 *     widgets) flows through the shared `pdf-arabic` helper which shapes +
 *     bidi-reorders Arabic codepoints under the embedded Amiri font (the
 *     prior "Arabic glyph wall deferred to v2" note is now resolved).
 *   - Latin numerals + ISO currency codes everywhere (#137) including
 *     the cover page, KPI table, value-per-currency rows, and any
 *     count cell — never `Intl.NumberFormat('ar-EG', ...)`.
 *
 * Input is the response from PortfolioAnalyticsService.getPortfolioAnalytics
 * (typed loose at the boundary — the renderer defends each field on read).
 * Sections that come from OTHER endpoints (AttentionStrip's 3 sources,
 * UpcomingObligationsList's `/obligations/portfolio?within=14`) are
 * intentionally absent from v1; they don't ride the 9 backend
 * aggregations that 2a's endpoint returns.
 */
export interface PortfolioRenderContext {
  /** Org display name for the cover page. */
  orgName: string;
  /** Requesting user (captured at request time). */
  requesterName: string;
  /** Requesting user's email (for the "Generated for" cover row). */
  requesterEmail: string;
  /** Period covered ('7d' | '30d' | '90d' | '365d'). */
  period: string;
  /** Optional project filter — null = whole-org snapshot. */
  projectName: string | null;
  /** Generation timestamp for the cover page + footer. */
  generatedAt: Date;
}

@Injectable()
export class PortfolioExportRendererService {
  private readonly logger = new Logger(PortfolioExportRendererService.name);

  /**
   * Render the portfolio analytics response to a PDF Buffer.
   * `analytics` is the response shape from PortfolioAnalyticsService —
   * typed `any` at the boundary so a sparse-data render never throws on
   * a missing optional widget.
   */
  async render(analytics: any, ctx: PortfolioRenderContext): Promise<Buffer> {
    const docDef = this.commonDoc(ctx);
    docDef.content.push(...this.kpisSection(analytics?.kpis));
    docDef.content.push(...this.statusSection(analytics?.contracts_by_status));
    docDef.content.push(...this.standardFormSection(analytics?.contracts_by_standard_form));
    docDef.content.push(...this.riskDistributionSection(analytics?.risk_distribution));
    docDef.content.push(...this.projectRiskSection(analytics?.project_risk));
    docDef.content.push({ text: '', pageBreak: 'before' });
    docDef.content.push(...this.timeToSignatureSection(analytics?.time_to_signature));
    docDef.content.push(...this.valueByCurrencySection(analytics?.value_by_currency));
    docDef.content.push(...this.expirationsSection(analytics?.upcoming_expirations));
    docDef.content.push(...this.topProjectsSection(analytics?.top_projects));
    return this.toBuffer(docDef);
  }

  // ─── Cover-page shell + page chrome (mirrors PdfReportService) ─────

  private commonDoc(ctx: PortfolioRenderContext): DocDef {
    const date = ctx.generatedAt.toUTCString();
    const cover: any[] = [
      {
        margin: [0, 80, 0, 0],
        text: 'SIGN',
        fontSize: 36,
        bold: true,
        color: BRAND.primary,
        alignment: 'center',
      },
      {
        margin: [0, 4, 0, 60],
        text: 'Contract & Legal Intelligence',
        fontSize: 11,
        color: BRAND.muted,
        alignment: 'center',
      },
      {
        text: 'Portfolio Analytics Snapshot',
        fontSize: 26,
        bold: true,
        color: BRAND.dark,
        alignment: 'center',
        margin: [0, 0, 0, 40],
      },
      {
        margin: [60, 0, 60, 0],
        layout: 'noBorders',
        table: {
          widths: ['*', '*'],
          body: [
            [coverLabel('Organization'), coverValue(ctx.orgName)],
            [coverLabel('Project filter'), coverValue(ctx.projectName ?? 'All projects')],
            [coverLabel('Period covered'), coverValue(humanizePeriod(ctx.period))],
            [coverLabel('Generated'), coverValue(date)],
            [coverLabel('Generated by'), coverValue(`${ctx.requesterName} (${ctx.requesterEmail})`)],
          ],
        },
      },
      { text: '', pageBreak: 'after' },
    ];

    return {
      content: cover,
      pageSize: 'A4',
      pageMargins: [50, 60, 50, 80] as [number, number, number, number],
      // Helvetica default — PDF base-14 (no embedding). Pure-Latin chrome
      // inherits this; Arabic runs opt back into Amiri inside
      // `emitArabicParagraph`. Acrobat-strict fix (2026-06-24).
      defaultStyle: { font: 'Helvetica', fontSize: 10, color: BRAND.dark, lineHeight: 1.3 },
      header: () => null,
      background: (_currentPage: number, pageSize: any) => ({
        canvas: this.watermarkCanvas(pageSize.width, pageSize.height),
      }),
      footer: (currentPage: number, pageCount: number) => ({
        margin: [50, 20, 50, 20],
        columns: [
          {
            text:
              'This document is confidential and intended solely for the addressee. ' +
              `Generated by SIGN Platform on ${date}. Unauthorized distribution is prohibited.`,
            fontSize: 7,
            color: BRAND.muted,
            italics: true,
            width: '*',
          },
          {
            text: `Page ${currentPage} of ${pageCount}`,
            fontSize: 8,
            color: BRAND.muted,
            alignment: 'right',
            width: 80,
          },
        ],
      }),
      info: {
        title: 'Portfolio Analytics Snapshot',
        author: 'SIGN Platform',
        subject: 'Portfolio Analytics Snapshot',
        creator: 'SIGN Platform',
        producer: 'SIGN Platform',
      },
    };
  }

  // ─── Content sections ──────────────────────────────────────────────

  private kpisSection(kpis: any): any[] {
    const safe = kpis ?? {};
    const total = formatCount(safe.total_contracts);
    const active = formatCount(safe.active_contracts);
    const openRisks = formatCount(safe.open_risks);
    const created = formatCount(safe?.contracts_created?.current);
    const flagged = formatCount(safe?.risks_flagged?.current);
    return [
      sectionHeading('1. Key metrics'),
      {
        margin: [0, 12, 0, 12],
        layout: 'noBorders',
        table: {
          widths: ['*', '*', '*', '*', '*'],
          body: [
            [
              statBlock('Total contracts', total, BRAND.dark),
              statBlock('Active contracts', active, BRAND.dark),
              statBlock('Open risks', openRisks, BRAND.dark),
              statBlock('Contracts created', created, BRAND.dark),
              statBlock('Risks flagged', flagged, BRAND.dark),
            ],
          ],
        },
      },
      paragraph(
        'Period-over-period deltas (rolling, not calendar quarters) are shown on the live ' +
          'dashboard but omitted from this PDF snapshot for clarity. See /app/portfolio for live trends.',
      ),
    ];
  }

  private statusSection(contractsByStatus: any): any[] {
    const buckets = contractsByStatus?.buckets ?? {};
    const total = formatCount(contractsByStatus?.total);
    const rows: any[] = [
      [tableHeader('Status'), tableHeader('Count')],
      ...['DRAFT', 'IN_APPROVAL', 'WITH_COUNTERPARTY', 'ACTIVE', 'COMPLETED', 'TERMINATED'].map(
        (k) => [tableCell(k), tableCell(formatCount(buckets[k]))],
      ),
    ];
    return [
      sectionHeading('2. Contracts by status'),
      paragraph(`Total contracts: ${total}.`),
      table(rows, ['*', 100]),
    ];
  }

  private standardFormSection(standardForm: any): any[] {
    const forms = standardForm?.forms ?? {};
    const total = formatCount(standardForm?.total);
    const rows: any[] = [
      [tableHeader('Standard form'), tableHeader('Count')],
      ...['FIDIC', 'NEC', 'OTHER', 'ADHOC'].map((k) => [
        tableCell(k),
        tableCell(formatCount(forms[k])),
      ]),
    ];
    return [
      sectionHeading('3. Contracts by standard form'),
      paragraph(`Total contracts: ${total}.`),
      table(rows, ['*', 100]),
    ];
  }

  private riskDistributionSection(riskDist: any): any[] {
    const levels = riskDist?.levels ?? {};
    const total = formatCount(riskDist?.total);
    const rows: any[] = [
      [tableHeader('Risk level'), tableHeader('Count')],
      [tableCell('LOW'), tableCell(formatCount(levels.LOW))],
      [tableCell('MEDIUM'), tableCell(formatCount(levels.MEDIUM))],
      [tableCell('HIGH'), tableCell(formatCount(levels.HIGH))],
    ];
    return [
      sectionHeading('4. Risk distribution (org-wide)'),
      paragraph(`Total risks: ${total}.`),
      table(rows, ['*', 100]),
    ];
  }

  private projectRiskSection(projectRisk: any[]): any[] {
    const list = Array.isArray(projectRisk) ? projectRisk : [];
    if (list.length === 0) {
      return [
        sectionHeading('5. Per-project worst finding'),
        paragraph('No project-level risk findings in the selected scope.'),
      ];
    }
    const rows: any[] = [
      [tableHeader('Project'), tableHeader('Worst score')],
      ...list.map((p: any) => [tableCell(String(p?.project_name ?? '—')), tableCell(formatCount(p?.score))]),
    ];
    return [
      sectionHeading('5. Per-project worst finding'),
      table(rows, ['*', 100]),
    ];
  }

  private timeToSignatureSection(tts: any): any[] {
    const avgDays = tts?.avg_days;
    const sampleSize = formatCount(tts?.sample_size);
    const excluded = formatCount(tts?.excluded_no_shared_at);
    const trend = Array.isArray(tts?.trend) ? tts.trend : [];
    const headerRow = [
      sectionHeading('6. Time to signature'),
      paragraph(
        avgDays == null
          ? `No completed signatures in the sample (${sampleSize} qualifying contracts, ${excluded} excluded for missing shared_at).`
          : `Average review-to-signature interval: ${avgDays} day(s). Sample size: ${sampleSize}. Excluded for missing shared_at: ${excluded}.`,
      ),
    ];
    if (trend.length === 0) {
      return [...headerRow, paragraph('No monthly trend data available for the selected period.')];
    }
    const rows: any[] = [
      [tableHeader('Month'), tableHeader('Avg days'), tableHeader('Count')],
      ...trend.map((t: any) => [
        tableCell(String(t?.month ?? '—')),
        tableCell(t?.avg_days == null ? '—' : String(t.avg_days)),
        tableCell(formatCount(t?.count)),
      ]),
    ];
    return [...headerRow, table(rows, ['*', 100, 80])];
  }

  private valueByCurrencySection(valueByCurrency: any[]): any[] {
    const list = Array.isArray(valueByCurrency) ? valueByCurrency : [];
    if (list.length === 0) {
      return [
        sectionHeading('7. Value per currency'),
        paragraph(
          'No contract-value figures recorded for the selected scope. Contract value + currency are optional fields.',
        ),
      ];
    }
    const rows: any[] = [
      [tableHeader('Currency'), tableHeader('Total value'), tableHeader('Contracts')],
      ...list.map((v: any) => [
        tableCell(String(v?.currency ?? '—')),
        // Latin numerals + ISO currency code per #137 — no Intl.NumberFormat('ar-EG').
        tableCell(formatMoney(v?.total)),
        tableCell(formatCount(v?.contract_count)),
      ]),
    ];
    return [
      sectionHeading('7. Value per currency'),
      paragraph('No cross-currency totals (no FX in v1). Each currency is reported separately.'),
      table(rows, ['*', 150, 100]),
    ];
  }

  private expirationsSection(exp: any): any[] {
    const r30 = formatCount(exp?.in_30_days);
    const r60 = formatCount(exp?.in_60_days);
    const r90 = formatCount(exp?.in_90_days);
    const total = formatCount(exp?.total_within_90);
    return [
      sectionHeading('8. Upcoming contract expirations'),
      table(
        [
          [tableHeader('Window'), tableHeader('Count')],
          [tableCell('Within 30 days'), tableCell(r30)],
          [tableCell('Within 60 days'), tableCell(r60)],
          [tableCell('Within 90 days'), tableCell(r90)],
          [tableCell('Total within 90 days'), tableCell(total)],
        ],
        ['*', 100],
      ),
    ];
  }

  private topProjectsSection(topProjects: any[]): any[] {
    const list = Array.isArray(topProjects) ? topProjects : [];
    if (list.length === 0) {
      return [
        sectionHeading('9. Top projects by contract value'),
        paragraph('No projects with recorded contract value in the selected scope.'),
      ];
    }
    const rows: any[] = [
      [tableHeader('Project'), tableHeader('Currency'), tableHeader('Total value'), tableHeader('Contracts')],
      ...list.map((p: any) => [
        tableCell(String(p?.project_name ?? '—')),
        tableCell(String(p?.currency ?? '—')),
        tableCell(formatMoney(p?.total_value)),
        tableCell(formatCount(p?.contract_count)),
      ]),
    ];
    return [
      sectionHeading('9. Top projects by contract value'),
      table(rows, ['*', 80, 130, 80]),
    ];
  }

  // ─── Renderer (mirrors PdfReportService.toBuffer) ──────────────────

  private async toBuffer(docDef: DocDef): Promise<Buffer> {
    try {
      // pdfmake v0.3.x setup. Three things diverge from the legacy v0.1.x
      // pattern still used by pdf-report.service.ts (compliance) and
      // export.service.ts (CSV/PDF export) — both of which would crash
      // with `TypeError: PdfPrinter is not a constructor` the moment
      // they were actually triggered (flagged for a separate scope-out
      // fix from 2c):
      //   1. `require('pdfmake')` returns an INSTANCE, not a class. The
      //      Node-side PdfPrinter constructor lives at
      //      `pdfmake/js/Printer` as `.default`.
      //   2. PdfPrinter's constructor signature is
      //      `(fontDescriptors, virtualfs, urlResolver)`. The urlResolver
      //      is consulted unconditionally during render (even for
      //      URL-less docs); without one, render throws
      //      `Cannot read properties of undefined (reading 'resolve')`.
      //      pdfmake ships URLResolver at `pdfmake/js/URLResolver`.
      //   3. `createPdfKitDocument` now returns Promise<pdfkitDoc>
      //      rather than the pdfkit doc directly. We await it before
      //      attaching the stream listeners.
      const PdfPrinter = require('pdfmake/js/Printer').default;
      const URLResolver = require('pdfmake/js/URLResolver').default;

      // Amiri (OFL-1.1, embedded under backend/assets/fonts/) replaces the
      // base-14 Helvetica that has ZERO Arabic glyphs. Project names, org
      // names, and requester names can all be Arabic; without this every
      // such codepoint would silently render as .notdef. The 2nd arg (was
      // `undefined`) is now the FontVfs adapter — pdfmake calls
      // `.existsSync()` + `.readFileSync()` on it to load the TTF buffers.
      const printer = new PdfPrinter(
        arabicFontDescriptors(),
        arabicVfs(),
        // Null access policy disables URL fetching (we never embed
        // external URLs in the portfolio PDF) but provides the
        // `resolved()` method Printer expects to await.
        new URLResolver(null),
      );

      // Random owner password is generated then discarded — the file
      // opens freely but cannot be edited, copied, or have its forms
      // filled. Matches the compliance permissions block exactly.
      const ownerPassword = crypto.randomBytes(24).toString('base64');
      const pdfDoc = await printer.createPdfKitDocument(docDef, {
        ownerPassword,
        permissions: {
          printing: 'highResolution',
          modifying: false,
          copying: false,
          annotating: false,
          fillingForms: false,
          contentAccessibility: true,
          documentAssembly: false,
        },
      });

      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (c: Buffer) => chunks.push(c));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err: Error) => reject(err));
        pdfDoc.end();
      });
    } catch (err) {
      this.logger.error('PDF generation failed', err);
      throw err;
    }
  }

  private watermarkCanvas(_width: number, _height: number): any[] {
    // Match PdfReportService — minimal placeholder canvas (the diagonal
    // text watermark is a v2 polish; the permissions block carries
    // the load-bearing protection).
    return [
      {
        type: 'rect',
        x: 0,
        y: 0,
        w: _width,
        h: _height,
        color: '#ffffff',
        fillOpacity: 0,
      },
    ];
  }
}

// ─── Helpers (mirrors the helpers at the bottom of PdfReportService) ─

function sectionHeading(text: string) {
  return { margin: [0, 18, 0, 8], text, fontSize: 16, bold: true, color: BRAND.dark };
}

function paragraph(text: string) {
  return emitArabicParagraph(text, 10, PORTFOLIO_BODY_WIDTH_PT, false, {
    fontSize: 10,
    color: BRAND.dark,
    margin: [0, 4, 0, 0],
  });
}

function coverLabel(text: string) {
  return { text, fontSize: 9, color: BRAND.muted, bold: true, margin: [0, 6, 0, 0] };
}

function coverValue(text: string) {
  // Cover-page values appear in a 2-col label/value table — use half-body
  // minus padding safety for the available width.
  const coverCellWidth = tableCellWidthFallback(PORTFOLIO_BODY_WIDTH_PT, 2);
  return emitArabicParagraph(text, 11, coverCellWidth, false, {
    fontSize: 11,
    color: BRAND.dark,
    margin: [0, 6, 0, 0],
  });
}

function statBlock(label: string, value: string, color: string) {
  return {
    stack: [
      { text: label, fontSize: 8, color: BRAND.muted, bold: true },
      { text: value, fontSize: 16, color, bold: true, margin: [0, 4, 0, 0] },
    ],
    fillColor: BRAND.light,
    margin: [6, 10, 6, 10],
  };
}

function tableHeader(text: string) {
  return { text, fontSize: 9, bold: true, color: BRAND.muted, margin: [0, 4, 0, 4] };
}

function tableCell(text: string) {
  // Portfolio tables vary in column count (2, 3, 4) — use the narrowest
  // case (4-column) as a conservative fallback so Arabic content never
  // overflows. v1: documented in the helper banner as the first edge case
  // to harden if multi-line wrap inside wider cells looks too narrow.
  const cellWidth = tableCellWidthFallback(PORTFOLIO_BODY_WIDTH_PT, 4);
  return emitArabicParagraph(text, 10, cellWidth, false, {
    fontSize: 10,
    color: BRAND.dark,
    margin: [0, 4, 0, 4],
  });
}

function table(body: any[], widths: any[]) {
  return {
    margin: [0, 8, 0, 8],
    table: { headerRows: 1, widths, body },
    layout: 'lightHorizontalLines',
  };
}

/**
 * Latin numerals for monetary values (#137). ISO currency code is rendered
 * separately in the adjacent column — this helper formats just the number.
 * Returns '—' for null / undefined / non-finite.
 */
function formatMoney(n: any): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n));
}

/**
 * Latin numerals for count values (#137). Returns '—' for null / undefined,
 * '0' for zero (NOT '—' — zero is information, missingness is not).
 */
function formatCount(n: any): string {
  if (n == null) return '—';
  if (!Number.isFinite(Number(n))) return '—';
  return new Intl.NumberFormat('en-US').format(Number(n));
}

function humanizePeriod(period: string): string {
  switch (period) {
    case '7d':
      return 'Last 7 days';
    case '30d':
      return 'Last 30 days';
    case '90d':
      return 'Last 90 days';
    case '365d':
      return 'Last 365 days';
    default:
      return period;
  }
}
