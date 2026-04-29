import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * PasswordHistory — records previous bcrypt hashes per user so we can
 * reject reuse of the last N passwords (where N = SecurityPolicy.password_history_count).
 *
 * Only created when password_history_count > 0. Trimmed on each password
 * change so the row count never exceeds N.
 */
@Entity('password_history')
@Index('idx_password_history_user_created', ['user_id', 'created_at'])
export class PasswordHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 255 })
  password_hash: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
