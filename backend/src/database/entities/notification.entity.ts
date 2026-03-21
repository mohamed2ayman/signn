import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum NotificationType {
  EMAIL = 'EMAIL',
  IN_APP = 'IN_APP',
  BOTH = 'BOTH',
}

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, (user) => user.notifications)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'enum', enum: NotificationType, default: NotificationType.IN_APP })
  type: NotificationType;

  @Column({ type: 'boolean', default: false })
  is_read: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  related_entity_type: string;

  @Column({ type: 'uuid', nullable: true })
  related_entity_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
