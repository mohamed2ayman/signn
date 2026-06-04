import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  MeterKey,
  MeterWindowType,
  MeterFailMode,
} from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive.
 *
 * The catalogue. One row per `meter_key`. Created by ops; existence of a
 * row is what "activates" a meter. `default_limit` is the fall-through
 * limit when neither a subject_allowance nor a plan_allowance is set
 * (audit §B.1: a fresh DB with zero plan rows must still meter — this is
 * how it does).
 */
@Entity('meter_definitions')
export class MeterDefinition {
  @PrimaryColumn({
    type: 'enum',
    enum: MeterKey,
    enumName: 'meter_key_enum',
  })
  meter_key: MeterKey;

  @Column({ type: 'varchar', length: 20, default: 'run' })
  unit: string;

  @Column({
    type: 'enum',
    enum: MeterWindowType,
    enumName: 'meter_window_type_enum',
  })
  window_type: MeterWindowType;

  @Column({
    type: 'enum',
    enum: MeterFailMode,
    enumName: 'meter_fail_mode_enum',
    default: MeterFailMode.CLOSED,
  })
  fail_mode: MeterFailMode;

  @Column({ type: 'int' })
  default_limit: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
