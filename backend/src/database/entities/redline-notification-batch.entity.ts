import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { User } from './user.entity';

/**
 * 7.19 Slice 4 — which side of the negotiation a batched event belongs to.
 *
 *   PROPOSED → a counterparty opened/advanced a proposal; the HOST is notified.
 *   DECIDED  → the host accepted / rejected / countered; the COUNTERPARTY
 *              (the proposal's author) is notified.
 *
 * The two classes batch SEPARATELY because they address different audiences
 * and read as different sentences — collapsing them would produce a digest
 * nobody can act on ("3 things happened").
 */
export enum RedlineNotificationEventClass {
  PROPOSED = 'PROPOSED',
  DECIDED = 'DECIDED',
}

/**
 * 7.19 Slice 4 — one OPEN debounce window per (contract, event class,
 * recipient). See migration 1773000000001 for the full model.
 *
 * Lifecycle: the first event for a recipient/contract/class INSERTs this row
 * with pending_count = 0 and sends immediately (leading edge). Subsequent
 * events inside the window bump pending_count and send nothing. The sweeper
 * DELETEs rows whose window has elapsed and flushes ONE digest for any row
 * with pending_count > 0. Rows therefore only ever represent OPEN windows.
 *
 * NOTE: writes go through a raw atomic UPSERT in RedlineNotificationService —
 * this entity exists for typed reads (the sweeper drain) and schema ownership,
 * not to be save()d row-by-row.
 */
@Entity('redline_notification_batches')
@Index('idx_redline_notification_batches_window_ends_at', ['window_ends_at'])
export class RedlineNotificationBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  /** RedlineNotificationEventClass — varchar (the RedlineStatus convention), not a pg enum. */
  @Column({ type: 'varchar', length: 16 })
  event_class: RedlineNotificationEventClass;

  /**
   * Synthetic recipient discriminator: `u:<uuid>` or `e:<lower(email)>`.
   * Keeps the UNIQUE index free of NULL semantics (a nullable column in a
   * UNIQUE index treats NULLs as distinct and would open a second window per
   * recipient).
   */
  @Column({ type: 'varchar', length: 340 })
  recipient_key: string;

  /** NULL for an email-only recipient (no user row → in-app is impossible). */
  @Column({ type: 'uuid', nullable: true })
  recipient_user_id: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'recipient_user_id' })
  recipient_user: User | null;

  @Column({ type: 'varchar', length: 320, nullable: true })
  recipient_email: string | null;

  /** Resolved at window-open time via resolveRecipientLang (already allowlisted). */
  @Column({ type: 'varchar', length: 10, default: 'en' })
  recipient_lang: string;

  /** Events SUPPRESSED by this window. 0 = only the leading edge fired → no digest. */
  @Column({ type: 'int', default: 0 })
  pending_count: number;

  @Column({ type: 'timestamptz' })
  window_ends_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
