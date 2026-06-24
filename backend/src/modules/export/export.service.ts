import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Contract,
  ContractClause,
} from '../../database/entities';
// Option B — S2c-1: the obligations read in generateContractSummary routes
// through the scoped-repository tenancy chokepoint (canonical
// obligation→contract→project→org). The controller's #60/Tier-2 findInOrg
// wall STAYS in front — two checks, two layers.
import { ObligationScopedRepository } from '../scoped-repository/obligation-scoped.repository';
// Option B — S2d: the two per-contract RISK reads (generateRiskReport,
// generateContractSummary) route through the RiskAnalysis scoped repository
// (canonical risk→contract→project→org), replacing the bare RiskAnalysis
// repository. The controller's findInOrg wall STAYS in front — two layers.
import { RiskScopedRepository } from '../scoped-repository/risk-scoped.repository';
// Arabic PDF rendering: Option A — pre-measure + pre-wrap so each visual
// line reaches fontkit as one paragraph for correct UAX #9 bidi (cross-word
// word order). Latin paragraphs short-circuit to identity in the helper, so
// existing Latin output is unaffected. See pdf-arabic.ts banner for the
// full diagnosis and architecture.
import {
  emitArabicParagraph,
  arabicHeadingText,
  arabicFontDescriptors,
  arabicVfs,
  EXPORT_BODY_WIDTH_PT,
  tableCellWidthFallback,
} from '../../common/utils/pdf-arabic';

// pdfmake types - use any for flexibility since pdfmake types vary by version
type TDocumentDefinitions = any;
type Content = any;

