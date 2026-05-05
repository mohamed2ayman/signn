import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ComplianceCheck } from './compliance-check.entity';
import { User } from './user.entity';

export enum ComplianceFindingLayer {
  STANDARD = 'STANDARD',
  JURISDICTION = 'JURISDICTION',
  PLAYBOOK = 'PLAYBOOK',
  CONFLICT = 'CONFLICT',
}

export enum ComplianceFindingType {
  MISSING_CLAUSE = 'MISSING_CLAUSE',
  DEVIATION = 'DEVIATION',
  CONFLICT = 'CONFLICT',
  JURISDICTION_OVERRIDE = 'JURISDICTION_OVERRIDE',
  PLAYBOOK_DEVIATION = 'PLAYBOOK_DEVIATION',
}

export enum ComplianceFindingSeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO',
}

export enum ComplianceFindingStatus {
  OPEN = 'OPEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
  WAIVED = 'WAIVED',
}

@Entity('compliance_findings')
export class ComplianceFinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  compliance_check_id: string;

  @ManyToOne(() => ComplianceCheck, (c) => c.findings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'compliance_check_id' })
  compliance_check: ComplianceCheck;

  @Column({
    type: 'enum',
    enum: ComplianceFindingLayer,
    enumName: 'compliance_finding_layer_enum',
  })
  layer: ComplianceFindingLayer;

  @Column({ type: 'varchar', length: 100, nullable: true })
  clause_ref: string | null;

  @Column({
    type: 'enum',
    enum: ComplianceFindingType,
    enumName: 'compliance_finding_type_enum',
  })
  finding_type: ComplianceFindingType;

  @Column({
    type: 'enum',
    enum: ComplianceFindingSeverity,
    enumName: 'compliance_finding_severity_enum',
  })
  severity: ComplianceFindingSeverity;

  @Column({ type: 'text' })
  requirement: string;

  @Column({ type: 'text', nullable: true })
  actual_text: string | null;

  @Column({ type: 'text', nullable: true })
  recommendation: string | null;

  /** ID or title of a knowledge asset that justified the finding. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  knowledge_asset_ref: string | null;

  @Column({
    type: 'enum',
    enum: ComplianceFindingStatus,
    enumName: 'compliance_finding_status_enum',
    default: ComplianceFindingStatus.OPEN,
  })
  status: ComplianceFindingStatus;

  @Column({ type: 'uuid', nullable: true })
  acknowledged_by: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'acknowledged_by' })
  acknowledger: User;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
