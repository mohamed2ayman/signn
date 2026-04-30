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

export enum DeviceType {
  DESKTOP = 'DESKTOP',
  MOBILE = 'MOBILE',
  TABLET = 'TABLET',
  UNKNOWN = 'UNKNOWN',
}

export enum SuspiciousReason {
  NEW_COUNTRY = 'NEW_COUNTRY',
  IMPOSSIBLE_TRAVEL = 'IMPOSSIBLE_TRAVEL',
  BRUTE_FORCE = 'BRUTE_FORCE',
}

/**
 * UserSession — one row per logged-in (user, refresh-token) pair. The raw
 * JWT is never stored; we keep its SHA-256 hex digest in `token_hash`.
 *
 * Lookup paths:
 *   - SessionTrackingMiddleware: by `token_hash` to bump `last_active_at`
 *   - Revoke endpoints: by `id`
 *   - Suspicious-login service: aggregate by `user_id, country_code, created_at`
 */
@Entity('user_sessions')
@Index('idx_user_sessions_token_hash', ['token_hash'])
@Index('idx_user_sessions_user_expires', ['user_id', 'expires_at'])
@Index('idx_user_sessions_user_country_created', [
  'user_id',
  'country_code',
  'created_at',
])
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** SHA-256 hex of the raw refresh JWT — never store the JWT itself. */
  @Column({ type: 'varchar', length: 64 })
  token_hash: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip_address: string | null;

  @Column({ type: 'text', nullable: true })
  user_agent: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: DeviceType.UNKNOWN,
  })
  device_type: DeviceType;

  @Column({ type: 'varchar', length: 100, nullable: true })
  browser: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  os: string | null;

  /** "City, Country" rendered string from geoip-lite. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  location: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country_code: string | null;

  @Column({ type: 'boolean', default: false })
  is_suspicious: boolean;

  @Column({ type: 'varchar', length: 32, nullable: true })
  suspicious_reason: SuspiciousReason | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz' })
  last_active_at: Date;

  @Column({ type: 'timestamptz' })
  expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;
}
