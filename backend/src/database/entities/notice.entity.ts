import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { Contract } from './contract.entity';
import { Organization } from './organization.entity';

export enum NoticeType {
  // Delay & Time
  NOTICE_OF_DELAY = 'NOTICE_OF_DELAY',
  NOTICE_OF_EXTENSION_OF_TIME = 'NOTICE_OF_EXTENSION_OF_TIME',
  NOTICE_OF_COMPLETION = 'NOTICE_OF_COMPLETION',
  NOTICE_OF_PRACTICAL_COMPLETION = 'NOTICE_OF_PRACTICAL_COMPLETION',
  NOTICE_OF_SECTIONAL_COMPLETION = 'NOTICE_OF_SECTIONAL_COMPLETION',
  // Variations & Changes
  NOTICE_OF_VARIATION = 'NOTICE_OF_VARIATION',
  NOTICE_OF_CHANGE_IN_CONDITIONS = 'NOTICE_OF_CHANGE_IN_CONDITIONS',
  NOTICE_OF_ACCELERATION = 'NOTICE_OF_ACCELERATION',
  NOTICE_OF_SCOPE_CHANGE = 'NOTICE_OF_SCOPE_CHANGE',
  // Quality & Defects
  NOTICE_TO_CORRECT = 'NOTICE_TO_CORRECT',
  NOTICE_OF_DEFECTS = 'NOTICE_OF_DEFECTS',
  NOTICE_OF_NON_CONFORMANCE = 'NOTICE_OF_NON_CONFORMANCE',
  NOTICE_OF_REJECTION = 'NOTICE_OF_REJECTION',
  // Payment & Financial
  NOTICE_OF_PAYMENT = 'NOTICE_OF_PAYMENT',
  PAY_LESS_NOTICE = 'PAY_LESS_NOTICE',
  NOTICE_OF_WITHHOLDING = 'NOTICE_OF_WITHHOLDING',
  NOTICE_OF_LOSS_AND_EXPENSE = 'NOTICE_OF_LOSS_AND_EXPENSE',
  NOTICE_OF_PRICE_ADJUSTMENT = 'NOTICE_OF_PRICE_ADJUSTMENT',
  // Claims & Disputes
  INTENT_TO_CLAIM = 'INTENT_TO_CLAIM',
  NOTICE_OF_DISPUTE = 'NOTICE_OF_DISPUTE',
  NOTICE_OF_ADJUDICATION = 'NOTICE_OF_ADJUDICATION',
  NOTICE_OF_ARBITRATION = 'NOTICE_OF_ARBITRATION',
  // Early Warnings
  EARLY_WARNING_NOTICE = 'EARLY_WARNING_NOTICE',
  RISK_REDUCTION_NOTICE = 'RISK_REDUCTION_NOTICE',
  // Suspension & Termination
  NOTICE_OF_SUSPENSION = 'NOTICE_OF_SUSPENSION',
  NOTICE_OF_TERMINATION = 'NOTICE_OF_TERMINATION',
  NOTICE_OF_TERMINATION_FOR_CONVENIENCE = 'NOTICE_OF_TERMINATION_FOR_CONVENIENCE',
  NOTICE_OF_TERMINATION_FOR_CAUSE = 'NOTICE_OF_TERMINATION_FOR_CAUSE',
  NOTICE_TO_SHOW_CAUSE = 'NOTICE_TO_SHOW_CAUSE',
  // Force Majeure
  NOTICE_OF_FORCE_MAJEURE = 'NOTICE_OF_FORCE_MAJEURE',
  NOTICE_OF_EXCEPTIONAL_EVENT = 'NOTICE_OF_EXCEPTIONAL_EVENT',
  // Insurance & Indemnity
  NOTICE_OF_INSURANCE_CLAIM = 'NOTICE_OF_INSURANCE_CLAIM',
  NOTICE_OF_INDEMNITY_CLAIM = 'NOTICE_OF_INDEMNITY_CLAIM',
  // Access & Site
  NOTICE_OF_ACCESS = 'NOTICE_OF_ACCESS',
  NOTICE_OF_POSSESSION = 'NOTICE_OF_POSSESSION',
  NOTICE_OF_OBSTRUCTION = 'NOTICE_OF_OBSTRUCTION',
  // General
  GENERAL_NOTICE = 'GENERAL_NOTICE',
}

export enum NoticeStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  DELIVERED = 'DELIVERED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESPONDED = 'RESPONDED',
  OVERDUE = 'OVERDUE',
  CLOSED = 'CLOSED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum NoticeResponseType {
  ACKNOWLEDGE_ACCEPT = 'ACKNOWLEDGE_ACCEPT',
  ACKNOWLEDGE_DISPUTE = 'ACKNOWLEDGE_DISPUTE',
  REQUEST_FOR_FURTHER_INFO = 'REQUEST_FOR_FURTHER_INFO',
  COUNTER_NOTICE = 'COUNTER_NOTICE',
  NO_RESPONSE_REQUIRED = 'NO_RESPONSE_REQUIRED',
  COMPLY = 'COMPLY',
  REJECT = 'REJECT',
}

@Entity('notices')
export class Notice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid' })
  org_id: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'org_id' })
  organization: Organization;

  @Column({ type: 'uuid' })
  submitted_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'submitted_by' })
  submitter: User;

  @Column({ type: 'varchar', length: 50 })
  notice_reference: string;

  @Column({ type: 'varchar', length: 80 })
  notice_type: NoticeType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  contract_clause_references: Record<string, unknown>[];

  @Column({ type: 'date' })
  event_date: Date;

  @Column({ type: 'boolean', default: false })
  response_required: boolean;

  @Column({ type: 'date', nullable: true })
  response_deadline: Date;

  @Column({ type: 'varchar', length: 50, default: NoticeStatus.DRAFT })
  status: NoticeStatus;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => NoticeDocument, (d) => d.notice)
  documents: NoticeDocument[];

  @OneToMany(() => NoticeResponse, (r) => r.notice)
  responses: NoticeResponse[];

  @OneToMany(() => NoticeStatusLog, (l) => l.notice)
  status_logs: NoticeStatusLog[];
}

@Entity('notice_documents')
export class NoticeDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  notice_id: string;

  @ManyToOne(() => Notice, (n) => n.documents)
  @JoinColumn({ name: 'notice_id' })
  notice: Notice;

  @Column({ type: 'varchar', length: 500 })
  file_url: string;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  document_type: string;

  @Column({ type: 'uuid' })
  uploaded_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploaded_by' })
  uploader: User;

  @CreateDateColumn({ type: 'timestamptz' })
  uploaded_at: Date;
}

@Entity('notice_responses')
export class NoticeResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  notice_id: string;

  @ManyToOne(() => Notice, (n) => n.responses)
  @JoinColumn({ name: 'notice_id' })
  notice: Notice;

  @Column({ type: 'uuid' })
  responded_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'responded_by' })
  responder: User;

  @Column({ type: 'varchar', length: 50 })
  response_type: NoticeResponseType;

  @Column({ type: 'text' })
  response_content: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('notice_status_logs')
export class NoticeStatusLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  notice_id: string;

  @ManyToOne(() => Notice, (n) => n.status_logs)
  @JoinColumn({ name: 'notice_id' })
  notice: Notice;

  @Column({ type: 'uuid' })
  changed_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'changed_by' })
  changer: User;

  @Column({ type: 'varchar', length: 50 })
  previous_status: string;

  @Column({ type: 'varchar', length: 50 })
  new_status: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn({ type: 'timestamptz' })
  changed_at: Date;
}
