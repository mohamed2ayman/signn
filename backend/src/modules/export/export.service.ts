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
   * Generate a full contract PDF with clauses.
   *
   * `watermarkText` is OPTIONAL and caller-supplied. When present, a visible
   * diagonal watermark carrying that exact string is stamped on EVERY page via
   * pdfmake's native top-level `watermark` property (auto per-page). When
   * absent — the managing-user export path (ExportController) — the document is
   * rendered WITHOUT a watermark, byte-for-byte as before. The service NEVER
   * constructs the stamp itself: identity construction stays at the
   * authenticated boundary (the guest download route builds the stamp from the
   * server-side principal). See the Guest Watermarked Download feature.
   */
  async generateContractPdf(
    contractId: string,
    watermarkText?: string,
  ): Promise<Buffer> {
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
      return [
        {
          text: `${cc.section_number || `${i + 1}`}. ${clause?.title || 'Untitled Clause'}`,
          style: 'clauseTitle',
          margin: [0, 16, 0, 4] as [number, number, number, number],
        },
        {
          text: clause?.content || '',
          style: 'body',
          margin: [0, 0, 0, 8] as [number, number, number, number],
        },
      ];
    }).flat();

    const docDefinition: TDocumentDefinitions = {
      content: [
        { text: 'Sign Platform', style: 'brand', margin: [0, 0, 0, 4] as [number, number, number, number] },
        { text: contract.name, style: 'title' },
        {
          columns: [
            { text: `Type: ${contract.contract_type}`, style: 'meta', width: '*' },
            { text: `Status: ${contract.status}`, style: 'meta', width: '*' },
          ],
          margin: [0, 8, 0, 0] as [number, number, number, number],
        },
        {
          columns: [
            { text: `Project: ${contract.project?.name || 'N/A'}`, style: 'meta', width: '*' },
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
        clauseTitle: { fontSize: 12, bold: true, color: '#1F2937' },
        meta: { fontSize: 10, color: '#6B7280' },
        body: { fontSize: 10, color: '#374151', lineHeight: 1.5 },
      },
      defaultStyle: { font: 'Helvetica' },
      pageMargins: [40, 40, 40, 60] as [number, number, number, number],
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: `Generated by Sign Platform`, fontSize: 8, color: '#9CA3AF', margin: [40, 0, 0, 0] as [number, number, number, number] },
          { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#9CA3AF', alignment: 'right' as const, margin: [0, 0, 40, 0] as [number, number, number, number] },
        ],
      }),
    };

    // Visible deterrent watermark — applied ONLY when the caller supplies a
    // stamp (the guest download path). pdfmake renders a top-level `watermark`
    // diagonally on EVERY page automatically (LayoutBuilder.addWatermark). The
    // managing-user export path passes no text → no `watermark` key → output is
    // unchanged. Grey + opacity 0.3 keeps the contract legible underneath.
    if (watermarkText) {
      docDefinition.watermark = {
        text: watermarkText,
        color: '#9CA3AF',
        opacity: 0.3,
        bold: true,
      };
    }

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
      ...risks.map((r) => [
        { text: r.risk_category, style: 'tableCell' },
        {
          text: r.risk_level,
          style: 'tableCell',
          color: r.risk_level === 'HIGH' ? '#DC2626' : r.risk_level === 'MEDIUM' ? '#D97706' : '#059669',
          bold: true,
        },
        { text: r.description || '', style: 'tableCell' },
        { text: r.recommendation || 'N/A', style: 'tableCell' },
      ]),
    ];

    const docDefinition: TDocumentDefinitions = {
      content: [
        { text: 'Sign Platform', style: 'brand', margin: [0, 0, 0, 4] as [number, number, number, number] },
        { text: 'Risk Analysis Report', style: 'title' },
        { text: `Contract: ${contract.name}`, style: 'meta', margin: [0, 8, 0, 4] as [number, number, number, number] },
        { text: `Project: ${contract.project?.name || 'N/A'}`, style: 'meta', margin: [0, 0, 0, 16] as [number, number, number, number] },
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
        meta: { fontSize: 10, color: '#6B7280' },
        body: { fontSize: 10, color: '#374151', lineHeight: 1.5 },
        riskHigh: { fontSize: 14, bold: true, color: '#DC2626' },
        riskMedium: { fontSize: 14, bold: true, color: '#D97706' },
        riskLow: { fontSize: 14, bold: true, color: '#059669' },
        tableHeader: { fontSize: 9, bold: true, color: '#374151', fillColor: '#F9FAFB' },
        tableCell: { fontSize: 9, color: '#4B5563' },
      },
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
    const docDefinition: TDocumentDefinitions = {
      content: [
        { text: 'Sign Platform', style: 'brand', margin: [0, 0, 0, 4] as [number, number, number, number] },
        { text: 'Contract Summary', style: 'title' },
        { text: `${contract.name}`, style: 'subtitle', margin: [0, 4, 0, 16] as [number, number, number, number] },
        {
          table: {
            widths: ['*', '*'],
            body: [
              [{ text: 'Type', style: 'label' }, { text: contract.contract_type, style: 'value' }],
              [{ text: 'Status', style: 'label' }, { text: contract.status, style: 'value' }],
              [{ text: 'Project', style: 'label' }, { text: summary.contract.project, style: 'value' }],
              [{ text: 'Created By', style: 'label' }, { text: summary.contract.creator, style: 'value' }],
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
        subtitle: { fontSize: 14, color: '#6B7280' },
        label: { fontSize: 10, bold: true, color: '#374151' },
        value: { fontSize: 10, color: '#6B7280' },
      },
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

      const printer = new PdfPrinter(
        {
          Helvetica: {
            normal: 'Helvetica',
            bold: 'Helvetica-Bold',
            italics: 'Helvetica-Oblique',
            bolditalics: 'Helvetica-BoldOblique',
          },
        },
        undefined,
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
