import { NotFoundException } from '@nestjs/common';

import { ExportController } from '../export.controller';
import { ExportService } from '../export.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Tenant-isolation Tier 2 — access-wall spec for the highest-exposure read
 * leak in the sweep. Pre-fix, all three `/export/contracts/:id/*` endpoints
 * were JWT-only and ExportService loaded the contract by id with no org
 * filter — any authenticated user could download any org's contract.
 *
 * Wall lives at the controller (mirrors PR #45's helper shape) so the
 * ExportService internals stay unchanged and the same path can serve
 * future internal callers (e.g. DocuSign envelope rendering) without
 * routing through the wall.
 */
describe('ExportController — cross-tenant access wall (Tier 2)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';

  let controller: ExportController;
  let exportService: jest.Mocked<ExportService>;
  let contractAccess: jest.Mocked<ContractAccessService>;
  let res: any;

  beforeEach(() => {
    exportService = {
      generateContractPdf: jest.fn(),
      generateRiskReport: jest.fn(),
      generateContractSummary: jest.fn(),
    } as unknown as jest.Mocked<ExportService>;

    contractAccess = {
      findInOrg: jest.fn(),
    } as unknown as jest.Mocked<ContractAccessService>;

    controller = new ExportController(exportService, contractAccess);

    res = {
      set: jest.fn(),
      end: jest.fn(),
      json: jest.fn(),
    };
  });

  describe.each([
    [
      'GET /export/contracts/:id/pdf (exportContractPdf)',
      (c: ExportController, id: string, orgId: string, response: any) =>
        c.exportContractPdf(id, orgId, response),
      'generateContractPdf' as const,
      // generateContractPdf is a CONTRACT read (out of S2d risk scope) — still
      // called with the id only.
      ['contract-in-a'] as const,
    ],
    [
      'GET /export/contracts/:id/risk-report (exportRiskReport)',
      (c: ExportController, id: string, orgId: string, response: any) =>
        c.exportRiskReport(id, orgId, response),
      'generateRiskReport' as const,
      // S2d: the caller org now rides into generateRiskReport so the risk read
      // loads through the scoped repo.
      ['contract-in-a', ORG_A] as const,
    ],
  ])('%s', (_label, invoke, generateMethod, expectedArgs) => {
    it('cross-tenant: 404 and the renderer is NEVER called', async () => {
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(
        invoke(controller, CONTRACT_IN_B, ORG_A, res),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // CRITICAL: no PDF bytes were rendered (no cost, no leak).
      expect(exportService[generateMethod]).not.toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, PDF bytes streamed', async () => {
      contractAccess.findInOrg.mockResolvedValue({} as any);
      const pdfBytes = Buffer.from('%PDF-real-bytes');
      (exportService[generateMethod] as jest.Mock).mockResolvedValue(pdfBytes);

      await invoke(controller, 'contract-in-a', ORG_A, res);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(exportService[generateMethod]).toHaveBeenCalledWith(...expectedArgs);
      expect(res.end).toHaveBeenCalledWith(pdfBytes);
    });

    it('no-org caller is denied with 404; findInOrg is NEVER called', async () => {
      await expect(
        invoke(controller, CONTRACT_IN_B, '' as any, res),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(exportService[generateMethod]).not.toHaveBeenCalled();
    });
  });

  describe('GET /export/contracts/:id/summary (exportSummary)', () => {
    it('cross-tenant (PDF format): 404 and renderer NEVER called', async () => {
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(
        controller.exportSummary(CONTRACT_IN_B, 'pdf', ORG_A, res),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(exportService.generateContractSummary).not.toHaveBeenCalled();
    });

    it('cross-tenant (JSON format): 404 and renderer NEVER called', async () => {
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(
        controller.exportSummary(CONTRACT_IN_B, 'json', ORG_A, res),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(exportService.generateContractSummary).not.toHaveBeenCalled();
    });

    it('happy path: in-org PDF format, bytes streamed', async () => {
      contractAccess.findInOrg.mockResolvedValue({} as any);
      const pdf = Buffer.from('%PDF-summary');
      exportService.generateContractSummary.mockResolvedValue(pdf as any);

      await controller.exportSummary('contract-in-a', 'pdf', ORG_A, res);
      expect(res.end).toHaveBeenCalledWith(pdf);
    });

    it('happy path: in-org JSON format, JSON returned', async () => {
      contractAccess.findInOrg.mockResolvedValue({} as any);
      exportService.generateContractSummary.mockResolvedValue({
        summary: 'ok',
      } as any);

      await controller.exportSummary('contract-in-a', 'json', ORG_A, res);
      expect(res.json).toHaveBeenCalledWith({ summary: 'ok' });
    });
  });
});
