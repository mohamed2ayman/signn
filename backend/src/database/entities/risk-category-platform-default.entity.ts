import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KnowledgeAsset } from './knowledge-asset.entity';

/**
 * Phase 7.17 — Prompt 1, S.2.
 *
 * SIGN's research-backed platform default L,I values per risk category
 * (with optional jurisdiction variant). One row per (risk_category,
 * jurisdiction_variant) tuple — uniqueness enforced by the DB unique
 * index `uq_risk_category_platform_defaults_cat_jurisdiction` (uses
 * NULLS NOT DISTINCT).
 *
 * Read by `RiskMethodologyResolverService` step 3. Seeded by the A.3
 * migration (which itself is operator-blocked pending the seed payload).
 *
 * `knowledge_asset_id` is a FK to the platform-owned KnowledgeAsset
 * (organization_id IS NULL, source = 'PLATFORM_SEED') where the source
 * document lives — used for rendering citations and for SYSTEM_ADMIN-
 * only deep-link "view source" in the admin portal.
 */
@Entity('risk_category_platform_defaults')
export class RiskCategoryPlatformDefault {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  risk_category: string;

  @Column({ type: 'smallint' })
  default_likelihood: number;

  @Column({ type: 'smallint' })
  default_impact: number;

  /** Short APA in-text citation, e.g. "(Purba et al., 2020)". */
  @Column({ type: 'varchar', length: 255 })
  apa_citation_short: string;

  /** Full APA reference for the bibliography section of reports. */
  @Column({ type: 'text' })
  apa_citation_full: string;

  /**
   * FK to the platform-owned KnowledgeAsset where the source document
   * lives. NULL until the seed migration links them.
   */
  @Column({ type: 'uuid', nullable: true })
  knowledge_asset_id: string | null;

  @ManyToOne(() => KnowledgeAsset, { nullable: true })
  @JoinColumn({ name: 'knowledge_asset_id' })
  knowledge_asset: KnowledgeAsset | null;

  /**
   * Short note explaining why this default was chosen — surfaced in
   * admin UI when SYSTEM_ADMIN reviews platform defaults.
   */
  @Column({ type: 'text', nullable: true })
  reasoning: string | null;

  /**
   * Jurisdiction variant: 'FIDIC_RED', 'FIDIC_YELLOW', 'NEC', 'JCT', etc.
   * NULL = general/jurisdiction-agnostic. The resolver's step 3 prefers
   * a jurisdiction-specific row when one exists for the requested
   * variant, otherwise falls back to the NULL row.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  jurisdiction_variant: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
