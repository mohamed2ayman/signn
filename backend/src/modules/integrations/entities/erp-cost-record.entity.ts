import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ErpConnection } from './erp-connection.entity';

/**
 * Phase 7.28 — neutral imported actual-cost row.
 *
 * This is a READ-SOURCE that powers claims + variation analysis (agreed-vs-
 * actual). It is GREENFIELD: SIGN had no actual-cost store before. It must
 * NEVER overwrite `claims.claimed_amount` or `claim_responses.counter_amount`
 * — those are asserted/assessed figures; this table holds ERP actuals to
 * compare against, nothing more.
 *
 * Idempotent upsert keyed by UNIQUE(connection_id, external_ref): re-importing
 * the same ERP line refreshes its values rather than duplicating the row.
 */
@Entity('erp_cost_records')
export class ErpCostRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Org scope — set from the connection's organization_id in the worker. */
  @Column({ type: 'uuid' })
  organization_id: string;

  @Column({ type: 'uuid' })
  connection_id: string;

  @ManyToOne(() => ErpConnection, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'connection_id' })
  connection: ErpConnection;

  /** Provenance — the sync run that last wrote this row (nullable on prune). */
  @Column({ type: 'uuid', nullable: true })
  sync_job_id: string | null;

  /** ERP's stable id for the cost line — the idempotency anchor. */
  @Column({ type: 'varchar', length: 255 })
  external_ref: string;

  @Column({ type: 'varchar', length: 100 })
  cost_code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  wbs_ref: string | null;

  /** Reporting period the cost falls in (e.g. '2026-05'). Free-form per ERP. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  period: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 3 })
  currency: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Optional link into SIGN's existing concepts — never required for import. */
  @Column({ type: 'uuid', nullable: true })
  contract_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  project_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  imported_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
