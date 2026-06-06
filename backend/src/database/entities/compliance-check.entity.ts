import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { Project } from './project.entity';
import { User } from './user.entity';
import { ComplianceFinding } from './compliance-finding.entity';

export enum ComplianceOverallStatus {
  PENDING = 'PENDING',
  COMPLIANT = 'COMPLIANT',
  PARTIALLY_COMPLIANT = 'PARTIALLY_COMPLIANT',
  NON_COMPLIANT = 'NON_COMPLIANT',
  FAILED = 'FAILED',
}

export enum ComplianceExtractionStatus {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('compliance_checks')
export class ComplianceCheck {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid' })
  project_id: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  /** ISO-2 country code or 'INTL'. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  jurisdiction: string | null;

  /** Mirror of contracts.contract_type at the time of the check. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  contract_type: string | null;

  @Column({
    type: 'enum',
    enum: ComplianceOverallStatus,
    enumName: 'compliance_overall_status_enum',
    default: ComplianceOverallStatus.PENDING,
  })
  overall_status: ComplianceOverallStatus;

  /** Array of KnowledgeAsset IDs that fed the AI context. */
  @Column({ type: 'jsonb', nullable: true })
  knowledge_assets_used: string[] | null;

  /** {total, critical, by_layer, by_severity} — denormalized for fast list views. */
  @Column({ type: 'jsonb', nullable: true })
  findings_summary: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: ComplianceExtractionStatus,
    enumName: 'compliance_extraction_status_enum',
    default: ComplianceExtractionStatus.PENDING,
  })
  obligation_extraction_status: ComplianceExtractionStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ai_job_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  obligation_job_id: string | null;

  /**
   * Phase 7.18 Part 2 — metering linkage.
   *
   * UUID minted by `MeteringService.reserve()` at runCheck (after the
   * access wall, before this check row is persisted). Used by the
   * lazy poll-driven reconcile in `refreshFromAi` to call
   * `commit(reservation_id)` on terminal success / `release(reservation_id)`
   * on terminal failure.
   *
   * NULLABLE because pre-existing rows pre-date metering, and rows that
   * fail synchronously inside runCheck don't get persisted (release fires
   * in-request via the wiring; no row to carry).
   *
   * NO TypeORM relation to MeteringLedger — attribution, not ownership.
   * Mirrors the engine's own choice on ledger.actor_ref / contract_ref.
   */
  @Column({ type: 'uuid', nullable: true })
  reservation_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @OneToMany(() => ComplianceFinding, (f) => f.compliance_check)
  findings: ComplianceFinding[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
