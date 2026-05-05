import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ComplianceCheck } from './compliance-check.entity';
import { User } from './user.entity';

export enum ComplianceReportType {
  COMPLIANCE_SUMMARY = 'COMPLIANCE_SUMMARY',
  OBLIGATIONS_REPORT = 'OBLIGATIONS_REPORT',
  JURISDICTION_CONFLICT = 'JURISDICTION_CONFLICT',
}

export enum ComplianceReportStatus {
  PENDING = 'PENDING',
  RENDERING = 'RENDERING',
  EMAILED = 'EMAILED',
  FAILED = 'FAILED',
}

@Entity('compliance_report_jobs')
export class ComplianceReportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  compliance_check_id: string;

  @ManyToOne(() => ComplianceCheck, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'compliance_check_id' })
  compliance_check: ComplianceCheck;

  @Column({
    type: 'enum',
    enum: ComplianceReportType,
    enumName: 'compliance_report_type_enum',
  })
  report_type: ComplianceReportType;

  @Column({
    type: 'enum',
    enum: ComplianceReportStatus,
    enumName: 'compliance_report_status_enum',
    default: ComplianceReportStatus.PENDING,
  })
  status: ComplianceReportStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  file_path: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  download_token: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  requested_by: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'requested_by' })
  requester: User;

  @Column({ type: 'timestamptz', nullable: true })
  emailed_at: Date | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
