import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Organization } from './organization.entity';
import { SupportTicket } from './support-ticket.entity';

export enum SupportChatStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  TRANSFERRED = 'TRANSFERRED',
  CLOSED = 'CLOSED',
}

export type SupportChatClosedReason =
  | 'resolved'
  | 'transferred_to_ticket'
  | 'user_left';

@Entity('support_chats')
@Index(['status', 'created_at'])
@Index(['assigned_ops_id', 'status'])
export class SupportChat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', nullable: true })
  organization_id: string | null;

  @ManyToOne(() => Organization, { nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 20, default: SupportChatStatus.WAITING })
  status: SupportChatStatus;

  @Column({ type: 'varchar', length: 500 })
  topic: string;

  @Column({ type: 'uuid', nullable: true })
  assigned_ops_id: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assigned_ops_id' })
  assigned_ops: User;

  @Column({ type: 'uuid', nullable: true })
  previous_ops_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  closed_by: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  closed_reason: SupportChatClosedReason | null;

  @Column({ type: 'smallint', nullable: true })
  csat_rating: number | null;

  @Column({ type: 'text', nullable: true })
  csat_comment: string | null;

  @Column({ type: 'uuid', nullable: true })
  converted_ticket_id: string | null;

  @ManyToOne(() => SupportTicket, { nullable: true })
  @JoinColumn({ name: 'converted_ticket_id' })
  converted_ticket: SupportTicket;

  @Column({ type: 'timestamptz', nullable: true })
  queued_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  assigned_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
