import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

/**
 * Guest extraction completion — SERVER-SIDE driver scheduler.
 *
 * The extraction pipeline is poll-driven: a doc only advances
 * EXTRACTING_TEXT → EXTRACTING_CLAUSES → CLAUSES_EXTRACTED when SOMETHING calls
 * the advance with the AI job complete. Before this, the ONLY drivers were
 * browser polls — and the guest poll capped at 120s while Arabic clause
 * extraction takes ~260s, so a guest who closed/refreshed the tab left the doc
 * stranded at EXTRACTING_CLAUSES forever (the completed result sat unused in
 * Redis) — a poll-driven pipeline whose only driver outlived the AI job.
 *
 * This registers a repeatable SYSTEM job that ticks every 30s and advances any
 * in-progress upload to terminal — completely independent of any browser. The
 * browser poll is now DISPLAY-ONLY (it still drives the fast path when open, but
 * is no longer required for completion). Mirrors MeteringCleanupScheduler /
 * PortfolioExportCleanupScheduler exactly (idempotent register-on-boot).
 */
@Injectable()
export class DocumentExtractionScheduler implements OnModuleInit {
  private readonly logger = new Logger(DocumentExtractionScheduler.name);

  constructor(
    @InjectQueue('document-processing-jobs')
    private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // Idempotent: clear any pre-existing repeatable job by name, then add fresh.
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === 'advance-in-progress') {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }

    await this.queue.add(
      'advance-in-progress',
      {},
      {
        // 30s cadence — snappy enough as a backstop without polling the AI
        // service every second. The browser fast-path (when open) completes a
        // doc within ~2s; this guarantees completion when no browser is open.
        repeat: { every: 30_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      'Document extraction driver scheduler initialised: every 30s, advance in-progress uploads to terminal (browser-independent)',
    );
  }
}
