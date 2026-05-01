import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * KnownDevice — rememebered (user, device-fingerprint) pair so we can
 * suppress "new login from..." emails for already-trusted devices.
 *
 * `fingerprint` is SHA-256 of the canonical string
 *   `{browser}|{os}|{country_code}|{ip_/24}`
 * which provides a stable identifier across legitimate IP rotations
 * within the same network.
 */
@Entity('known_devices')
@Index('uq_known_devices_user_fingerprint', ['user_id', 'fingerprint'], {
  unique: true,
})
export class KnownDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 64 })
  fingerprint: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip_address: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  country_code: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  browser: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  os: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  first_seen_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  last_seen_at: Date;
}
