import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  ParseUUIDPipe,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationId } from '../../common/decorators/organization.decorator';
import { ExportService } from './export.service';
import { ContractAccessService } from '../contracts/services/contract-access.service';

@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    // Tenant-isolation Tier 2 — wall every contract-PDF read here.
    // ExportService loads the contract by id with NO org filter; without
    // the wall, any authenticated user could download any org's contract.
    private readonly contractAccess: ContractAccessService,
  ) {}

  /**
   * Tenant-isolation Tier 2 — managing-user access wall.
   *
   * Same shape as ai/chat controllers + PR #45's compliance helper.
   * Throws NotFoundException (404, NOT 403) on:
   *   - missing/empty caller org (JWT with organization_id IS NULL
   *     cannot own contracts), or
   *   - contract not owned by the caller's org.
   */
  private async assertContractInCallerOrg(
    contractId: string,
    orgId: string | null | undefined,
  ): Promise<void> {
    if (!orgId) {
      throw new NotFoundException('Contract not found');
    }
    await this.contractAccess.findInOrg(contractId, orgId);
  }

  @Get('contracts/:id/pdf')
  async exportContractPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
    @Res() res: Response,
  ) {
    await this.assertContractInCallerOrg(id, orgId);
    const buffer = await this.exportService.generateContractPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="contract-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('contracts/:id/risk-report')
  async exportRiskReport(
    @Param('id', ParseUUIDPipe) id: string,
    @OrganizationId() orgId: string,
    @Res() res: Response,
  ) {
    await this.assertContractInCallerOrg(id, orgId);
    // S2d: the caller's org rides into the service so the risk read loads
    // through the scoped repo (data-layer tenancy under the wall above).
    const buffer = await this.exportService.generateRiskReport(id, orgId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="risk-report-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('contracts/:id/summary')
  async exportSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string,
    @OrganizationId() orgId: string,
    @Res() res: Response,
  ) {
    await this.assertContractInCallerOrg(id, orgId);
    const fmt = format === 'json' ? 'json' : 'pdf';
    // S2c-1: the caller's org rides into the service so the obligations read
    // loads through the scoped repo (data-layer tenancy under the wall above).
    const result = await this.exportService.generateContractSummary(id, orgId, fmt);

    if (fmt === 'json') {
      res.json(result);
    } else {
      const buffer = result as Buffer;
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="summary-${id}.pdf"`,
        'Content-Length': buffer.length,
      });
      res.end(buffer);
    }
  }
}
