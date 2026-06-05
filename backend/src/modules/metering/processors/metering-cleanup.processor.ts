import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';

import { MeteringLedger } from '../entities/metering-ledger.entity';
import { MeteringService } from '../services/metering.service';
import { MeterLedgerStatus } from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive: dangling-reserve sweeper.
 *
 * Runs every 5 minutes via MeteringCleanupScheduler. Releases reservations
 * where status='reserved' AND expires_at < NOW(), reusing the canonical
 * release() path (so balance accounting stays in one place).
 *
 * FAIL-SAFE DIRECTION: a stale reserve only causes OVER-DENIAL (a future
 * call sees consumed too high → false METER_LIMIT_*), never OVERSELL. The
 * sweeper reclaims the capacity; until then, the system errs strict, which
 * is correct for billed surfaces.
 *
 * Query shape MUST match the partial index from migration
 *   idx_metering_ledger_reserved_expires_at
 *     ON metering_ledger (expires_at)
 *     WHERE status = 'reserved'
 * Without the explicit `status = 'reserved'` WHERE clause, the planner
 * falls back to seq scan at scale (audit lesson #134/#135 about
 * partial-index predicate alignment, mirrored from portfolio-export
 * cleanup processor).
 */
@Processor('metering-jobs')
export class MeteringCleanupProcessor {
  private readonly logger = new Logger(MeteringCleanupProcessor.name);

  private static readonly BATCH_SIZE = 100;

  constructor(
    @InjectRepository(MeteringLedger)
    private readonly ledgerRepo: Repository<MeteringLedger>,
    private readonly metering: MeteringService,
  ) {}

  @Process({ name: 'cleanup-dangling-reserves', concurrency: 1 })
  async handleCleanup(_job: Job<Record<string, never>>): Promise<void> {
    // Predicate carries `status = 'reserved'` explicitly so the partial
    // index is used (#134/#135 carry-forward). Order by expires_at ASC so
    // the oldest dangling reserves are reclaimed first.
    const candidates = await this.ledgerRepo
      .createQueryBuilder('l')
      .where('l.status = :s', { s: MeterLedgerStatus.RESERVED })
      .andWhere('l.expires_at < NOW()')
      .orderBy('l.expires_at', 'ASC')
      .limit(MeteringCleanupProcessor.BATCH_SIZE)
      .select(['l.id'])
      .getMany();

    if (candidates.length === 0) {
      this.logger.debug(
        'Metering cleanup tick: no dangling reserves to sweep',
      );
      return;
    }

    let succeeded = 0;
    let failed = 0;
    for (const row of candidates) {
      try {
        // releaseByLedgerId is idempotent: a row that flipped to released
        // or committed between SELECT and UPDATE is a no-op.
        await this.metering.releaseByLedgerId(row.id);
        succeeded++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Metering cleanup: failed to release ledger ${row.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Metering cleanup tick: released ${succeeded}/${candidates.length} ` +
        `dangling reserves (failures: ${failed})`,
    );
  }
}
