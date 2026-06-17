import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ErpConnection } from './erp-connection.entity';
import {
  ErpSyncDirection,
  ErpSyncDomain,
} from '../connectors/erp-connector.interface';

/**
 * Sync-job lifecycle. PARTIAL = some records imported, some failed (mapping
 * gaps etc.); the job still finished. FAILED = the run threw before completing.
 */
export enum ErpSyncJobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  PARTIAL = 'partial',
  FAILED = 'failed',
}

/**
 * Phase 7.28 — one ERP sync run. State transitions are status-guarded
 * conditional UPDATEs in the engine (mirrors the metering ledger discipline).
 * `idempotency_key` + UNIQUE(connection_id, idempotency_key) makes enqueue
 * idempotent (INSERT-first + ON CONFLICT DO NOTHING + return-existing).
 */
@Entity('erp_sync_jobs')
export class ErpSyncJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  connection_id: string;

  @ManyToOne(() => ErpConnection, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'connection_id' })
  connection: ErpConnection;

  /** Denormalized from the connection for fast org-scoped + admin queries. */
  @Column({ type: 'uuid' })
  organization_id: string;

  @Column({
    type: 'enum',
    enum: ErpSyncDirection,
    enumName: 'erp_sync_direction_enum',
  })
  direction: ErpSyncDirection;

  @Column({
    type: 'enum',
    enum: ErpSyncDomain,
    enumName: 'erp_sync_domain_enum',
  })
  domain: ErpSyncDomain;

  @Column({
    type: 'enum',
    enum: ErpSyncJobStatus,
    enumName: 'erp_sync_job_status_enum',
    default: ErpSyncJobStatus.PENDING,
  })
  status: ErpSyncJobStatus;

  @Column({ type: 'varchar', length: 128 })
  idempotency_key: string;

  @Column({ type: 'int', default: 0 })
  records_processed: number;

  @Column({ type: 'int', default: 0 })
  records_imported: number;

  @Column({ type: 'int', default: 0 })
  records_failed: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finished_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
