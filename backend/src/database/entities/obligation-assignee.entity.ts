import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Obligation } from './obligation.entity';
import { User } from './user.entity';

/**
 * Phase 7.1 — Obligation Tracking & Deadline Alerts
 *
 * Join table between obligations and the users who are responsible for
 * completing them. An obligation can have multiple assignees; a user
 * can be assigned to multiple obligations.
 *
 * Unique constraint on (obligation_id, user_id) is enforced in the
 * migration — TypeORM's @Unique decorator is not used here to keep the
 * migration fully authoritative over the schema.
 */
@Entity('obligation_assignees')
export class ObligationAssignee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  obligation_id: string;

  @ManyToOne(() => Obligation, (o) => o.assignees, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'obligation_id' })
  obligation: Obligation;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Automatically set to now() on INSERT — managed by DB default. */
  @CreateDateColumn({ type: 'timestamptz' })
  assigned_at: Date;

  /**
   * The user who performed the assignment (optional — may be null for
   * system-generated assignments or bulk imports).
   */
  @Column({ type: 'uuid', nullable: true })
  assigned_by: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_by' })
  assigner: User;
}
