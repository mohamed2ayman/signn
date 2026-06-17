import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Organization } from '../../../database/entities/organization.entity';
import { ErpFieldMapping } from './erp-field-mapping.entity';
import { ErpCapabilities } from '../connectors/erp-connector.interface';

/**
 * Lifecycle of a connection's operational state. Distinct from `enabled`
 * (the org's on/off switch). `error` is set when the last sync failed.
 */
export enum ErpConnectionStatus {
  CONFIGURED = 'configured',
  ACTIVE = 'active',
  ERROR = 'error',
  DISABLED = 'disabled',
}

/**
 * Phase 7.28 — a per-org ERP connection.
 *
 * `vendor` is a plain string validated against the connector registry (NOT a DB
 * enum) so adding an adapter needs no migration. `credentials_encrypted` holds
 * an AES-256-GCM payload from CryptoService — it is @Exclude()'d so it can NEVER
 * be serialized onto an API response, and is decrypted ONLY inside the worker.
 */
@Entity('erp_connections')
export class ErpConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Owning org — the multi-tenant subject for every query AND the worker subject. */
  @Column({ type: 'uuid' })
  organization_id: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** Registry vendor key (e.g. 'MOCK', 'SAP'). Validated against the registry. */
  @Column({ type: 'varchar', length: 50 })
  vendor: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  base_url: string | null;

  /**
   * AES-256-GCM payload (CryptoService) of the JSON-serialized credential
   * object. NEVER returned on any API response, NEVER logged. Decrypted only
   * in the worker at sync time.
   */
  @Exclude()
  @Column({ type: 'text', nullable: true })
  credentials_encrypted: string | null;

  /** Snapshot of the adapter's declared capabilities at create time (UI/ops). */
  @Column({ type: 'jsonb', nullable: true })
  capabilities_snapshot: ErpCapabilities | null;

  /** Org on/off switch — independent of operational `status`. */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({
    type: 'enum',
    enum: ErpConnectionStatus,
    enumName: 'erp_connection_status_enum',
    default: ErpConnectionStatus.CONFIGURED,
  })
  status: ErpConnectionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  last_sync_at: Date | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @OneToMany(() => ErpFieldMapping, (m) => m.connection)
  field_mappings: ErpFieldMapping[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