const BRAND_COLOR = '#4F6EF7';
const DARK_COLOR = '#0F1729';

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @InjectRepository(Contract) // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
    private readonly contractRepository: Repository<Contract>,
    // S2c-1: scoped repo replaces the bare Obligation repository — the
    // summary's obligation read is org-gated at the data layer.
    private readonly obligationScoped: ObligationScopedRepository,
    // S2d: scoped repo replaces the bare RiskAnalysis repository — both risk
    // reads (risk-report + summary) are org-gated at the data layer, under the
    // export controller's findInOrg wall.
    private readonly riskScoped: RiskScopedRepository,
  ) {}

  /**
   * Generate a full contract PDF with clauses
   */
  async generateContractPdf(contractId: string): Promise<Buffer> {
    const contract = await this.contractRepository.findOne({ // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
      where: { id: contractId },
      relations: [
        'project',
        'contract_clauses',
        'contract_clauses.clause',
        'creator',
      ],
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    const clauses = (contract.contract_clauses || [])
      .sort((a, b) => a.order_index - b.order_index);

    const clauseContent: Content[] = clauses.map((cc, i) => {
      const clause = cc.clause;
      const sectionNum = cc.section_number || String(i + 1);
      const titleSource = clause?.title || 'Untitled Clause';
      const bodyText = clause?.content || '';
      // arabicHeadingText emits "٣. title" for Arabic titles (Arabic-Indic
      // digit + period + title, NO word reversal — fontkit handles bidi).
      // emitArabicParagraph then routes through the Option-A pre-wrap +
      // noWrap-stack pipeline for Arabic content; Latin passes through
      // unchanged as a single text node.
      const titleText = arabicHeadingText(sectionNum, titleSource);
      return [
        emitArabicParagraph(titleText, 12, EXPORT_BODY_WIDTH_PT, true, {
          style: 'clauseTitle',
          margin: [0, 16, 0, 4] as [number, number, number, number],
        }),
        emitArabicParagraph(bodyText, 10, EXPORT_BODY_WIDTH_PT, false, {
          style: 'body',
          margin: [0, 0, 0, 8] as [number, number, number, number],
        }),
      ];
    }).flat();

    const projectName = contract.project?.name || 'N/A';
    // Half-body width for the 2-col meta blocks. Minus 4pt safety absorbs the
    // tiny gap pdfmake leaves between '*' columns.
    const META_COLUMN_WIDTH_PT = EXPORT_BODY_WIDTH_PT / 2 - 4;
    const docDefinition: TDocumentDefinitions = {
      content: [
        { text: 'Sign Platform', style: 'brand', margin: [0, 0, 0, 4] as [number, number, number, number] },
        emitArabicParagraph(contract.name, 22, EXPORT_BODY_WIDTH_PT, true, {
          style: 'title',
        }),
        {
          columns: [
            { text: `Type: ${contract.contract_type}`, style: 'meta', width: '*' },
            { text: `Status: ${contract.status}`, style: 'meta', width: '*' },
          ],
          margin: [0, 8, 0, 0] as [number, number, number, number],
        },
        {
          columns: [
            { ...emitArabicParagraph(`Project: ${projectName}`, 10, META_COLUMN_WIDTH_PT, false, { style: 'meta' }), width: '*' },
            { text: `Created: ${new Date(contract.created_at).toLocaleDateString()}`, style: 'meta', width: '*' },
          ],
          margin: [0, 4, 0, 16] as [number, number, number, number],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#E5E7EB' }] },
        { text: 'Contract Clauses', style: 'sectionTitle', margin: [0, 20, 0, 8] as [number, number, number, number] },
        ...clauseContent,
      ],
      styles: {
        brand: { fontSize: 10, color: BRAND_COLOR, bold: true },
        title: { fontSize: 22, bold: true, color: DARK_COLOR },
        sectionTitle: { fontSize: 16, bold: true, color: DARK_COLOR },
        clauseTitle: { fontSize: 12, bold: true, color: '#1F2937', lineHeight: 1.3 },
        meta: { fontSize: 10, color: '#6B7280', lineHeight: 1.3 },
        body: { fontSize: 10, color: '#374151', lineHeight: 1.3 },
      },
      // Helvetica = PDF base-14, NO embedding. Acrobat-strict fix
      // (2026-06-24): pure-Latin chrome (footer, page numbers, brand,
      // meta labels) renders via Helvetica's built-in AFM path,
      // bypassing the Amiri-subset path that triggered Acrobat
      // CTJPEGReader/Font Capture crashes on real contract exports.
      // Arabic content opts back into Amiri inside `emitArabicParagraph`
      // (Arabic inlines carry explicit `font: 'Amiri'`).
      defaultStyle: { font: 'Helvetica' },
      pageMargins: [40, 40, 40, 60] as [number, number, number, number],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: `Generated by Sign Platform`, fontSize: 8, color: '#9CA3AF', margin: [40, 0, 0, 0] as [number, number, number, number] },
          { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#9CA3AF', alignment: 'right' as const, margin: [0, 0, 40, 0] as [number, number, number, number] },
        ],
      }),
    };

    return this.createPdfBuffer(docDefinition);
  }

  /**
   * Generate a risk analysis report PDF
   */
  async generateRiskReport(contractId: string, orgId: string): Promise<Buffer> {
    const contract = await this.contractRepository.findOne({ // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
      where: { id: contractId },
      relations: ['project'],
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // WALL (persona) — the controller's Tier-2 findInOrg already authorized
    // contractId for this caller. SCOPED LIST (tenancy — Option B S2d) — the
    // risk rows load through the scoped repo (canonical
    // risk→contract→project→org); both layers fire.
    const risks = await this.riskScoped.scopedFind(
      { contract_id: contractId },
      orgId,
      { order: { created_at: 'DESC' } },
    );

    const highCount = risks.filter((r) => r.risk_level === 'HIGH').length;
    const mediumCount = risks.filter((r) => r.risk_level === 'MEDIUM').length;
    const lowCount = risks.filter((r) => r.risk_level === 'LOW').length;

    const riskTableBody = [
      [
        { text: 'Category', style: 'tableHeader' },
        { text: 'Level', style: 'tableHeader' },
        { text: 'Description', style: 'tableHeader' },
        { text: 'Recommendation', style: 'tableHeader' },
      ],
      ...risks.map((r) => {
        const desc = r.description || '';
        const rec = r.recommendation || 'N/A';
        // 4-col risk table ['auto', 'auto', '*', '*'] — use the conservative
        // ¼-of-body fallback per the v1 plan.
        const cellWidth = tableCellWidthFallback(EXPORT_BODY_WIDTH_PT, 4);
        return [
          emitArabicParagraph(r.risk_category, 9, cellWidth, false, { style: 'tableCell' }),
          {
            text: r.risk_level,
            style: 'tableCell',
            color: r.risk_level === 'HIGH' ? '#DC2626' : r.risk_level === 'MEDIUM' ? '#D97706' : '#059669',
            bold: true,
          },
          emitArabicParagraph(desc, 9, cellWidth, false, { style: 'tableCell' }),
          emitArabicParagraph(rec, 9, cellWidth, false, { style: 'tableCell' }),
        ];
      }),
    ];

    const docDefinition: TDocumentDefinitions = {
      content: [
        { text: 'Sign Platform', style: 'brand', margin: [0, 0, 0, 4] as [number, number, number, number] },
        { text: 'Risk Analysis Report', style: 'title' },
        emitArabicParagraph(`Contract: ${contract.name}`, 10, EXPORT_BODY_WIDTH_PT, false, {
          style: 'meta',
          margin: [0, 8, 0, 4] as [number, number, number, number],
        }),
        emitArabicParagraph(`Project: ${contract.project?.name || 'N/A'}`, 10, EXPORT_BODY_WIDTH_PT, false, {
          style: 'meta',
          margin: [0, 0, 0, 16] as [number, number, number, number],
        }),
        {
          columns: [
            { text: `High: ${highCount}`, style: 'riskHigh', alignment: 'center' as const, width: '*' },
            { text: `Medium: ${mediumCount}`, style: 'riskMedium', alignment: 'center' as const, width: '*' },
            { text: `Low: ${lowCount}`, style: 'riskLow', alignment: 'center' as const, width: '*' },
          ],
          margin: [0, 0, 0, 20] as [number, number, number, number],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#E5E7EB' }] },
        { text: 'Risk Details', style: 'sectionTitle', margin: [0, 16, 0, 8] as [number, number, number, number] },
        risks.length > 0
          ? {
              table: {
                headerRows: 1,
                widths: ['auto', 'auto', '*', '*'],
                body: riskTableBody,
              },
              layout: {
                hLineWidth: () => 0.5,
                vLineWidth: () => 0.5,
                hLineColor: () => '#E5E7EB',
                vLineColor: () => '#E5E7EB',
                paddingLeft: () => 8,
                paddingRight: () => 8,
                paddingTop: () => 6,
                paddingBottom: () => 6,
              },
            }
          : { text: 'No risks found.', style: 'body', italics: true },
      ],
      styles: {
        brand: { fontSize: 10, color: BRAND_COLOR, bold: true },
        title: { fontSize: 22, bold: true, color: DARK_COLOR },
        sectionTitle: { fontSize: 16, bold: true, color: DARK_COLOR },
        meta: { fontSize: 10, color: '#6B7280', lineHeight: 1.3 },
        body: { fontSize: 10, color: '#374151', lineHeight: 1.3 },
        riskHigh: { fontSize: 14, bold: true, color: '#DC2626' },
        riskMedium: { fontSize: 14, bold: true, color: '#D97706' },
        riskLow: { fontSize: 14, bold: true, color: '#059669' },
        tableHeader: { fontSize: 9, bold: true, color: '#374151', fillColor: '#F9FAFB' },
        tableCell: { fontSize: 9, color: '#4B5563', lineHeight: 1.3 },
      },
      // Helvetica = PDF base-14, NO embedding. Acrobat-strict fix
      // (2026-06-24): pure-Latin chrome (footer, page numbers, brand,
      // meta labels) renders via Helvetica's built-in AFM path,
      // bypassing the Amiri-subset path that triggered Acrobat
      // CTJPEGReader/Font Capture crashes on real contract exports.
      // Arabic content opts back into Amiri inside `emitArabicParagraph`
      // (Arabic inlines carry explicit `font: 'Amiri'`).
      defaultStyle: { font: 'Helvetica' },
      pageMargins: [40, 40, 40, 60] as [number, number, number, number],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: `Generated by Sign Platform`, fontSize: 8, color: '#9CA3AF', margin: [40, 0, 0, 0] as [number, number, number, number] },
          { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#9CA3AF', alignment: 'right' as const, margin: [0, 0, 40, 0] as [number, number, number, number] },
        ],
      }),
    };

    return this.createPdfBuffer(docDefinition);
  }

  /**
   * Generate a contract summary (PDF or JSON)
   */
  async generateContractSummary(
    contractId: string,
    orgId: string,
    format: 'pdf' | 'json' = 'pdf',
  ): Promise<Buffer | Record<string, any>> {
    const contract = await this.contractRepository.findOne({ // lint-exempt: wall-protected (findInOrg); chokepoint migration scheduled
      where: { id: contractId },
      relations: ['project', 'contract_clauses', 'creator'],
    });

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    // WALL (persona) — the controller's Tier-2 findInOrg already authorized
    // contractId for this caller. SCOPED LIST (tenancy — Option B S2d) — the
    // risk rows load through the scoped repo (canonical
    // risk→contract→project→org), replacing the former bare find. Both layers
    // fire; mirrors the obligation scoped read below.
    const risks = await this.riskScoped.scopedFind(
      { contract_id: contractId },
      orgId,
    );

    // SCOPED LIST (tenancy — Option B S2c-1) — the obligation rows load through
    // the scoped repo, which independently re-applies
    // obligation→contract→project→org. Both layers fire.
    const obligations = await this.obligationScoped.scopedFind(
      { contract_id: contractId },
      orgId,
    );

    const summary = {
      contract: {
        id: contract.id,
        name: contract.name,
        type: contract.contract_type,
        status: contract.status,
        created_at: contract.created_at,
        project: contract.project?.name || 'N/A',
        creator: contract.creator
          ? `${contract.creator.first_name} ${contract.creator.last_name}`
          : 'N/A',
      },
      statistics: {
        total_clauses: contract.contract_clauses?.length || 0,
        total_risks: risks.length,
        high_risks: risks.filter((r) => r.risk_level === 'HIGH').length,
        medium_risks: risks.filter((r) => r.risk_level === 'MEDIUM').length,
        low_risks: risks.filter((r) => r.risk_level === 'LOW').length,
        total_obligations: obligations.length,
        overdue_obligations: obligations.filter((o) => o.status === 'OVERDUE')
          .length,
      },
      generated_at: new Date().toISOString(),
    };

    if (format === 'json') {
      return summary;
    }

    // PDF
    // 2-col summary table cell width — body/2 minus padding safety.
    const summaryCellWidth = tableCellWidthFallback(EXPORT_BODY_WIDTH_PT, 2);
    const docDefinition: TDocumentDefinitions = {
      content: [
        { text: 'Sign Platform', style: 'brand', margin: [0, 0, 0, 4] as [number, number, number, number] },
        { text: 'Contract Summary', style: 'title' },
        emitArabicParagraph(contract.name, 14, EXPORT_BODY_WIDTH_PT, false, {
          style: 'subtitle',
          margin: [0, 4, 0, 16] as [number, number, number, number],
        }),
        {
          table: {
            widths: ['*', '*'],
            body: [
              [{ text: 'Type', style: 'label' }, emitArabicParagraph(contract.contract_type, 10, summaryCellWidth, false, { style: 'value' })],
              [{ text: 'Status', style: 'label' }, emitArabicParagraph(contract.status, 10, summaryCellWidth, false, { style: 'value' })],
              [{ text: 'Project', style: 'label' }, emitArabicParagraph(summary.contract.project, 10, summaryCellWidth, false, { style: 'value' })],
              [{ text: 'Created By', style: 'label' }, emitArabicParagraph(summary.contract.creator, 10, summaryCellWidth, false, { style: 'value' })],
              [{ text: 'Clauses', style: 'label' }, { text: `${summary.statistics.total_clauses}`, style: 'value' }],
              [{ text: 'Risks (H/M/L)', style: 'label' }, { text: `${summary.statistics.high_risks} / ${summary.statistics.medium_risks} / ${summary.statistics.low_risks}`, style: 'value' }],
              [{ text: 'Obligations', style: 'label' }, { text: `${summary.statistics.total_obligations}`, style: 'value' }],
              [{ text: 'Overdue', style: 'label' }, { text: `${summary.statistics.overdue_obligations}`, style: 'value' }],
            ],
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0,
            hLineColor: () => '#E5E7EB',
            paddingLeft: () => 8,
            paddingRight: () => 8,
            paddingTop: () => 6,
            paddingBottom: () => 6,
          },
        },
      ],
      styles: {
        brand: { fontSize: 10, color: BRAND_COLOR, bold: true },
        title: { fontSize: 22, bold: true, color: DARK_COLOR },
        subtitle: { fontSize: 14, color: '#6B7280', lineHeight: 1.3 },
        label: { fontSize: 10, bold: true, color: '#374151', lineHeight: 1.3 },
        value: { fontSize: 10, color: '#6B7280', lineHeight: 1.3 },
      },
      // Helvetica = PDF base-14, NO embedding. Acrobat-strict fix
      // (2026-06-24): pure-Latin chrome (footer, page numbers, brand,
      // meta labels) renders via Helvetica's built-in AFM path,
      // bypassing the Amiri-subset path that triggered Acrobat
      // CTJPEGReader/Font Capture crashes on real contract exports.
      // Arabic content opts back into Amiri inside `emitArabicParagraph`
      // (Arabic inlines carry explicit `font: 'Amiri'`).
      defaultStyle: { font: 'Helvetica' },
      pageMargins: [40, 40, 40, 60] as [number, number, number, number],
    };

    return this.createPdfBuffer(docDefinition);
  }

  private async createPdfBuffer(
    docDefinition: TDocumentDefinitions,
  ): Promise<Buffer> {
    try {
      // pdfmake v0.3.x setup. Three things diverge from the legacy v0.1.x
      // pattern (`require('pdfmake')` + `new PdfPrinter(...)` + synchronous
      // `createPdfKitDocument`), which crashes with
      // `TypeError: PdfPrinter is not a constructor` on pdfmake@0.3+.
      // Mirrors the proven fix in portfolio-export-renderer.service.ts
      // (commit d4dc54a):
      //   1. `require('pdfmake')` returns an INSTANCE; the Node-side
      //      PdfPrinter constructor lives at `pdfmake/js/Printer` `.default`.
      //   2. The constructor signature is `(fontDescriptors, virtualfs,
      //      urlResolver)`. Without a URLResolver, render throws
      //      `Cannot read properties of undefined (reading 'resolve')` even
      //      for URL-less docs. pdfmake ships it at `pdfmake/js/URLResolver`;
      //      `new URLResolver(null)` disables URL fetching while providing
      //      the `resolved()` method Printer awaits during render.
      //   3. `createPdfKitDocument` now returns Promise<pdfkitDoc>; await it
      //      before attaching the stream listeners.
      const PdfPrinter = require('pdfmake/js/Printer').default;
      const URLResolver = require('pdfmake/js/URLResolver').default;

      // Amiri (OFL-1.1, embedded under backend/assets/fonts/) replaces the
      // base-14 Helvetica that had ZERO Arabic glyphs and was the root cause
      // of the mojibake bug on contract PDFs containing Arabic. The 2nd arg
      // (was `undefined`) is now the FontVfs adapter — pdfmake calls
      // `.existsSync()` + `.readFileSync()` on it to load the TTF buffers.
      // Each text node going through prepareArabicText() arrives in visual
      // order; pdfmake draws it left-to-right exactly as given.
      const printer = new PdfPrinter(
        arabicFontDescriptors(),
        arabicVfs(),
        new URLResolver(null),
      );

      const pdfDoc = await printer.createPdfKitDocument(docDefinition);

      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err: Error) => reject(err));
        pdfDoc.end();
      });
    } catch (error) {
      this.logger.error('Failed to generate PDF', error);
      throw error;
    }
  }
}
