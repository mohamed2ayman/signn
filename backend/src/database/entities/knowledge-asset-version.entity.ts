import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { KnowledgeAsset } from './knowledge-asset.entity';
import { User } from './user.entity';

/**
 * Immutable snapshot of a KnowledgeAsset state captured every time
 * the asset is updated.  Phase 7.24d.
 */
@Entity('knowledge_asset_versions')
export class KnowledgeAssetVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  asset_id: string;

  @ManyToOne(() => KnowledgeAsset, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'asset_id' })
  asset: KnowledgeAsset;

  @Column({ type: 'int' })
  version_number: number;

  /** Full serialised state of the asset at the time of the update. */
  @Column({ type: 'jsonb' })
  snapshot_data: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true })
  changed_by: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'changed_by' })
  changer: User;

  @Column({ type: 'varchar', length: 500, nullable: true })
  change_summary: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
