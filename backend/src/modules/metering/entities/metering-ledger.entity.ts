import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';

import { MeterKey, MeterLedgerStatus } from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive.
 *
 * Append-only ledger. SOURCE OF TRUTH for the metering system; the running
 * counter in `metering_balance` is a DERIVED PROJECTION the reserve step
 * writes against.
 *
 * Lifecycle: reserved → committed (work succeeded) | released (work failed,
 * capacity returned). Released rows stay in the table forever; this is an
 * audit log.
 *
 * Idempotency: composite UNIQUE (subject_ref, meter_key, idempotency_key)
 * — Pattern C (audit §9.1). Re-submitting the same key returns the existing
 * row unchanged. No error, no double-charge, no double-reserve. This
 * mirrors the codebase's existing idempotency shape used by guest-
 * invitation revoke / exchange / establish-identity race-guard.
 *
 * `actor_ref` and `contract_ref` are ATTRIBUTION, not SUBJECT. `subject_ref`
 * is the org that owns the contract — derived uniformly by
 * MeteringResolver, never trusted from a guest's JWT.
 *
 * No FK on actor_ref / contract_ref: a guest user or a contract deleted
 * later should NOT cause us to lose the audit row. subject_ref IS FK'd
 * to organizations(id) at the DDL layer (RESTRICT) — losing the org wipes
 * the metering history with it.
 */
@Entity('metering_ledger')
@Unique('uq_metering_ledger_subject_meter_idem', [
  'subject_ref',
  'meter_key',
  'idempotency_key',
])
@Unique('uq_metering_ledger_reservation_id', ['reservation_id'])
export class MeteringLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_metering_ledger_subject_meter')
  @Column({ type: 'uuid' })
  subject_ref: string;

  @Column({ type: 'uuid' })
  actor_ref: string;

  @Column({ type: 'uuid', nullable: true })
  contract_ref: string | null;

  @Column({
    type: 'enum',
    enum: MeterKey,
    enumName: 'meter_key_enum',
  })
  meter_key: MeterKey;

  @Column({ type: 'varchar', length: 128 })
  window_key: string;

  @Column({ type: 'int' })
  amount: number;

  @Column({
    type: 'enum',
    enum: MeterLedgerStatus,
    enumName: 'meter_ledger_status_enum',
    default: MeterLedgerStatus.RESERVED,
  })
  status: MeterLedgerStatus;

  @Column({ type: 'varchar', length: 128 })
  idempotency_key: string;

  @Column({ type: 'uuid' })
  reservation_id: string;

  @Column({ type: 'timestamptz' })
  reserved_at: Date;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  committed_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  released_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  /**
   * Reserved-room jsonb for the token-true-cost / model / provider /
   * job_id fields that will land in Part 2+ when ai-backend captures
   * `message.usage` (audit §3 / §B.4 — deliberate v1 deferral).
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, any>;
}
