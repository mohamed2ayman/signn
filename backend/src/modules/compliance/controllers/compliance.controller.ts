import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import * as path from 'path';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { User } from '../../../database/entities';
import { ComplianceReportType } from '../../../database/entities/compliance-report-job.entity';
import { UpdateFindingStatusDto } from '../dto/update-finding-status.dto';
import { ComplianceService } from '../services/compliance.service';
import { ComplianceFindingService } from '../services/compliance-finding.service';
import { ComplianceReportService } from '../services/compliance-report.service';

@Controller('contracts/:contractId/compliance-checks')
@UseGuards(JwtAuthGuard)
export class ComplianceController {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly findings: ComplianceFindingService,
    private readonly reports: ComplianceReportService,
  ) {}

  @Post()
  async runCheck(
    @Param('contractId') contractId: string,
    @CurrentUser() user: User,
  ) {
    return this.compliance.runCheck({
      contractId,
      userId: user.id,
      orgId: user.organization_id ?? null,
    });
  }

  @Get()
  async list(@Param('contractId') contractId: string) {
    return this.compliance.listForContract(contractId);
  }

  @Get(':checkId')
  async getOne(@Param('checkId') checkId: string) {
    // Refresh from AI on every read so the frontend's polling has work to do
    await this.compliance.refreshFromAi(checkId);
    return this.compliance.getDetail(checkId);
  }

  @Post(':checkId/report')
  async requestSummaryReport(
    @Param('checkId') checkId: string,
    @CurrentUser() user: User,
  ) {
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
    return this.findings.updateStatus(findingId, body.status, user.id);
  }
}

/**
 * Public download endpoint — token-gated, no JWT.
 *   GET /api/v1/compliance/reports/download?token=...
 * Streams the rendered PDF inline. Tokens expire after 24h.
 */
@Controller('compliance')
export class ComplianceReportDownloadController {
  constructor(private readonly reports: ComplianceReportService) {}

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
    const uploadBase =
      path.resolve(process.env['UPLOAD_DIR'] ?? path.join(process.cwd(), 'uploads')) +
      path.sep;
    const resolvedPath = path.resolve(job.file_path);
    if (!resolvedPath.startsWith(uploadBase)) {
      throw new ForbiddenException('Invalid file path');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="sign-compliance-${job.id}.pdf"`,
    );
    res.sendFile(resolvedPath);
  }
}
