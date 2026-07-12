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

  /**
   * Risk-tab clutter reduction — soft delete. `true` = the row is a redundant
   * duplicate flagged out of every risk read (Risk tab, counts, summary,
   * export). The row is KEPT (reversible; FKs/annotation history intact) but
   * excluded from all reads. Default false. NEVER hard-delete a risk.
   */
  @Column({ type: 'boolean', default: false })
  is_deleted: boolean;

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

  // ─── Phase 8.3 — human annotation tracking ───────────────────────────

  /**
   * True once a human has edited this finding's risk_level / risk_category
   * from the editable Risk Analysis tab. Defaults false — the AI pre-labels
   * stay false until a human corrects them.
   */
  @Column({ type: 'boolean', default: false })
  is_edited_by_user: boolean;

  /**
   * User who last edited level/category. NULL until the first edit.
   * FK ON DELETE SET NULL preserves the edit history if the user is deleted.
   */
  @Column({ type: 'uuid', nullable: true })
  edited_by_user_id: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'edited_by_user_id' })
  edited_by_user: User | null;

  /** Timestamp of the most recent human edit. NULL until the first edit. */
  @Column({ type: 'timestamptz', nullable: true })
  edited_at: Date | null;

  /**
   * The AI's ORIGINAL risk_level, snapshotted exactly once immediately
   * before the first human edit (the original-vs-corrected training
   * signal). NULL until the first edit. VARCHAR(10) rather than the enum
   * type to decouple the archived value from the RiskLevel enum.
   */
  @Column({ type: 'varchar', length: 10, nullable: true })
  original_risk_level: string | null;

  /** The AI's ORIGINAL risk_category, snapshotted once before the first edit. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  original_risk_category: string | null;

  /**
   * The AI's ORIGINAL recommendation text, snapshotted exactly once
   * immediately before the first human edit (Risk-tab rework, STEP 2).
   * NULL until the first edit (and stays NULL if the AI never wrote a
   * recommendation). `text` to match the `recommendation` column.
   */
  @Column({ type: 'text', nullable: true })
  original_recommendation: string | null;

  /**
   * The AI-drafted PROPOSED replacement clause for this risk (Risk-tab
   * rework, STEP 3 — "re-phrase clause"). Points at an `is_proposed=true`
   * ContractClause created by the non-guest AI-rewrite path
   * (source = AI_DRAFTED, source_document_id = NULL so it stays isolated
   * from the guest document-scoped proposed-version machinery). NULL until a
   * rewrite is generated; cleared again once the host promotes (Merge & Apply)
   * or discards (Cancel) it. FK ON DELETE SET NULL.
   */
  @Column({ type: 'uuid', nullable: true })
  proposed_contract_clause_id: string | null;

  @ManyToOne(() => ContractClause, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'proposed_contract_clause_id' })
  proposed_contract_clause: ContractClause | null;

  /**
   * Risk-tab rework — FIX 1: when the AI re-phrase was promoted (Merge &
   * Apply). Set ONLY on the accept path; a reject leaves it NULL. Drives the
   * persistent MERGED state of the recommendation block (survives reload).
   */
  @Column({ type: 'timestamptz', nullable: true })
  merged_at: Date | null;

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
