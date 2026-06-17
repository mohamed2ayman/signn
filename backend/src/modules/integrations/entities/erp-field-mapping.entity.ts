import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ErpConnection } from './erp-connection.entity';

/**
 * Phase 7.28 — per-connection field-mapping config.
 *
 * Customer-configurable DATA, never code: maps an ERP-native field name
 * (`source_field`) onto a SIGN neutral target field (`target_field`, e.g.
 * `cost_code`, `wbs_ref`, `amount`, `currency`, `period`, `description`). Every
 * customer's SAP/Oracle is customized differently — the adapter owns protocol
 * and API shape; the mapping lives here as rows.
 */
@Entity('erp_field_mappings')
export class ErpFieldMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  connection_id: string;

  @ManyToOne(() => ErpConnection, (c) => c.field_mappings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'connection_id' })
  connection: ErpConnection;

  /** ERP-native field name as emitted by the adapter (e.g. 'cost_center'). */
  @Column({ type: 'varchar', length: 255 })
  source_field: string;

  /** SIGN neutral target field (e.g. 'cost_code', 'amount', 'currency'). */
  @Column({ type: 'varchar', length: 255 })
  target_field: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
