import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import * as crypto from 'crypto';
import {
  ComplianceCheck,
  ComplianceReportJob,
  ComplianceReportStatus,
  ComplianceReportType,
} from '../../../database/entities';

export interface RequestReportInput {
  checkId: string;
  reportType: ComplianceReportType;
  userId: string;
}

export interface ReportRequestResult {
  job_id: string;
  message: string;
  email: string;
}

const TOKEN_TTL_HOURS = 24;

/**
 * High-level service for the "email me a report" workflow.
 *
 *   1. Insert a `compliance_report_jobs` row in PENDING
 *   2. Enqueue a `render-report` BullMQ job
 *   3. Processor renders PDF, writes file, mints HMAC download token,
 *      and dispatches the email with the secure 24h link
 */
@Injectable()
export class ComplianceReportService {
  private readonly logger = new Logger(ComplianceReportService.name);

  constructor(
    @InjectRepository(ComplianceCheck)
    private readonly checkRepo: Repository<ComplianceCheck>,
    @InjectRepository(ComplianceReportJob)
    private readonly jobRepo: Repository<ComplianceReportJob>,
    @InjectQueue('compliance-jobs') private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async request(input: RequestReportInput): Promise<ComplianceReportJob> {
    const check = await this.checkRepo.findOne({ where: { id: input.checkId } });
    if (!check) throw new NotFoundException('Compliance check not found');

    const job = this.jobRepo.create({
      compliance_check_id: input.checkId,
      report_type: input.reportType,
      status: ComplianceReportStatus.PENDING,
      requested_by: input.userId,
    });
    const saved = await this.jobRepo.save(job);

    await this.queue.add(
      'render-report',
      { job_id: saved.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      `Compliance report requested: type=${input.reportType} jobId=${saved.id}`,
    );
    return saved;
  }

  async findById(id: string): Promise<ComplianceReportJob | null> {
    return this.jobRepo.findOne({ where: { id } });
  }

  async findByToken(token: string): Promise<ComplianceReportJob | null> {
    if (!token) return null;
    const job = await this.jobRepo.findOne({ where: { download_token: token } });
    if (!job) return null;
    if (!job.expires_at || job.expires_at < new Date()) return null;
    return job;
  }

  // ─── Used by the processor ────────────────────────────────

  async markRendering(jobId: string): Promise<void> {
    await this.jobRepo.update(jobId, {
      status: ComplianceReportStatus.RENDERING,
    });
  }

  async markEmailed(
    jobId: string,
    filePath: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.jobRepo.update(jobId, {
      status: ComplianceReportStatus.EMAILED,
      file_path: filePath,
      download_token: token,
      expires_at: expiresAt,
      emailed_at: new Date(),
    });
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await this.jobRepo.update(jobId, {
      status: ComplianceReportStatus.FAILED,
      error_message: error,
    });
  }

  generateToken(): { token: string; expires: Date } {
    const token = crypto.randomBytes(32).toString('base64url').slice(0, 64);
    const expires = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
    return { token, expires };
  }

  buildDownloadUrl(token: string): string {
    const base = this.config.get<string>('BASE_URL', 'http://localhost:3000');
    return `${base}/api/v1/compliance/reports/download?token=${token}`;
  }
}
