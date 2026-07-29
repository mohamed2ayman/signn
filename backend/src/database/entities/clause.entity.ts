import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Organization } from './organization.entity';
import { User } from './user.entity';
import { ContractClause } from './contract-clause.entity';
import { DocumentUpload } from './document-upload.entity';

export enum ClauseSource {
  MANUAL = 'MANUAL',
  AI_EXTRACTED = 'AI_EXTRACTED',
  AI_DRAFTED = 'AI_DRAFTED',
  /**
   * 7.19 — a clause version minted by accepting a counterparty redline
   * (clause_redlines). Content authored by the counterparty, promoted by the
   * host. Additive varchar value (the column is varchar(20) — this fits
   * exactly); no ALTER TYPE needed.
   */
  COUNTERPARTY_REDLINE = 'COUNTERPARTY_REDLINE',
}

export enum ClauseReviewStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EDITED = 'EDITED',
}

@Entity('clauses')
export class Clause {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  organization_id: string;

  @ManyToOne(() => Organization, (org) => org.clauses, { nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  clause_type: string;

  // Clause-type correction tracking (Step 2 — retrain logging). Additive; mirrors
  // the risk-annotation pattern (risk_analyses.is_edited_by_user + original_*).
  // original_ai_clause_type: the AI's first-assigned type (snapshot-once, never
  // overwritten). is_type_edited_by_user: true once a human changes the type (the
  // gold correction signal). clause_type_source: the provider that produced the
  // type ('sonnet-inline' today; a dedicated typer id in future).
  @Column({ type: 'varchar', length: 100, nullable: true })
  original_ai_clause_type: string | null;

  @Column({ type: 'boolean', default: false })
  is_type_edited_by_user: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  clause_type_source: string | null;

  // Clause-content provenance (scan-corruption guard — Fix #3). Additive; mirrors
  // the clause-type seam above applied to CONTENT so a silently OCR-reconstructed
  // clause (broken text-layer / scanned PDF) is auditable.
  // original_ai_content: the text the AI first extracted (snapshot-once, never
  // overwritten). is_content_edited_by_user: true once a human changes the content.
  @Column({ type: 'text', nullable: true })
  original_ai_content: string | null;

  @Column({ type: 'boolean', default: false })
  is_content_edited_by_user: boolean;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'uuid', nullable: true })
  parent_clause_id: string;

  @ManyToOne(() => Clause, { nullable: true })
  @JoinColumn({ name: 'parent_clause_id' })
  parent_clause: Clause;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'varchar', length: 20, default: ClauseSource.MANUAL })
  source: ClauseSource;

  @Column({ type: 'uuid', nullable: true })
  source_document_id: string | null;

  @ManyToOne(() => DocumentUpload, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'source_document_id' })
  source_document: DocumentUpload | null;

  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  confidence_score: number | null;

  @Column({ type: 'varchar', length: 20, default: ClauseReviewStatus.APPROVED })
  review_status: ClauseReviewStatus;

  @Column({ type: 'uuid', nullable: true })
  reviewed_by: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => ContractClause, (cc) => cc.clause)
  contract_clauses: ContractClause[];
}
