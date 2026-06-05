import {
  Injectable,
  Logger,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';

import { MeteringResolver, MeteringCaller } from './metering-resolver.service';
import { MeterDefinition } from '../entities/meter-definition.entity';
import { MeteringBalance } from '../entities/metering-balance.entity';
import {
  MeterKey,
  MeterLedgerStatus,
  MeterFailMode,
} from '../enums/meter-key.enum';
import { MeterLimitExceededError } from '../errors/meter-limit-exceeded.error';

/**
 * Phase 7.18 — Metering Primitive AUTHORITY.
 *
 * Single service callable from all three Bucket-1 caller shapes.
 *
 *   reserve   — atomic capacity claim. Returns a Reservation handle.
 *   commit    — flip reserved → committed. Capacity stays consumed (it
 *               was taken at reserve).
 *   release   — flip reserved → released AND give the capacity back.
 *               Idempotent: re-release is a no-op.
 *
 * Mirrors the ContractAccessService authority pattern (one service, called
 * from everywhere, never bypassed). Compose into Part 2 consumers; do NOT
 * call the repository directly from a consumer.
 *
 * ATOMIC CONDITIONAL DECREMENT (NEW PATTERN — IS NOT pessimistic_write):
 *
 *   UPDATE metering_balance
 *   SET    consumed = consumed + :amount
 *   WHERE  subject_ref = :s AND meter_key = :k AND window_key = :w
 *     AND  consumed + :amount <= :limit;
 *
 * Postgres holds the row-level lock for the statement's duration only. Two
 * concurrent reserves on the same (subject, meter_key, window_key) row
 * serialize on the lock; the second writer re-evaluates its predicate
 * after the first commits. Affected rows = 0 means the limit was hit;
 * we throw METER_LIMIT_*.
 *
 * This is DELIBERATELY DIFFERENT from the establishIdentity
 * SELECT-FOR-UPDATE pattern. setLock('pessimistic_write') is correct for a
 * "load row, decide, mutate" flow across an app round-trip. The meter
 * reserve has no app-round-trip between "is there capacity?" and "take
 * it" — Postgres can decide both in one statement, and holding a longer
 * lock would amplify contention on the hot counter row. Future single-hot-
 * row counters should follow this; the inconsistency with Bucket 1's
 * locking shape is INTENTIONAL.
 */

/**
 * Reservation TTL.
 *
 * 1 hour — bounds the Celery `result_expires=3600` dangling window (audit
 * §B.8). A reserve that the consumer never reconciles within this window
 * is swept by the cleanup processor and capacity returned.
 *
 * Hardening-pass note: this MUST exceed the maximum end-to-end job
 * duration of every consumer that calls reserve(), or the sweeper will
 * release capacity for an in-flight job and the eventual commit() will
 * land as a no-op (work succeeded but is recorded as released — i.e. un-
 * charged). The TTL-sizing requirement is documented in
 * `docs/metering-doc-deltas.md` as the Part 2 staging-gate.
 *
 * Spec-mandated as a module CONST. Do NOT promote to env-driven without
 * also adding a Joi entry + `.env.example` line in the same commit
 * (Phase 1.5 hard rule).
 */
const RESERVATION_TTL_SECONDS = 60 * 60;

export interface ReserveInput {
  caller: MeteringCaller;
  meterKey: MeterKey;
  amount: number;
  idempotencyKey: string;
  contractId?: string | null;
  actorRef: string; // who is doing the work (user id, or invitation id for viewers)
  metadata?: Record<string, any>;
}

export interface Reservation {
  reservation_id: string;
  ledger_id: string;
  subject_ref: string;
  meter_key: MeterKey;
  window_key: string;
  amount: number;
  expires_at: Date;
  reused: boolean; // true when an existing ledger row was returned (Pattern C idempotency)
}

/**
 * Result of a commit / release / sweeper transition.
 *
 * `applied=true` means THIS call performed the state transition (the
 * single conditional UPDATE affected the row). `applied=false` means the
 * row was already in a terminal state and this call was a NO-OP — `status`
 * then reports the row's current terminal state, or `'missing'` if no
 * row exists for the id.
 *
 * This shape exists so callers can audit-log the difference between "I
 * made the change" and "someone else got there first" — the meter cares
 * about that distinction even when both outcomes are safe.
 */
export type TransitionResult = {
  applied: boolean;
  status: MeterLedgerStatus | 'missing';
};

@Injectable()
export class MeteringService implements OnModuleInit {
  private readonly logger = new Logger(MeteringService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly resolver: MeteringResolver,
  ) {}

  /**
   * STARTUP INVARIANT — READ COMMITTED isolation is required.
   *
   * The entire reserve/commit/release lifecycle's correctness depends on
   * Postgres READ COMMITTED semantics:
   *
   *   • reserve()'s atomic conditional UPDATE relies on EvalPlanQual:
   *     concurrent UPDATEs on the same balance row block on the row
   *     lock, then re-read the row's post-commit value and re-evaluate
   *     the predicate. Under REPEATABLE READ this would instead throw
   *     `40001 could not serialize access due to concurrent update` and
   *     the second writer would need to retry — a strictly different
   *     failure mode the engine does NOT handle.
   *
   *   • reserve()'s ON CONFLICT DO NOTHING block-wait + same-txn SELECT
   *     of the existing row relies on each statement reading the latest
   *     committed snapshot. REPEATABLE READ would freeze the snapshot
   *     at txn start, and the SELECT after ON CONFLICT would NOT see
   *     the peer's just-committed ledger row.
   *
   *   • commit/release status-guarded UPDATE relies on the same
   *     EvalPlanQual semantics for at-most-once transitions.
   *
   * This assertion fails the application boot if Postgres is configured
   * with anything other than `read committed` as the session default. A
   * future ops change to default_transaction_isolation MUST be paired
   * with a redesign of the gates above — the failure here forces the
   * conversation rather than letting silent corruption ship.
   *
   * The check runs once at boot. It does NOT re-check per transaction —
   * an attacker who changes session isolation mid-request would already
   * have broken assumptions elsewhere; engine-level paranoia stops here.
   */
  async onModuleInit(): Promise<void> {
    const result = await this.dataSource.query(`SHOW transaction_isolation`);
    const level = result?.[0]?.transaction_isolation;
    if (level !== 'read committed') {
      throw new Error(
        `MeteringService refuses to start: requires Postgres ` +
          `transaction_isolation='read committed', got '${level}'. ` +
          `The reserve / commit / release gates rely on READ COMMITTED ` +
          `semantics (EvalPlanQual + per-statement snapshots). Changing ` +
          `the isolation level requires a deliberate redesign — see ` +
          `docs/metering-doc-deltas.md (Part 1.7 / G.2).`,
      );
    }
    this.logger.log(
      `Metering engine isolation invariant satisfied: transaction_isolation='${level}'`,
    );
  }

  /**
   * Atomic reserve.
   *
   * Order of operations inside the transaction:
   *   1. resolve subject, window_key, limit, definition (for fail_mode).
   *   2. Pattern C idempotency: if a ledger row exists for
   *      (subject, meter_key, idempotency_key), return it unchanged.
   *   3. ensure a metering_balance row via INSERT ... ON CONFLICT DO NOTHING.
   *   4. ATOMIC CONDITIONAL UPDATE — the gate. 0 rows affected → throw
   *      METER_LIMIT_<KEY>.
   *   5. INSERT ledger row status=reserved.
   *
   * fail_mode governs behaviour when steps 1-4 ERROR (vs. when the limit is
   * legitimately reached). 'closed' = re-throw; 'open' = swallow the error
   * and return a synthetic "no-op" reservation so the consumer can proceed
   * (audit-logged). compliance is 'closed' — never open without an
   * explicit decision per-meter.
   */
  async reserve(input: ReserveInput): Promise<Reservation> {
    if (input.amount <= 0) {
      throw new InternalServerErrorException(
        `MeteringService.reserve: amount must be > 0, got ${input.amount}`,
      );
    }

    // Resolve subject + window_key + limit OUTSIDE the txn so resolver errors
    // are visible distinct from txn errors. The limit COULD change between
    // resolution and the conditional UPDATE; that's fine — at worst we'd
    // accept-or-reject vs a value within ±1 update of the truth. Subject
    // and window key are stable for the request.
    let subjectRef: string;
    let windowKey: string;
    let limit: number;
    try {
      subjectRef = await this.resolver.resolveMeteringSubject(
        input.caller,
        input.contractId ?? '',
      );
      windowKey = await this.resolver.computeWindowKey(input.meterKey, {
        contractId: input.contractId,
      });
      limit = await this.resolver.resolveLimit(subjectRef, input.meterKey);
    } catch (err) {
      // Engine-level error during resolution — apply fail_mode at the
      // safest layer we can see. If we couldn't even load the definition,
      // default to CLOSED.
      const def = await this.dataSource
        .getRepository(MeterDefinition)
        .findOne({ where: { meter_key: input.meterKey } })
        .catch(() => null);
      if (def && def.fail_mode === MeterFailMode.OPEN) {
        this.logger.warn(
          `[metering.reserve] Resolver error on ${input.meterKey} but fail_mode=open — allowing. ${(err as Error).message}`,
        );
        return this.openModeNoOp(input, '<unresolved>', '<unresolved>');
      }
      throw err;
    }

    return this.dataSource.transaction(async (manager) => {
      // ──────────────────────────────────────────────────────────────────
      // STEP 2 — IDEMPOTENCY CLAIM via INSERT-FIRST + ON CONFLICT DO NOTHING.
      //
      // The unique index `uq_metering_ledger_subject_meter_idem` on
      // (subject_ref, meter_key, idempotency_key) is the gate. The
      // INSERT statement either:
      //   - wins the race → RETURNING yields one row → fall through to
      //     STEP 3-4 (ensure balance + atomic decrement).
      //   - loses the race → ON CONFLICT DO NOTHING → RETURNING yields
      //     zero rows → SELECT the existing row and return `reused:true`.
      //
      // This is the ATOMIC same-key dedup. The old code (read-then-write
      // via `findOne` then `save`) had a race where N concurrent same-key
      // callers all passed findOne (their snapshots were taken before any
      // peer committed), all reached the decrement, and only one INSERT
      // survived — the rest threw raw 23505 errors (Case A) or
      // MeterLimitExceeded under saturated limit (Case B). Both violated
      // Pattern C. The atomic gate fixes both.
      //
      // On capacity failure later in STEP 4, the transaction rolls back
      // the just-inserted ledger row WITH the decrement, so the
      // idempotency claim does NOT persist when capacity was denied — a
      // retry with the same key later (after capacity frees up) will
      // succeed cleanly.
      // ──────────────────────────────────────────────────────────────────
      const reservationId = randomUUID();
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + RESERVATION_TTL_SECONDS * 1000,
      );

      const insertRaw = await manager.query(
        `
        INSERT INTO metering_ledger
          (subject_ref, actor_ref, contract_ref, meter_key, window_key,
           amount, status, idempotency_key, reservation_id, reserved_at,
           expires_at, metadata)
        VALUES
          ($1, $2, $3, $4, $5, $6, 'reserved', $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (subject_ref, meter_key, idempotency_key) DO NOTHING
        RETURNING id, reservation_id, amount, window_key, expires_at
      `,
        [
          subjectRef,
          input.actorRef,
          input.contractId ?? null,
          input.meterKey,
          windowKey,
          input.amount,
          input.idempotencyKey,
          reservationId,
          now,
          expiresAt,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      const insertedRows = this.readReturningRows(insertRaw);

      if (insertedRows.length === 0) {
        // Lost the race — a concurrent peer with the same idempotency_key
        // won. SELECT the existing row and return it as reused.
        //
        // Under READ COMMITTED, ON CONFLICT DO NOTHING block-waits on the
        // peer's index lock until the peer's txn commits or aborts; if
        // committed, the SELECT below sees the persisted row.
        const existingRows = await manager.query(
          `
          SELECT id, reservation_id, amount, window_key, expires_at
          FROM   metering_ledger
          WHERE  subject_ref = $1
            AND  meter_key = $2
            AND  idempotency_key = $3
        `,
          [subjectRef, input.meterKey, input.idempotencyKey],
        );
        if (!Array.isArray(existingRows) || existingRows.length === 0) {
          // Should be unreachable: ON CONFLICT fired, so a peer's
          // persisted row exists. If we get here, the peer was aborted
          // AND we somehow lost the race anyway — surface the anomaly.
          throw new InternalServerErrorException(
            `MeteringService.reserve: ON CONFLICT fired but no existing ` +
              `ledger row found for (subject=${subjectRef}, meter=${input.meterKey}, key=${input.idempotencyKey}). ` +
              `Likely a peer transaction aborted at an unusual time; retry.`,
          );
        }
        const existing = existingRows[0] as {
          id: string;
          reservation_id: string;
          amount: number;
          window_key: string;
          expires_at: Date;
        };
        return {
          reservation_id: existing.reservation_id,
          ledger_id: existing.id,
          subject_ref: subjectRef,
          meter_key: input.meterKey,
          window_key: existing.window_key,
          amount: existing.amount,
          expires_at: existing.expires_at,
          reused: true,
        };
      }

      // ──────────────────────────────────────────────────────────────────
      // We won the idempotency race. Now run the capacity gate.
      // If the conditional decrement fails, the transaction aborts and
      // the just-inserted ledger row rolls back automatically. Net
      // invariant: capacity denied AND no idempotency claim persists.
      // ──────────────────────────────────────────────────────────────────
      const insertedLedger = insertedRows[0] as {
        id: string;
        reservation_id: string;
      };

      // STEP 3 — ensure a metering_balance row exists. ON CONFLICT DO NOTHING
      // is idempotent: concurrent reservers can both INSERT and only one
      // wins; the loser's INSERT is dropped silently and STEP 4 still acts
      // on the row that exists.
      await manager.query(
        `
        INSERT INTO metering_balance (subject_ref, meter_key, window_key, consumed, updated_at)
        VALUES ($1, $2, $3, 0, NOW())
        ON CONFLICT (subject_ref, meter_key, window_key) DO NOTHING
      `,
        [subjectRef, input.meterKey, windowKey],
      );

      // STEP 4 — ATOMIC CONDITIONAL UPDATE (the capacity gate).
      //
      // The predicate `consumed + $amount <= $limit` enforces the cap;
      // 0 affected rows means the predicate failed → throw, txn rolls
      // back, ledger INSERT we did in STEP 2 is undone.
      const updateRaw = await manager.query(
        `
        UPDATE metering_balance
        SET    consumed = consumed + $1,
               updated_at = NOW()
        WHERE  subject_ref = $2 AND meter_key = $3 AND window_key = $4
          AND  consumed + $1 <= $5
        RETURNING consumed
      `,
        [input.amount, subjectRef, input.meterKey, windowKey, limit],
      );
      const affectedRowCount = this.readAffectedCount(updateRaw);

      if (affectedRowCount === 0) {
        // Capacity not granted. Read current consumed for the error
        // payload. Then throw — the transaction's rollback undoes the
        // ledger INSERT from STEP 2, so the idempotency claim doesn't
        // persist when capacity was denied.
        const current = await manager.query(
          `
          SELECT consumed
          FROM   metering_balance
          WHERE  subject_ref = $1 AND meter_key = $2 AND window_key = $3
        `,
          [subjectRef, input.meterKey, windowKey],
        );
        const consumed: number =
          Array.isArray(current) && current[0]
            ? Number(current[0].consumed)
            : 0;

        throw new MeterLimitExceededError(input.meterKey, limit, consumed);
      }

      return {
        reservation_id: insertedLedger.reservation_id,
        ledger_id: insertedLedger.id,
        subject_ref: subjectRef,
        meter_key: input.meterKey,
        window_key: windowKey,
        amount: input.amount,
        expires_at: expiresAt,
        reused: false,
      };
    });
  }

  /**
   * Commit a reservation: flip reserved → committed via a SINGLE atomic
   * conditional UPDATE. No balance change (capacity was taken at reserve).
   *
   * Race-safe by construction: the UPDATE's `WHERE status = 'reserved'`
   * predicate is the gate. Postgres row-level locking under READ COMMITTED
   * ensures that of N concurrent commit / release / sweep callers on the
   * same reservation, exactly ONE sees `affected = 1`. The losers see
   * `affected = 0` and return `applied: false`. Never flips
   * released → committed; never touches consumed.
   *
   * Swept-then-late-commit semantics (the realistic Part 2 hazard): if the
   * sweeper released the reservation before the consumer's commit() lands,
   * the commit is a NO-OP that returns `{applied:false, status:'released'}`.
   * The work was effectively un-charged (capacity refunded, even though
   * downstream succeeded). This is documented as the TTL-sizing
   * requirement for Part 2 — reservation TTL MUST exceed the max
   * end-to-end job duration of every consumer that calls reserve().
   * Caller is responsible for surfacing applied=false to ops; do NOT
   * throw here because under realistic concurrency this would be a
   * routine signal, not a fatal.
   */
  async commit(reservationId: string): Promise<TransitionResult> {
    return this.dataSource.transaction(async (manager) => {
      const updateRaw = await manager.query(
        `
        UPDATE metering_ledger
        SET    status = 'committed',
               committed_at = NOW()
        WHERE  reservation_id = $1 AND status = 'reserved'
      `,
        [reservationId],
      );
      const affected = this.readAffectedCount(updateRaw);

      if (affected === 1) {
        return { applied: true, status: MeterLedgerStatus.COMMITTED };
      }

      // Lost the race or no such row — read current state for the caller.
      const [row] = await manager.query(
        `SELECT status FROM metering_ledger WHERE reservation_id = $1`,
        [reservationId],
      );
      if (!row) {
        return { applied: false, status: 'missing' };
      }
      return { applied: false, status: row.status as MeterLedgerStatus };
    });
  }

  /**
   * Release a reservation: flip reserved → released via a SINGLE atomic
   * conditional UPDATE, AND refund consumed ONLY when that UPDATE
   * actually affected the row.
   *
   * Race-safe by construction:
   *   1. UPDATE metering_ledger SET status='released'
   *      WHERE reservation_id = $1 AND status = 'reserved'.
   *      Affected = 1 → THIS call won the race.
   *      Affected = 0 → a peer (release, commit, or sweeper) got there
   *      first; return applied:false.
   *   2. ONLY IF step 1 affected the row, refund consumed.
   * Refund is at-most-once across ANY number of concurrent
   * release / releaseByLedgerId / commit callers on the same reservation.
   *
   * The amount/subject/meter/window are read from the UPDATE's RETURNING
   * clause — never from a separate SELECT, which would itself race.
   * Without RETURNING, the only way to refund is to read the ledger row
   * first, and that read can no longer be racy because the gate already
   * fired; but RETURNING is one fewer round-trip and avoids re-reading
   * the row we just wrote.
   *
   * Refund is `consumed - amount` (no GREATEST(.., 0) clamp). The DDL
   * CHECK (consumed >= 0) guards against the should-be-unreachable case
   * where a future bug would otherwise drive the counter below zero —
   * the CHECK violation aborts the transaction, which also rolls back
   * the status UPDATE, leaving the ledger consistent. Clamping with
   * GREATEST hides the symptom rather than detecting drift.
   */
  async release(reservationId: string): Promise<TransitionResult> {
    return this.dataSource.transaction(async (manager) => {
      const updateRaw = await manager.query(
        `
        UPDATE metering_ledger
        SET    status = 'released',
               released_at = NOW()
        WHERE  reservation_id = $1 AND status = 'reserved'
        RETURNING amount, subject_ref, meter_key, window_key
      `,
        [reservationId],
      );
      const affected = this.readAffectedCount(updateRaw);

      if (affected === 0) {
        const [row] = await manager.query(
          `SELECT status FROM metering_ledger WHERE reservation_id = $1`,
          [reservationId],
        );
        if (!row) {
          return { applied: false, status: 'missing' };
        }
        return { applied: false, status: row.status as MeterLedgerStatus };
      }

      const refund = this.readReturningRows(updateRaw)[0] as {
        amount: number;
        subject_ref: string;
        meter_key: string;
        window_key: string;
      };

      await manager.query(
        `
        UPDATE metering_balance
        SET    consumed = consumed - $1,
               updated_at = NOW()
        WHERE  subject_ref = $2 AND meter_key = $3 AND window_key = $4
      `,
        [
          refund.amount,
          refund.subject_ref,
          refund.meter_key,
          refund.window_key,
        ],
      );

      return { applied: true, status: MeterLedgerStatus.RELEASED };
    });
  }

  /**
   * Sweep-by-id used by the cleanup processor. Same atomic + status-
   * guarded shape as release(), but keyed by ledger.id, and ADDITIONALLY
   * guarded on `expires_at < NOW()` so a non-expired reservation can never
   * be reaped — defense in depth against a future query-shape bug that
   * accidentally surfaces a live reserve to the processor.
   *
   * Refund semantics identical to release(): at most one of N concurrent
   * commit / release / sweep callers ever wins the conditional UPDATE
   * and thus ever runs the balance refund.
   */
  async releaseByLedgerId(
    ledgerId: string,
    em?: EntityManager,
  ): Promise<TransitionResult> {
    const work = async (
      manager: EntityManager,
    ): Promise<TransitionResult> => {
      const updateRaw = await manager.query(
        `
        UPDATE metering_ledger
        SET    status = 'released',
               released_at = NOW()
        WHERE  id = $1 AND status = 'reserved' AND expires_at < NOW()
        RETURNING amount, subject_ref, meter_key, window_key
      `,
        [ledgerId],
      );
      const affected = this.readAffectedCount(updateRaw);

      if (affected === 0) {
        const [row] = await manager.query(
          `SELECT status FROM metering_ledger WHERE id = $1`,
          [ledgerId],
        );
        if (!row) return { applied: false, status: 'missing' };
        return { applied: false, status: row.status as MeterLedgerStatus };
      }

      const refund = this.readReturningRows(updateRaw)[0] as {
        amount: number;
        subject_ref: string;
        meter_key: string;
        window_key: string;
      };

      await manager.query(
        `
        UPDATE metering_balance
        SET    consumed = consumed - $1,
               updated_at = NOW()
        WHERE  subject_ref = $2 AND meter_key = $3 AND window_key = $4
      `,
        [
          refund.amount,
          refund.subject_ref,
          refund.meter_key,
          refund.window_key,
        ],
      );

      return { applied: true, status: MeterLedgerStatus.RELEASED };
    };

    if (em) {
      return work(em);
    }
    return this.dataSource.transaction(work);
  }

  /**
   * TypeORM 0.3 result-shape helpers.
   *
   * For Postgres, `manager.query()` on UPDATE/DELETE with RETURNING returns
   * the 2-tuple `[rows, rowCount]`. Without RETURNING the shape depends on
   * the driver path — sometimes the same 2-tuple, sometimes just the
   * rowCount. These helpers are the single place that knows that wart so
   * a future TypeORM bump can localise the change here.
   *
   * The original Part-1 race test caught a buggy `result.length === 0`
   * check on the OUTER tuple (always 2). The hardening pass extracted
   * these helpers so the wart isn't re-implemented per call site.
   */
  private readAffectedCount(raw: unknown): number {
    if (Array.isArray(raw) && typeof raw[1] === 'number') {
      return raw[1];
    }
    if (Array.isArray(raw)) {
      // Without RETURNING, some TypeORM paths return just the rows array.
      // The count is its length.
      return raw.length;
    }
    if (typeof raw === 'number') return raw;
    return 0;
  }

  private readReturningRows(raw: unknown): Array<Record<string, any>> {
    if (Array.isArray(raw) && Array.isArray(raw[0])) {
      return raw[0] as Array<Record<string, any>>;
    }
    if (Array.isArray(raw)) {
      return raw as Array<Record<string, any>>;
    }
    return [];
  }

  /**
   * fail_mode=OPEN no-op reservation. Returns a synthetic Reservation that
   * downstream code can pass to commit()/release() without effect.
   *
   * commit/release on a no-op reservation_id throws InternalServerError —
   * the reservation row genuinely doesn't exist. That's an unavoidable
   * trade: if a meter is wired open AND its resolver was failing, downstream
   * code that tries to commit a "real" reservation will surface the
   * mismatch. The alternative (writing a ledger row for the no-op) defeats
   * the point of open mode (no DB write on the failure path).
   */
  private openModeNoOp(
    input: ReserveInput,
    subjectRef: string,
    windowKey: string,
  ): Reservation {
    return {
      reservation_id: '00000000-0000-0000-0000-000000000000',
      ledger_id: '00000000-0000-0000-0000-000000000000',
      subject_ref: subjectRef,
      meter_key: input.meterKey,
      window_key: windowKey,
      amount: input.amount,
      expires_at: new Date(0),
      reused: false,
    };
  }
}
