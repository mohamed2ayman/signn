import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { ContractClause } from './contract-clause.entity';
import { Project } from './project.entity';
import { ComplianceCheck } from './compliance-check.entity';
import { User } from './user.entity';

/**
 * Obligation status. `MET` and `WAIVED` were added in Phase 3.4 alongside
 * the compliance pipeline. Legacy `COMPLETED` is treated as a synonym
 * for `MET` in the UI for backward compatibility.
 */
export enum ObligationStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  OVERDUE = 'OVERDUE',
  MET = 'MET',
  WAIVED = 'WAIVED',
}

/**
 * Categorical type of an obligation, used for filtering, reporting,
 * and is_critical heuristics. Added in Phase 3.4.
 */
export enum ObligationType {
  NOTICE_PERIOD = 'NOTICE_PERIOD',
  PAYMENT = 'PAYMENT',
  PERFORMANCE_BOND = 'PERFORMANCE_BOND',
  INSURANCE = 'INSURANCE',
  MILESTONE = 'MILESTONE',
  DEFECTS_LIABILITY = 'DEFECTS_LIABILITY',
  DISPUTE_RESOLUTION = 'DISPUTE_RESOLUTION',
  REPORTING = 'REPORTING',
  EMPLOYER_OBLIGATION = 'EMPLOYER_OBLIGATION',
  CONTRACTOR_OBLIGATION = 'CONTRACTOR_OBLIGATION',
  ENGINEER_OBLIGATION = 'ENGINEER_OBLIGATION',
  OTHER = 'OTHER',
}

@Entity('obligations')
export class Obligation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, (contract) => contract.obligations)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  /** Denormalized from contracts.project_id for fast project-level queries. */
  @Column({ type: 'uuid', nullable: true })
  project_id: string | null;

  @ManyToOne(() => Project, { nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  /** Set when obligation was created by the compliance Layer-4 extractor. */
  @Column({ type: 'uuid', nullable: true })
  compliance_check_id: string | null;

  @ManyToOne(() => ComplianceCheck, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'compliance_check_id' })
  compliance_check: ComplianceCheck;

  @Column({ type: 'uuid', nullable: true })
  contract_clause_id: string;

  @ManyToOne(() => ContractClause, (cc) => cc.obligations, { nullable: true })
  @JoinColumn({ name: 'contract_clause_id' })
  contract_clause: ContractClause;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  responsible_party: string;

  /**
   * Categorical obligation type. Defaults to OTHER for legacy rows that
   * pre-date the compliance pipeline.
   */
  @Column({
    type: 'enum',
    enum: ObligationType,
    enumName: 'obligation_type_enum',
    default: ObligationType.OTHER,
  })
  obligation_type: ObligationType;

  /** Source clause reference (e.g. "20.2.1"). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  clause_ref: string | null;

  @Column({ type: 'date', nullable: true })
  due_date: Date;

  /** Free-form duration text (e.g. "28 days", "60 days from instruction"). */
  @Column({ type: 'varchar', length: 100, nullable: true })
  duration: string | null;

  /** Human-readable timeframe sentence for the report tables. */
  @Column({ type: 'text', nullable: true })
  timeframe_description: string | null;

  /** Monetary amount if the obligation is financial (bond %, payment, etc.). */
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  amount: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  currency: string | null;

  /** Critical-path flag — drives reminder cadence + report highlighting. */
  @Column({ type: 'boolean', default: false })
  is_critical: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  frequency: string;

  @Column({ type: 'enum', enum: ObligationStatus, default: ObligationStatus.PENDING })
  status: ObligationStatus;

  @Column({ type: 'int', default: 7 })
  reminder_days_before: number;

  /** Next reminder fire date — set by the scheduler after each send. */
  @Column({ type: 'date', nullable: true })
  next_reminder_date: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  last_reminder_sent_at: Date | null;

  /** Single-use HMAC token embedded in mark-as-met email links. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  mark_met_token: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  mark_met_token_expires_at: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;

  @Column({ type: 'uuid', nullable: true })
  completed_by: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'completed_by' })
  completer: User;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  evidence_url: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
