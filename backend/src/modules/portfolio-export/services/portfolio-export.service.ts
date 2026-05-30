import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import {
  PortfolioExportJob,
  PortfolioExportStatus,
} from '../entities/portfolio-export-job.entity';

/**
 * Phase 7.17 Prompt 2c Bucket 2 — façade over the portfolio-export-jobs
 * queue and the portfolio_export_jobs table.
 *
 * Bucket 2 scope: createJob() only — the controller adapter for Bucket 3.
 * Status transitions during render live in the processor, not here.
 *
 * The controller (Bucket 3) is the sole caller: it builds the user-bound
 * payload (org_id from JWT, email captured at request time, period +
 * project filter from the validated DTO) and hands it to this method.
 */
@Injectable()
export class PortfolioExportService {
  private readonly logger = new Logger(PortfolioExportService.name);

  constructor(
    @InjectRepository(PortfolioExportJob)
    private readonly jobRepo: Repository<PortfolioExportJob>,
    @InjectQueue('portfolio-export-jobs')
    private readonly queue: Queue,
  ) {}

  /**
   * Persist a PENDING row, enqueue the render job, return the job id.
   *
   * The row is created in PENDING state with NO file_path and NO
   * expires_at — those are written by the processor once the render
   * succeeds. Until then, the verifier cannot find a COMPLETED row
   * and any token forged for this id returns 410 not_found.
   */
  async createJob(input: {
    userId: string;
    orgId: string;
    projectId: string | null;
    period: string;
    email: string;
  }): Promise<{ jobId: string }> {
    const row = this.jobRepo.create({
      user_id: input.userId,
      org_id: input.orgId,
      project_id: input.projectId,
      period: input.period,
      email: input.email,
      status: PortfolioExportStatus.PENDING,
    });
    const saved = await this.jobRepo.save(row);

    await this.queue.add(
      'render-export',
      { job_id: saved.id },
      // 1-attempt convention (Phase 7.17 Prompt 2c §13 + D2). Explicit
      // instead of relying on the queue default — same intent as the
      // explicit @Process({ concurrency: 1 }) on the processor.
      { attempts: 1, removeOnComplete: true, removeOnFail: false },
    );

    this.logger.log(`Portfolio export queued: jobId=${saved.id} period=${input.period}`);
    return { jobId: saved.id };
  }
}
