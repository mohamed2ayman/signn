import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Obligation } from './obligation.entity';

export enum ObligationReminderType {
  DAYS_30 = 'DAYS_30',
  DAYS_14 = 'DAYS_14',
  DAYS_7 = 'DAYS_7',
  DAYS_1 = 'DAYS_1',
  DUE_TODAY = 'DUE_TODAY',
  OVERDUE = 'OVERDUE',
  WEEKLY_DIGEST = 'WEEKLY_DIGEST',
}

export enum ObligationReminderEmailStatus {
  SENT = 'SENT',
  FAILED = 'FAILED',
  BOUNCED = 'BOUNCED',
}

@Entity('obligation_reminder_logs')
export class ObligationReminderLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  obligation_id: string;

  @ManyToOne(() => Obligation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'obligation_id' })
  obligation: Obligation;

  @Column({
    type: 'enum',
    enum: ObligationReminderType,
    enumName: 'obligation_reminder_type_enum',
  })
  reminder_type: ObligationReminderType;

  @Column({ type: 'varchar', length: 255 })
  sent_to: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'sent_at' })
  sent_at: Date;

  @Column({
    type: 'enum',
    enum: ObligationReminderEmailStatus,
    enumName: 'obligation_reminder_email_status_enum',
    default: ObligationReminderEmailStatus.SENT,
  })
  email_status: ObligationReminderEmailStatus;
}
