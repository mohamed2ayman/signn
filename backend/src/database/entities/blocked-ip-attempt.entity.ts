import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum BlockedIpReason {
  BLOCKLIST = 'BLOCKLIST',
  NOT_IN_ALLOWLIST = 'NOT_IN_ALLOWLIST',
}

/**
 * BlockedIpAttempt — log of every request rejected by IpFilterMiddleware.
 * Read by /admin/security/blocked-attempts (last 10 for the UI).
 */
@Entity('blocked_ip_attempts')
@Index('idx_blocked_ip_attempts_created', ['created_at'])
export class BlockedIpAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  ip_address: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  attempted_email: string | null;

  @Column({ type: 'varchar', length: 32 })
  reason: BlockedIpReason;

  @Column({ type: 'text', nullable: true })
  user_agent: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
