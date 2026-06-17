import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ErpSyncService } from '../services/erp-sync.service';

interface RunSyncJob {
  job_id: string;
}

/**
 * Phase 7.28 — ERP sync queue processor.
 *
 * All ERP calls run here, off the request path (ARCHITECTURE RULE 2 generalized
 * beyond AI — slow external calls never run in a controller). Explicit
 * `concurrency: 1` per #13. The engine's status-guarded claim makes a
 * re-delivered job a safe no-op.
 */
@Processor('erp-sync-jobs')
export class ErpSyncProcessor {
  private readonly logger = new Logger(ErpSyncProcessor.name);

  constructor(private readonly sync: ErpSyncService) {}

  @Process({ name: 'run-sync', concurrency: 1 })
  async handleRunSync(job: Job<RunSyncJob>): Promise<void> {
    const jobId = job.data.job_id;
    this.logger.log(`Running ERP sync jobId=${jobId}`);
    await this.sync.executeJob(jobId);
  }
}
