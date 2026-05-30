import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Phase 7.17 Prompt 2c — portfolio_export_jobs row.
 *
 * Lifecycle:
 *   PENDING → RUNNING → COMPLETED (file_path + expires_at + completed_at set)
 *                     → FAILED    (error set, no token issued)
 *
 * Cleanup cron (Bucket 3) flips file_deleted = TRUE once expires_at < NOW();
 * the audit row is kept past file removal for the audit retention window
 * (see portfolio-export.constants.ts → PORTFOLIO_EXPORT_AUDIT_RETENTION_DAYS).
 */
export enum PortfolioExportStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('portfolio_export_jobs')
export class PortfolioExportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Requester. NULL after the user is deleted (audit row preserved). The
   * token verifier requires payload.user_id === row.user_id, so a NULLed
   * row can no longer satisfy any token — by design.
   */
  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @Column({ type: 'uuid' })
  org_id: string;

  /** Optional project filter applied at request time. */
  @Column({ type: 'uuid', nullable: true })
  project_id: string | null;

  /**
   * AnalyticsPeriod value: '7d' | '30d' | '90d' | '365d'. Stored loose at the
   * DB layer; DTO enforces the enum on input. Bucket 2 maps this back to the
   * `AnalyticsPeriod` enum before calling `PortfolioAnalyticsService`.
   */
  @Column({ type: 'varchar', length: 10 })
  period: string;

  @Column({
    type: 'enum',
    enum: PortfolioExportStatus,
    enumName: 'portfolio_export_status_enum',
    default: PortfolioExportStatus.PENDING,
  })
  status: PortfolioExportStatus;

  /** Storage URL/key once uploaded — StorageService abstraction (Phase 9.1a). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  file_path: string | null;

  /**
   * Captured at request time. Prevents the "user changes email between
   * request and dispatch" race; the processor reads from here, not from the
   * user's current row.
   */
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  /**
   * Authoritative expiry. The signed token's expires_at and this column are
   * set from the same `Date.now() + PORTFOLIO_EXPORT_TTL_MS`. Token
   * verification re-checks the DB value (defense in depth against clock
   * skew or in-process TTL changes between issue and verify).
   */
  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date | null;

  @Column({ type: 'boolean', default: false })
  file_deleted: boolean;
}
