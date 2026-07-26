import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RedlineNotificationBatch } from '../../../database/entities';
import { RedlineNotificationService } from '../services/redline-notification.service';
import { RedlineEmailLang } from '../utils/recipient-language.util';
import {
  REDLINE_DIGEST_JOB,
  REDLINE_NOTIFICATION_QUEUE,
} from '../schedulers/redline-digest.scheduler';

/** One elapsed window, as claimed by the drain. */
interface DrainedWindow {
  id: string;
  contract_id: string;
  event_class: string;
  recipient_user_id: string | null;
  recipient_email: string | null;
  recipient_lang: string;
  pending_count: number;
  contract_name: string | null;
}

/**
 * 7.19 Slice 4 — flush elapsed debounce windows as ONE digest each.
 *
 * ══ CLAIM-BY-DELETE (at-most-once) ══
 * The drain DELETEs the elapsed rows and RETURNs them in a SINGLE statement, so
 * the delete IS the claim: a concurrent tick (or a Bull retry after a partial
 * failure) cannot re-read a window another worker already took, and no window
 * can be digested twice. The deliberate trade is at-most-once, not at-least-
 * once — for a best-effort courtesy notification, losing one beats spamming a
 * counterparty with duplicates.
 *
 * ══ NEVER TOUCHES REDLINE STATE ══
 * This processor reads and deletes ONLY `redline_notification_batches` (plus a
 * contract-name join for the copy). It never reads, writes, or decides anything
 * about a redline, a clause, a version, or the negotiation lane — a failed or
 * skipped digest is invisible to the negotiation.
 *
 * ══ PER-ROW ISOLATION ══
 * Each window sends inside its own try/catch (the MeteringCleanupProcessor
 * discipline), so one bad recipient cannot abort the tick for everyone else.
 * The handler itself never throws, so Bull never retries a partially-flushed
 * tick (which, given claim-by-delete, would have nothing left to flush anyway).
 *
 * ══ INDEX ALIGNMENT ══
 * The drain predicate is literally `window_ends_at < NOW()`, matching
 * `idx_redline_notification_batches_window_ends_at` exactly — no partial-index
 * predicate mismatch (the rule the metering sweeper's header documents).
 */
@Processor(REDLINE_NOTIFICATION_QUEUE)
export class RedlineDigestProcessor {
  private readonly logger = new Logger(RedlineDigestProcessor.name);

  /** Windows flushed per tick. Bounds one tick's work; the next tick drains the rest. */
  private static readonly BATCH_SIZE = 200;

  constructor(
    @InjectRepository(RedlineNotificationBatch)
    private readonly batchRepo: Repository<RedlineNotificationBatch>,
    private readonly notifications: RedlineNotificationService,
  ) {}

  @Process({ name: REDLINE_DIGEST_JOB, concurrency: 1 })
  async handleFlush(_job: Job<Record<string, never>>): Promise<void> {
    let windows: DrainedWindow[] = [];
    try {
      // Claim-by-delete. Bare rows array — the same shape the shipped
      // guest_upload_daily_counts UPSERT returns and the real-PG spec asserts.
      windows = await this.batchRepo.manager.query(
        `WITH claimed AS (
           DELETE FROM redline_notification_batches b
            WHERE b.id IN (
              SELECT id FROM redline_notification_batches
               WHERE window_ends_at < NOW()
               ORDER BY window_ends_at ASC
               LIMIT $1
            )
           RETURNING b.*
         )
         SELECT claimed.id,
                claimed.contract_id,
                claimed.event_class,
                claimed.recipient_user_id,
                claimed.recipient_email,
                claimed.recipient_lang,
                claimed.pending_count,
                c.name AS contract_name
           FROM claimed
           LEFT JOIN contracts c ON c.id = claimed.contract_id`,
        [RedlineDigestProcessor.BATCH_SIZE],
      );
    } catch (err) {
      this.logger.error(
        `redline.digest.drain_error: ${(err as Error)?.message}`,
      );
      return;
    }

    if (!windows.length) {
      return;
    }

    // pending_count === 0 ⇒ only the leading edge fired, nothing was
    // suppressed ⇒ the window simply closes with no digest. That is the
    // common case and must stay silent.
    const toSend = windows.filter((w) => Number(w.pending_count) > 0);
    let sent = 0;
    let failed = 0;

    for (const w of toSend) {
      try {
        await this.notifications.send({
          lang: (w.recipient_lang === 'ar' ? 'ar' : 'en') as RedlineEmailLang,
          variant:
            w.event_class === 'PROPOSED' ? 'digest_proposed' : 'digest_decided',
          contract: { id: w.contract_id, name: w.contract_name ?? '' },
          recipient: {
            userId: w.recipient_user_id,
            email: w.recipient_email,
            preferredLanguage: w.recipient_lang,
          },
          vars: {
            contractName: w.contract_name || w.contract_id,
            // NO actorName / clauseRef — a digest deliberately carries no
            // cross-org author detail, only a count and the contract name.
            count: Number(w.pending_count),
          },
        });
        sent++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `redline.digest.send_error contract=${w.contract_id} ` +
            `class=${w.event_class}: ${(err as Error)?.message}`,
        );
      }
    }

    this.logger.log(
      `redline.digest.flushed windows=${windows.length} sent=${sent} ` +
        `skipped_empty=${windows.length - toSend.length} failed=${failed}`,
    );
  }
}
