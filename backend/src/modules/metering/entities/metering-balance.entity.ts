import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

import { MeterKey } from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive.
 *
 * Derived projection. Holds the running `consumed` counter for each
 * (subject, meter_key, window_key). The reserve step performs an ATOMIC
 * CONDITIONAL UPDATE on this row:
 *
 *   UPDATE metering_balance
 *   SET    consumed = consumed + :amount
 *   WHERE  subject_ref = :s AND meter_key = :k AND window_key = :w
 *     AND  consumed + :amount <= :limit;
 *
 * Postgres row-level locking under READ COMMITTED handles concurrent
 * writers: the second writer blocks until the first commits, then
 * re-evaluates its WHERE predicate against the post-commit row. The
 * affected-row count is 0 when capacity is exhausted → reserve throws
 * METER_LIMIT_*.
 *
 * THIS IS A DELIBERATE EXCEPTION TO THE pessimistic_write IDIOM
 * established by Bucket 1's establishIdentity. The lock is held only for
 * the statement duration, not across an app round-trip — correct for a
 * single-hot-row counter decrement. See metering.service.ts for the
 * commentary that must accompany any future counter built on this shape.
 */
@Entity('metering_balance')
export class MeteringBalance {
  @PrimaryColumn({ type: 'uuid' })
  subject_ref: string;

  @PrimaryColumn({
    type: 'enum',
    enum: MeterKey,
    enumName: 'meter_key_enum',
  })
  meter_key: MeterKey;

  @PrimaryColumn({ type: 'varchar', length: 128 })
  window_key: string;

  @Column({ type: 'int', default: 0 })
  consumed: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
