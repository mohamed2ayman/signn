import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Stores admin-configurable default permission levels per job title.
 * When this table has no row for a given job_title, the hardcoded
 * JOB_TITLE_DEFAULT_PERMISSION map is used as the fallback.
 */
@Entity('permission_defaults')
export class PermissionDefault {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  job_title: string;

  @Column({ type: 'varchar', length: 20 })
  permission_level: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
