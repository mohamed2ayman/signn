import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Organization } from './organization.entity';

/**
 * Phase 7.17 — Prompt 1, S.3.
 *
 * The org-specific learned baseline for a single risk category. One row
 * per (organization_id, risk_category) — uniqueness enforced by the DB
 * unique index `uq_risk_category_org_learned_baselines_org_cat`.
 *
 * Populated by the B.4 learned-baseline computation job, which is
 * triggered from the B.3 override service once an org accumulates
 * `override_count >= 10` for a (org, category) pair. The job computes
 * the median L,I from the last 50 overrides and upserts a row here.
 *
 * Read by `RiskMethodologyResolverService` step 2 — only returned if
 * `override_count >= 10` so that orgs which have JUST hit the threshold
 * have their first baseline applied immediately on the next resolve.
 */
@Entity('risk_category_org_learned_baselines')
export class RiskCategoryOrgLearnedBaseline {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  organization_id: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 100 })
  risk_category: string;

  @Column({ type: 'smallint' })
  learned_likelihood: number;

  @Column({ type: 'smallint' })
  learned_impact: number;

  /**
   * How many override rows backed the most recent recomputation. The
   * resolver only returns this baseline when `override_count >= 10`.
   * Updated atomically when the B.4 job upserts a recomputed baseline.
   */
  @Column({ type: 'int', default: 0 })
  override_count: number;

  /** Timestamp of the most recent B.4 recomputation. */
  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  last_recomputed_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
