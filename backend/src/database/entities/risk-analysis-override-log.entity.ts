import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Organization } from './organization.entity';
import { RiskAnalysis } from './risk-analysis.entity';
import { User } from './user.entity';
import { RiskSourceType } from '../../modules/risk-analysis/enums/risk-source-type.enum';

/**
 * Phase 7.17 — Prompt 1, S.4.
 *
 * Append-only audit log of user overrides on risk-finding L,I values.
 *
 * Written by the B.3 override service (one row per override). Read by
 * the B.4 learned-baseline computation job — the last 50 rows per
 * (organization_id, risk_category) feed the median calculation.
 *
 * The `user_id` FK uses `ON DELETE SET NULL` (column nullable) so
 * future user-deletion (SOC 2 / GDPR work in Phase 10) doesn't cascade-
 * delete or block on override history. The event, deltas, and note are
 * preserved; only attribution is lost on user-deletion.
 *
 * `organization_id` and `risk_category` are denormalised from the
 * underlying `risk_analyses` row for fast composite-index queries
 * (B.4's median computation runs millions of times faster with the
 * direct columns than with a 3-table join through risk_analyses →
 * contracts → projects).
 */
@Entity('risk_analysis_override_log')
export class RiskAnalysisOverrideLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  risk_analysis_id: string;

  @ManyToOne(() => RiskAnalysis, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'risk_analysis_id' })
  risk_analysis: RiskAnalysis;

  /** Denormalised from the parent risk_analyses row's project's org_id. */
  @Column({ type: 'uuid' })
  organization_id: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  /** Denormalised from the parent risk_analyses row. */
  @Column({ type: 'varchar', length: 100 })
  risk_category: string;

  @Column({ type: 'smallint' })
  previous_likelihood: number;

  @Column({ type: 'smallint' })
  previous_impact: number;

  @Column({ type: 'smallint' })
  new_likelihood: number;

  @Column({ type: 'smallint' })
  new_impact: number;

  /**
   * Source of the L,I that was overwritten. The "new source" is always
   * USER_OVERRIDE in v1, so it's not stored.
   *
   * **v1 invariant**: this is a single column because the resolver's v1
   * contract is `likelihood_source === impact_source` (same chain step
   * always produces both). The B.3 override service enforces this
   * invariant at runtime via a guard at the top of `applyOverride()`.
   *
   * If/when a future phase introduces asymmetric source attribution
   * (e.g. L from learned baseline, I from platform default), this column
   * MUST be split into `previous_likelihood_source` and
   * `previous_impact_source` — and the B.3 guard removed. Do that as
   * its own migration with a transitional period so existing log rows
   * keep their meaning.
   */
  @Column({ type: 'varchar', length: 20 })
  previous_source: RiskSourceType;

  /**
   * User who made the override. NULL when the user has been deleted —
   * the override event is preserved but attribution is lost.
   */
  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  /** Optional user-provided rationale for the override. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
