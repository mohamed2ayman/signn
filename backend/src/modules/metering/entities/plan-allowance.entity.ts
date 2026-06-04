import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

import { SubscriptionPlan } from '../../../database/entities';
import { MeterKey } from '../enums/meter-key.enum';

/**
 * Phase 7.18 — Metering Primitive.
 *
 * Per-plan override of `meter_definition.default_limit`. Resolver order:
 *   subject_allowance ?? plan_allowance ?? meter_definition.default_limit.
 *
 * FK to `subscription_plans.id` (the existing plan table — audit §6.1).
 * Adding rows here is an ops-portal concern; never derived from
 * `subscription_plans.features` jsonb (audit §B.7 documents the choice).
 */
@Entity('plan_allowances')
@Unique('uq_plan_allowances_plan_meter', ['plan_id', 'meter_key'])
export class PlanAllowance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_plan_allowances_plan_id')
  @Column({ type: 'uuid' })
  plan_id: string;

  @ManyToOne(() => SubscriptionPlan, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;

  @Column({
    type: 'enum',
    enum: MeterKey,
    enumName: 'meter_key_enum',
  })
  meter_key: MeterKey;

  // "limit" is reserved in SQL — column name is quoted at the DDL layer
  // (see migration). TypeORM passes the property name through as-is in
  // generated SQL; the `name` mapping below pins it.
  @Column({ name: 'limit', type: 'int' })
  limit: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
