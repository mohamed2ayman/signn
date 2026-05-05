import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import {
  ComplianceCheck,
  ComplianceFinding,
  ComplianceReportJob,
  ComplianceReportType,
  Contract,
  Obligation,
  Organization,
  Project,
  User,
} from '../../../database/entities';
import { PdfReportService, ReportContext } from '../services/pdf-report.service';
import { ComplianceReportService } from '../services/compliance-report.service';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { baseEmailLayout } from '../../notifications/templates/base-layout';

interface RenderReportJob {
  job_id: string;
}

@Processor('compliance-jobs')
export class ComplianceReportProcessor {
  private readonly logger = new Logger(ComplianceReportProcessor.name);
  private readonly outputDir: string;
  private readonly baseUrl: string;

  constructor(
    @InjectRepository(ComplianceReportJob)
    private readonly reportJobRepo: Repository<ComplianceReportJob>,
    @InjectRepository(ComplianceCheck)
    private readonly checkRepo: Repository<ComplianceCheck>,
    @InjectRepository(ComplianceFinding)
    private readonly findingRepo: Repository<ComplianceFinding>,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Obligation)
    private readonly obligationRepo: Repository<Obligation>,
    private readonly pdf: PdfReportService,
    private readonly reportService: ComplianceReportService,
    private readonly dispatch: NotificationDispatchService,
    private readonly config: ConfigService,
  ) {
    const uploadDir = this.config.get<string>(
      'UPLOAD_DIR',
      path.join(process.cwd(), 'uploads'),
    );
    this.outputDir = path.join(uploadDir, 'compliance-reports');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    this.baseUrl = this.config.get<string>('BASE_URL', 'http://localhost:3000');
  }

  @Process('render-report')
  async handleRenderReport(job: Job<RenderReportJob>): Promise<void> {
    const reportJobId = job.data.job_id;
    this.logger.log(`Rendering report jobId=${reportJobId}`);

    const reportJob = await this.reportJobRepo.findOne({
      where: { id: reportJobId },
    });
    if (!reportJob) {
      this.logger.error(`Report job ${reportJobId} not found`);
      return;
    }

    try {
      await this.reportService.markRendering(reportJob.id);

      const ctx = await this.loadContext(reportJob);
      let buffer: Buffer;
      let reportName: string;

      if (reportJob.report_type === ComplianceReportType.COMPLIANCE_SUMMARY) {
        const findings = await this.findingRepo.find({
          where: { compliance_check_id: reportJob.compliance_check_id },
        });
        buffer = await this.pdf.buildComplianceSummary({
          ctx,
          check: ctx.check,
          findings,
        });
        reportName = 'Compliance Report';
      } else if (reportJob.report_type === ComplianceReportType.JURISDICTION_CONFLICT) {
        const findings = await this.findingRepo.find({
          where: { compliance_check_id: reportJob.compliance_check_id },
        });
        buffer = await this.pdf.buildJurisdictionConflict({
          ctx,
          check: ctx.check,
          findings,
        });
        reportName = 'Jurisdiction Conflict Report';
      } else {
        // OBLIGATIONS_REPORT
        const obligations = await this.obligationRepo.find({
          where: { contract_id: ctx.contract.id },
          order: { due_date: 'ASC' },
        });
        buffer = await this.pdf.buildObligationsReport({
          ctx,
          check: ctx.check,
          obligations,
        });
        reportName = 'Critical Obligations Report';
      }

      // Persist the PDF
      const filename = `compliance-${reportJob.id}.pdf`;
      const filePath = path.join(this.outputDir, filename);
      await fs.promises.writeFile(filePath, buffer);

      // Mint signed download token (24h)
      const { token, expires } = this.reportService.generateToken();
      const downloadUrl = this.reportService.buildDownloadUrl(token);

      await this.reportService.markEmailed(reportJob.id, filePath, token, expires);

      // Email the user
      await this.dispatch.enqueueEmail({
        to: ctx.user.email,
        subject: `[SIGN] Your ${reportName} is ready — ${ctx.contract.name}`,
        html: this.renderEmail({
          recipientName: ctx.user.first_name || ctx.user.email,
          reportName,
          contractName: ctx.contract.name,
          projectName: ctx.project.name,
          downloadUrl,
          expiresAt: expires.toUTCString(),
        }),
        templateName: 'compliance_report_ready',
      });

      this.logger.log(
        `Report emailed: type=${reportJob.report_type} → ${ctx.user.email}`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Report rendering failed: ${msg}`);
      await this.reportService.markFailed(reportJob.id, msg);
    }
  }

  private async loadContext(
    reportJob: ComplianceReportJob,
  ): Promise<ReportContext & { check: ComplianceCheck }> {
    const check = await this.checkRepo.findOne({
      where: { id: reportJob.compliance_check_id },
    });
    if (!check) throw new Error('Compliance check not found');
    const contract = await this.contractRepo.findOne({
      where: { id: check.contract_id },
    });
    if (!contract) throw new Error('Contract not found');
    const project = await this.projectRepo.findOne({
      where: { id: contract.project_id },
    });
    if (!project) throw new Error('Project not found');
    const org = project.organization_id
      ? await this.orgRepo.findOne({ where: { id: project.organization_id } })
      : null;
    const user = await this.userRepo.findOne({
      where: { id: reportJob.requested_by ?? '' },
    });
    if (!user) throw new Error('Requesting user not found');

    return {
      check,
      contract,
      project,
      organization: org,
      user,
      generatedAt: new Date(),
      jurisdiction: check.jurisdiction,
    };
  }

  private renderEmail(data: {
    recipientName: string;
    reportName: string;
    contractName: string;
    projectName: string;
    downloadUrl: string;
    expiresAt: string;
  }): string {
    const content = `
      <h1 style="margin:0 0 8px; font-size:22px; font-weight:700; color:#0F1729;">Your ${data.reportName} Is Ready</h1>
      <p style="font-size:14px; color:#4B5563; line-height:1.6;">
        Hi ${data.recipientName}, the report you requested for
        <strong>${data.contractName}</strong> (${data.projectName}) has been generated.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto;">
        <tr><td align="center">
          <a href="${data.downloadUrl}"
             style="display:inline-block; padding:14px 32px; background-color:#4F6EF7; color:#ffffff !important; font-size:14px; font-weight:600; text-decoration:none; border-radius:8px;">
            Download Report
          </a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0; font-size:12px; color:#9CA3AF; line-height:1.5;">
        This download link expires at ${data.expiresAt}. The report is provided as a watermarked,
        non-editable PDF. Please do not redistribute — it is confidential and intended for you.
      </p>
    `;
    return baseEmailLayout(content, {
      preheader: `Your ${data.reportName} is ready to download`,
    });
  }
}
