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
import { Project } from './project.entity';
import { User } from './user.entity';
import { ContractClause } from './contract-clause.entity';
import { ContractVersion } from './contract-version.entity';
import { ContractComment } from './contract-comment.entity';
import { RiskAnalysis } from './risk-analysis.entity';
import { Obligation } from './obligation.entity';
import { ContractorResponse } from './contractor-response.entity';
import { DocumentUpload } from './document-upload.entity';
import { ContractApprover } from './contract-approver.entity';

export enum ContractStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  PENDING_TENDERING = 'PENDING_TENDERING',
  SENT_TO_CONTRACTOR = 'SENT_TO_CONTRACTOR',
  CONTRACTOR_REVIEWING = 'CONTRACTOR_REVIEWING',
  PENDING_FINAL_APPROVAL = 'PENDING_FINAL_APPROVAL',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  RISK_ESCALATION_PENDING = 'RISK_ESCALATION_PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  TERMINATED = 'TERMINATED',
}

export enum SignatureStatus {
  PENDING_SIGNATURE = 'PENDING_SIGNATURE',
  AWAITING_COUNTERPARTY = 'AWAITING_COUNTERPARTY',
  FULLY_EXECUTED = 'FULLY_EXECUTED',
}

export enum LicenseOrganization {
  FIDIC = 'FIDIC',
  NEC = 'NEC',
  OTHER = 'OTHER',
}

export enum ContractType {
  // ─── FIDIC 2nd Edition (Rainbow Suite 2017) ─────────────
  FIDIC_RED_BOOK_2017 = 'FIDIC_RED_BOOK_2017',
  FIDIC_YELLOW_BOOK_2017 = 'FIDIC_YELLOW_BOOK_2017',
  FIDIC_SILVER_BOOK_2017 = 'FIDIC_SILVER_BOOK_2017',
  FIDIC_WHITE_BOOK_2017 = 'FIDIC_WHITE_BOOK_2017',
  FIDIC_GREEN_BOOK_2021 = 'FIDIC_GREEN_BOOK_2021',
  FIDIC_EMERALD_BOOK_2019 = 'FIDIC_EMERALD_BOOK_2019',

  // ─── FIDIC 1st Edition (Rainbow Suite 1999) ────────────
  FIDIC_RED_BOOK_1999 = 'FIDIC_RED_BOOK_1999',
  FIDIC_YELLOW_BOOK_1999 = 'FIDIC_YELLOW_BOOK_1999',
  FIDIC_SILVER_BOOK_1999 = 'FIDIC_SILVER_BOOK_1999',

  // ─── FIDIC Subcontracts ────────────────────────────────
  FIDIC_SUBCONTRACT_YELLOW_2019 = 'FIDIC_SUBCONTRACT_YELLOW_2019',

  // ─── FIDIC MDB Harmonised ─────────────────────────────
  FIDIC_PINK_BOOK = 'FIDIC_PINK_BOOK',

  // ─── FIDIC Dredging ───────────────────────────────────
  FIDIC_BLUE_GREEN_BOOK_2016 = 'FIDIC_BLUE_GREEN_BOOK_2016',

  // ─── NEC4 Suite (June 2017, revised Jan 2023) ─────────
  NEC4_ECC = 'NEC4_ECC',
  NEC4_PSC = 'NEC4_PSC',
  NEC4_TSC = 'NEC4_TSC',
  NEC4_SC = 'NEC4_SC',
  NEC4_FC = 'NEC4_FC',
  NEC4_DBOC = 'NEC4_DBOC',
  NEC4_FMC = 'NEC4_FMC',
  NEC4_ALC = 'NEC4_ALC',
  NEC4_DRSC = 'NEC4_DRSC',

  // ─── NEC3 Suite (April 2013) ──────────────────────────
  NEC3_ECC = 'NEC3_ECC',
  NEC3_PSC = 'NEC3_PSC',
  NEC3_TSC = 'NEC3_TSC',
  NEC3_SC = 'NEC3_SC',
  NEC3_FC = 'NEC3_FC',
  NEC3_AC = 'NEC3_AC',

  // ─── NEC HK Edition ───────────────────────────────────
  NEC_ECC_HK = 'NEC_ECC_HK',
  NEC_TSC_HK = 'NEC_TSC_HK',

  // ─── NEC FAC/TAC ──────────────────────────────────────
  FAC_1 = 'FAC_1',
  TAC_1 = 'TAC_1',

  // ─── Ad-hoc ───────────────────────────────────────────
  ADHOC = 'ADHOC',
  UPLOADED = 'UPLOADED',
}

@Entity('contracts')
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  project_id: string;

  @ManyToOne(() => Project, (project) => project.contracts)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'varchar', length: 500 })
  name: string;

  @Column({ type: 'varchar', length: 50 })
  contract_type: ContractType;

  @Column({ type: 'enum', enum: ContractStatus, default: ContractStatus.DRAFT })
  status: ContractStatus;

  @Column({ type: 'int', default: 1 })
  current_version: number;

  @Column({ type: 'varchar', length: 30, default: 'MANUAL' })
  creation_flow: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  party_type: string;

  @Column({ type: 'boolean', default: false })
  license_acknowledged: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  license_organization: LicenseOrganization | null;

  @Column({ type: 'uuid' })
  created_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ type: 'uuid', nullable: true })
  approved_by: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'approved_by' })
  approver: User;

  @Column({ type: 'timestamptz', nullable: true })
  approved_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  shared_at: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  docusign_envelope_id: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  signature_status: SignatureStatus | null;

  @Column({ type: 'jsonb', nullable: true })
  signature_signers: Array<{
    email: string;
    name: string;
    status: string;
    signed_at?: string;
  }> | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  party_first_name: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  party_second_name: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  executed_at: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => ContractClause, (cc) => cc.contract)
  contract_clauses: ContractClause[];

  @OneToMany(() => ContractVersion, (cv) => cv.contract)
  versions: ContractVersion[];

  @OneToMany(() => ContractComment, (comment) => comment.contract)
  comments: ContractComment[];

  @OneToMany(() => RiskAnalysis, (ra) => ra.contract)
  risk_analyses: RiskAnalysis[];

  @OneToMany(() => Obligation, (o) => o.contract)
  obligations: Obligation[];

  @OneToMany(() => ContractorResponse, (cr) => cr.contract)
  contractor_responses: ContractorResponse[];

  @OneToMany(() => DocumentUpload, (du) => du.contract)
  documents: DocumentUpload[];

  @OneToMany(() => ContractApprover, (ca) => ca.contract)
  contract_approvers: ContractApprover[];
}
