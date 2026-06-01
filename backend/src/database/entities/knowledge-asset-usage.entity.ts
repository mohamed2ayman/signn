import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { KnowledgeAsset } from './knowledge-asset.entity';

/**
 * Backlink row: records which AI analysis runs consumed a given knowledge asset.
 *
 * context_type values (v1 only COMPLIANCE_CHECK is written; others reserved):
 *   - 'COMPLIANCE_CHECK' — compliance_checks.id
 *   - 'RISK_ANALYSIS'    — risk_analyses.id (future)
 *   - 'RESEARCH'         — research run identifier (future)
 */
@Entity('knowledge_asset_usages')
export class KnowledgeAssetUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  asset_id: string;

  @ManyToOne(() => KnowledgeAsset, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'asset_id' })
  asset: KnowledgeAsset;

  /** 'COMPLIANCE_CHECK' | 'RISK_ANALYSIS' | 'RESEARCH' */
  @Column({ type: 'varchar', length: 50 })
  context_type: string;

  /** PK of the analysis row in its own table (e.g. compliance_checks.id). */
  @Column({ type: 'uuid' })
  context_id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  used_at: Date;
}
