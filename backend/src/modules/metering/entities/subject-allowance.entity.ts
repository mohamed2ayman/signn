import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';

import { MeterKey } from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive.
 *
 * Per-subject (per-org) override of plan_allowance. Highest-precedence in
 * the resolver:
 *   subject_allowance ?? plan_allowance ?? meter_definition.default_limit.
 *
 * `subject_ref` is an org id today (managing-party path); the column is
 * deliberately not FK'd to `users` so the same shape can later cover any
 * subject the design generalises to without a schema change. The
 * organizations FK is enforced at the DDL layer in the migration.
 */
@Entity('subject_allowances')
@Unique('uq_subject_allowances_subject_meter', ['subject_ref', 'meter_key'])
export class SubjectAllowance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_subject_allowances_subject_ref')
  @Column({ type: 'uuid' })
  subject_ref: string;

  @Column({
    type: 'enum',
    enum: MeterKey,
    enumName: 'meter_key_enum',
  })
  meter_key: MeterKey;

  @Column({ name: 'limit', type: 'int' })
  limit: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
