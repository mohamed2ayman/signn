import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { Contract } from './contract.entity';
import { Organization } from './organization.entity';

export enum ClaimType {
  COST = 'COST',
  TIME_EXTENSION = 'TIME_EXTENSION',
  VARIATION = 'VARIATION',
  DISRUPTION = 'DISRUPTION',
  GENERAL_DISPUTE = 'GENERAL_DISPUTE',
}

export enum ClaimStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  UNDER_ASSESSMENT = 'UNDER_ASSESSMENT',
  RESPONDED = 'RESPONDED',
  UNDER_NEGOTIATION = 'UNDER_NEGOTIATION',
  SETTLED = 'SETTLED',
  REJECTED = 'REJECTED',
  ESCALATED = 'ESCALATED',
}

export enum ClaimResponseType {
  ACCEPTED = 'ACCEPTED',
  PARTIAL_ACCEPTANCE = 'PARTIAL_ACCEPTANCE',
  COUNTER_OFFER = 'COUNTER_OFFER',
  REJECTED = 'REJECTED',
}

@Entity('claims')
export class Claim {
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
  claim_reference: string;

  @Column({ type: 'varchar', length: 50 })
  claim_type: ClaimType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  contract_clause_references: Record<string, unknown>[];

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  claimed_amount: number;

  @Column({ type: 'integer', nullable: true })
  claimed_time_extension_days: number;

  @Column({ type: 'date' })
  event_date: Date;

  @Column({ type: 'varchar', length: 50, default: ClaimStatus.DRAFT })
  status: ClaimStatus;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledged_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolved_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => ClaimDocument, (d) => d.claim)
  documents: ClaimDocument[];

  @OneToMany(() => ClaimResponse, (r) => r.claim)
  responses: ClaimResponse[];

  @OneToMany(() => ClaimStatusLog, (l) => l.claim)
  status_logs: ClaimStatusLog[];
}

@Entity('claim_documents')
export class ClaimDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  claim_id: string;

  @ManyToOne(() => Claim, (c) => c.documents)
  @JoinColumn({ name: 'claim_id' })
  claim: Claim;

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

@Entity('claim_responses')
export class ClaimResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  claim_id: string;

  @ManyToOne(() => Claim, (c) => c.responses)
  @JoinColumn({ name: 'claim_id' })
  claim: Claim;

  @Column({ type: 'uuid' })
  responded_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'responded_by' })
  responder: User;

  @Column({ type: 'varchar', length: 50 })
  response_type: ClaimResponseType;

  @Column({ type: 'text' })
  response_content: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  counter_amount: number;

  @Column({ type: 'integer', nullable: true })
  counter_time_days: number;

  @Column({ type: 'text', nullable: true })
  justification: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

@Entity('claim_status_logs')
export class ClaimStatusLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  claim_id: string;

  @ManyToOne(() => Claim, (c) => c.status_logs)
  @JoinColumn({ name: 'claim_id' })
  claim: Claim;

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
