import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from './organization.entity';
import { User } from './user.entity';

export enum AssetType {
  LAW = 'LAW',
  INTERNATIONAL_STANDARD = 'INTERNATIONAL_STANDARD',
  ORGANIZATION_POLICY = 'ORGANIZATION_POLICY',
  CONTRACT_TEMPLATE = 'CONTRACT_TEMPLATE',
  KNOWLEDGE = 'KNOWLEDGE',
}

export enum AssetReviewStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  AUTO_APPROVED = 'AUTO_APPROVED',
}

@Entity('knowledge_assets')
export class KnowledgeAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  organization_id: string;

  @ManyToOne(() => Organization, (org) => org.knowledge_assets, { nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'enum', enum: AssetType })
  asset_type: AssetType;

  @Column({ type: 'enum', enum: AssetReviewStatus, default: AssetReviewStatus.PENDING_REVIEW })
  review_status: AssetReviewStatus;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  file_url: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  file_name: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  jurisdiction: string;

  @Column({ type: 'jsonb', nullable: true })
  tags: string[];

  @Column({ type: 'boolean', default: false })
  include_in_risk_analysis: boolean;

  @Column({ type: 'boolean', default: false })
  include_in_citations: boolean;

  // ─── Phase 7.17 — Prompt 1, S.5: Risk methodology source flagging ────
  /**
   * When TRUE, this asset's `content.risk_methodology` jsonb block
   * provides authoritative L,I defaults for the risk category specified
   * in `risk_methodology_category` (or for any category when that field
   * is NULL). Read by `RiskMethodologyResolverService` step 1 via the
   * B.2 reader.
   *
   * **Distinct from `include_in_risk_analysis` above** — that flag
   * controls whether the asset feeds the AI prompt as context during
   * risk extraction. This flag controls whether the asset is treated
   * as authoritative methodology data for L,I scoring. The two flags
   * are orthogonal: an asset can be either, both, or neither.
   *
   * Indexed via partial index `idx_knowledge_assets_risk_methodology`
   * (only rows with this flag = TRUE are in the index).
   */
  @Column({ type: 'boolean', default: false })
  is_risk_methodology_source: boolean;

  /**
   * Optional category match for the resolver step-1 lookup. When NULL,
   * this asset's methodology applies to ANY risk_category (generic
   * fallback). When set, must match a value in `risk_categories.name`
   * — application-layer validation only, no DB FK in v1 (matches the
   * `RiskAnalysis.risk_category` varchar pattern).
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  risk_methodology_category: string | null;

  @Column({ type: 'jsonb', nullable: true })
  content: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  file_hash: string | null;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  ocr_status: string;

  @Column({ type: 'jsonb', nullable: true })
  detected_languages: string[] | null;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  embedding_status: string;

  /** AI detection confidence (0–100). NULL for manually uploaded assets. */
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  confidence_score: string | null;

  /** Origin of the asset: 'MANUAL', 'AI_EXTRACTED', 'AI_DRAFTED', etc. */
  @Column({ type: 'varchar', length: 30, nullable: true })
  source: string | null;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer: User;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
