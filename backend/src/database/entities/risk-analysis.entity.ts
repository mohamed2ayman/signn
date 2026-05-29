import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { ContractClause } from './contract-clause.entity';
import { User } from './user.entity';
import { RiskCategoryPlatformDefault } from './risk-category-platform-default.entity';
import { RiskSourceType } from '../../modules/risk-analysis/enums/risk-source-type.enum';

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum RiskAnalysisStatus {
  OPEN = 'OPEN',
  APPROVED = 'APPROVED',
  MANUAL_ADJUSTED = 'MANUAL_ADJUSTED',
  OBSERVED = 'OBSERVED',
  REJECTED = 'REJECTED',
}

@Entity('risk_analyses')
export class RiskAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, (contract) => contract.risk_analyses)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid', nullable: true })
  contract_clause_id: string | null;

  @ManyToOne(() => ContractClause, (cc) => cc.risk_analyses, { nullable: true })
  @JoinColumn({ name: 'contract_clause_id' })
  contract_clause: ContractClause;

  @Column({ type: 'varchar', length: 100 })
  risk_category: string;

  @Column({ type: 'enum', enum: RiskLevel })
  risk_level: RiskLevel;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  recommendation: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  citation_source: string;

  @Column({ type: 'text', nullable: true })
  citation_excerpt: string;

  @Column({ type: 'varchar', length: 50, default: RiskAnalysisStatus.OPEN })
  status: string;

  @Column({ type: 'uuid', nullable: true })
  handled_by: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'handled_by' })
  handler: User;

  @Column({ type: 'timestamptz', nullable: true })
  handled_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  // ─── Phase 7.17 — Prompt 1, S.1: PMBOK 5×5 scoring fields ──────────────

  /**
   * Likelihood (1-5). DB CHECK enforces range. Default 3 = "Possible".
   * Set by the resolver (B.1) when a finding is first created; can be
   * overridden by the user via B.3.
   */
  @Column({ type: 'smallint', default: 3 })
  likelihood: number;

  /**
   * Impact (1-5). DB CHECK enforces range. Default 3 = "Moderate".
   */
  @Column({ type: 'smallint', default: 3 })
  impact: number;

  /**
   * Computed score = likelihood × impact. Range 1-25.
   *
   * Recomputed by `setRiskScore()` (the @BeforeInsert / @BeforeUpdate
   * hook below) on every TypeORM `.save()`. The DB default of 9
   * (= 3 × 3) keeps pre-hook rows internally consistent with the L/I
   * defaults.
   *
   * **Do NOT write to this field directly.** Code paths that need to
   * change the score should change `likelihood` and/or `impact` instead
   * and then call `repo.save(entity)` so the hook fires. Bulk
   * `repo.update(criteria, partial)` calls bypass the hook and will
   * leave risk_score stale — see B.3 design notes in the plan.
   *
   * Backfill (B.6) writes raw SQL `risk_score = likelihood * impact`
   * directly because the hook doesn't fire on raw UPDATE.
   *
   * Indexed DESC (`idx_risk_analyses_score`) for portfolio severity
   * sorting.
   */
  @Column({ type: 'smallint', default: 9 })
  risk_score: number;

  /**
   * Provenance of the `likelihood` value. See RiskSourceType for values.
   * In v1, likelihood_source always equals impact_source (the resolver
   * returns the same source for both); the columns are kept distinct so
   * a future phase can mix sources.
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: RiskSourceType.FALLBACK,
  })
  likelihood_source: RiskSourceType;

  /** Provenance of the `impact` value. See `likelihood_source` notes. */
  @Column({
    type: 'varchar',
    length: 20,
    default: RiskSourceType.FALLBACK,
  })
  impact_source: RiskSourceType;

  /**
   * User who most recently overrode L/I on this finding via B.3.
   * NULL until the first override. FK ON DELETE SET NULL preserves the
   * override history even when the user is deleted.
   */
  @Column({ type: 'uuid', nullable: true })
  last_overridden_by: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'last_overridden_by' })
  last_overrider: User | null;

  /** Timestamp of the most recent override. NULL until the first override. */
  @Column({ type: 'timestamptz', nullable: true })
  last_overridden_at: Date | null;

  /**
   * FK to risk_category_platform_defaults.id — populated when the
   * resolver returned a PLATFORM_DEFAULT and stored the citation
   * reference. Used for rendering APA citations in the explanation
   * popover (F.1).
   *
   * The FK constraint itself is added by the S.2 migration once the
   * target table exists.
   */
  @Column({ type: 'uuid', nullable: true })
  platform_default_ref_id: string | null;

  @ManyToOne(() => RiskCategoryPlatformDefault, { nullable: true })
  @JoinColumn({ name: 'platform_default_ref_id' })
  platform_default_ref: RiskCategoryPlatformDefault | null;

  // ─── Lifecycle hooks ─────────────────────────────────────────────────

  /**
   * Recompute `risk_score` from `likelihood × impact` before every
   * insert and update. Guards against partial entity loads by
   * defaulting either field to 3 if undefined (matches the DB DEFAULT).
   *
   * IMPORTANT: only fires on `Repository.save(entity)`. Does NOT fire
   * on `Repository.update(criteria, partial)` — that's a bulk-update
   * path and TypeORM doesn't run lifecycle hooks. Code that mutates
   * L or I MUST use save() to keep risk_score consistent.
   */
  @BeforeInsert()
  @BeforeUpdate()
  setRiskScore(): void {
    const l = this.likelihood ?? 3;
    const i = this.impact ?? 3;
    this.risk_score = l * i;
  }
}
