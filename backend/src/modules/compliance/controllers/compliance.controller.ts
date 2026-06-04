import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { User } from '../../../database/entities';
import { ComplianceReportType } from '../../../database/entities/compliance-report-job.entity';
import { UpdateFindingStatusDto } from '../dto/update-finding-status.dto';
import { ComplianceService } from '../services/compliance.service';
import { ComplianceFindingService } from '../services/compliance-finding.service';
import { ComplianceReportService } from '../services/compliance-report.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { StorageService } from '../../storage/storage.service';

@Controller('contracts/:contractId/compliance-checks')
@UseGuards(JwtAuthGuard)
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly findings: ComplianceFindingService,
    private readonly reports: ComplianceReportService,
    /**
     * Cross-tenant access wall — same authority used by contracts.controller
     * and viewer-portal.controller. Every endpoint on this base route
     * verifies the caller's org owns the contract BEFORE the service runs.
     * Closes the PR #42 class of bug on the compliance surface.
     *
     * For `:contractId`-keyed routes (POST runCheck, GET list) the wall
     * runs directly on the URL contractId. For `:checkId` / `:findingId`-
     * keyed routes, we resolve the entity's TRUE owning contract_id first
     * (via getContractIdForCheck / getContractIdForFinding) and wall on
     * THAT — the URL `:contractId` param is convention; the truth is the
     * persisted row. Walling only on the URL `:contractId` would still
     * let a user craft `GET /contracts/<own>/compliance-checks/<other-org-checkId>`.
     *
     * 404 (not 403) on cross-tenant — matches PR #42 / commit 54a3959's
     * existing-or-not-existing semantics. No existence leak.
     */
    private readonly contractAccess: ContractAccessService,
  ) {}

  /**
   * Managing-user access wall — confirms the caller's org owns
   * `contractId`. Throws `NotFoundException` ("Contract not found", 404)
   * if the contract doesn't exist OR belongs to another org. Same shape
   * as `ContractAccessService.findInOrg`.
   *
   * No-org callers (a managing User row with `organization_id IS NULL`)
   * are denied with 404 — they cannot own contracts. Mirrors
   * `findAccessibleContract`'s line-93 branch.
   */
  private async assertContractInCallerOrg(
    contractId: string,
    user: User,
  ): Promise<void> {
    if (!user.organization_id) {
      // Surface as 404 (not 403) to match PR #42 — no existence leak.
      throw new NotFoundException('Contract not found');
    }
    await this.contractAccess.findInOrg(contractId, user.organization_id);
  }

  @Post()
  async runCheck(
    @Param('contractId') contractId: string,
    @CurrentUser() user: User,
  ) {
    await this.assertContractInCallerOrg(contractId, user);
    return this.compliance.runCheck({
      contractId,
      userId: user.id,
      orgId: user.organization_id ?? null,
    });
  }

  @Get()
  async list(
    @Param('contractId') contractId: string,
    @CurrentUser() user: User,
  ) {
    await this.assertContractInCallerOrg(contractId, user);
    return this.compliance.listForContract(contractId);
  }

  @Get(':checkId')
  async getOne(
    @Param('checkId') checkId: string,
    @CurrentUser() user: User,
  ) {
    // Resolve the check's TRUE owning contract_id, then wall on that. The
    // URL `:contractId` is convention; check.contract_id is the truth.
    const ownerContractId = await this.compliance.getContractIdForCheck(
      checkId,
    );
    await this.assertContractInCallerOrg(ownerContractId, user);

    // Refresh from AI on every read so the frontend's polling has work to
    // do (preserved behaviour).
    await this.compliance.refreshFromAi(checkId);
    return this.compliance.getDetail(checkId);
  }

  @Post(':checkId/report')
  async requestSummaryReport(
    @Param('checkId') checkId: string,
    @CurrentUser() user: User,
  ) {
    const ownerContractId = await this.compliance.getContractIdForCheck(
      checkId,
    );
    await this.assertContractInCallerOrg(ownerContractId, user);

    const job = await this.reports.request({
      checkId,
      reportType: ComplianceReportType.COMPLIANCE_SUMMARY,
      userId: user.id,
    });
    return { job_id: job.id, message: 'Report queued', email: user.email };
  }

  @Post(':checkId/conflict-report')
  async requestConflictReport(
    @Param('checkId') checkId: string,
    @CurrentUser() user: User,
  ) {
    const ownerContractId = await this.compliance.getContractIdForCheck(
      checkId,
    );
    await this.assertContractInCallerOrg(ownerContractId, user);

    const job = await this.reports.request({
      checkId,
      reportType: ComplianceReportType.JURISDICTION_CONFLICT,
      userId: user.id,
    });
    return { job_id: job.id, message: 'Report queued', email: user.email };
  }

  @Post(':checkId/obligations-report')
  async requestObligationsReport(
    @Param('checkId') checkId: string,
    @CurrentUser() user: User,
  ) {
    const ownerContractId = await this.compliance.getContractIdForCheck(
      checkId,
    );
    await this.assertContractInCallerOrg(ownerContractId, user);

    const job = await this.reports.request({
      checkId,
      reportType: ComplianceReportType.OBLIGATIONS_REPORT,
      userId: user.id,
    });
    return { job_id: job.id, message: 'Report queued', email: user.email };
  }

  @Patch(':checkId/findings/:findingId')
  async updateFinding(
    @Param('findingId') findingId: string,
    @Body() body: UpdateFindingStatusDto,
    @CurrentUser() user: User,
  ) {
    // Resolve via the finding's parent check's contract_id; wall on that.
    const ownerContractId = await this.findings.getContractIdForFinding(
      findingId,
    );
    await this.assertContractInCallerOrg(ownerContractId, user);

    return this.findings.updateStatus(findingId, body.status, user.id);
  }
}

/**
 * Public download endpoint — token-gated, no JWT.
 *   GET /api/v1/compliance/reports/download?token=...
 * Streams the rendered PDF inline. Tokens expire after 24h.
 *
 * The file is retrieved via StorageService.getBuffer() so this endpoint
 * works with both the local adapter (default) and the S3 adapter without
 * any path-manipulation or sendFile() calls.
 */
@Controller('compliance')
export class ComplianceReportDownloadController {
  constructor(
    private readonly reports: ComplianceReportService,
    private readonly storage: StorageService,
  ) {}

  @Get('reports/download')
  async download(
    @Query('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const job = await this.reports.findByToken(token);
    if (!job || !job.file_path) {
      res.status(410).send('This download link has expired or is invalid.');
      return;
    }

    const buffer = await this.storage.getBuffer(job.file_path);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="sign-compliance-${job.id}.pdf"`,
    );
    res.end(buffer);
  }
}
