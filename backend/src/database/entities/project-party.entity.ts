import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Organization } from './organization.entity';
import { Project } from './project.entity';
import { ContractorResponse } from './contractor-response.entity';

export enum PartyType {
  EMPLOYER = 'EMPLOYER',
  ENGINEERING_CONSULTANT = 'ENGINEERING_CONSULTANT',
  DESIGN_CONSULTANT = 'DESIGN_CONSULTANT',
  COST_CONSULTANT = 'COST_CONSULTANT',
  CONTRACTOR = 'CONTRACTOR',
  SUBCONTRACTOR = 'SUBCONTRACTOR',
}

/**
 * Default permissions per party type.
 * Used to determine what actions a party can take in the contract workflow.
 */
export const PARTY_TYPE_PERMISSIONS: Record<PartyType, {
  can_create_contracts: boolean;
  can_review_contracts: boolean;
  can_approve_contracts: boolean;
  can_submit_responses: boolean;
  can_manage_subparties: boolean;
  can_view_risk_analysis: boolean;
}> = {
  [PartyType.EMPLOYER]: {
    can_create_contracts: true,
    can_review_contracts: true,
    can_approve_contracts: true,
    can_submit_responses: false,
    can_manage_subparties: true,
    can_view_risk_analysis: true,
  },
  [PartyType.ENGINEERING_CONSULTANT]: {
    can_create_contracts: false,
    can_review_contracts: true,
    can_approve_contracts: true,
    can_submit_responses: true,
    can_manage_subparties: false,
    can_view_risk_analysis: true,
  },
  [PartyType.DESIGN_CONSULTANT]: {
    can_create_contracts: false,
    can_review_contracts: true,
    can_approve_contracts: false,
    can_submit_responses: true,
    can_manage_subparties: false,
    can_view_risk_analysis: true,
  },
  [PartyType.COST_CONSULTANT]: {
    can_create_contracts: false,
    can_review_contracts: true,
    can_approve_contracts: false,
    can_submit_responses: true,
    can_manage_subparties: false,
    can_view_risk_analysis: true,
  },
  [PartyType.CONTRACTOR]: {
    can_create_contracts: false,
    can_review_contracts: true,
    can_approve_contracts: false,
    can_submit_responses: true,
    can_manage_subparties: true,
    can_view_risk_analysis: false,
  },
  [PartyType.SUBCONTRACTOR]: {
    can_create_contracts: false,
    can_review_contracts: true,
    can_approve_contracts: false,
    can_submit_responses: true,
    can_manage_subparties: false,
    can_view_risk_analysis: false,
  },
};

@Entity('project_parties')
export class ProjectParty {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  project_id: string;

  @ManyToOne(() => Project, (project) => project.parties)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'uuid' })
  owner_organization_id: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'owner_organization_id' })
  owner_organization: Organization;

  @Column({ type: 'uuid', nullable: true })
  party_organization_id: string;

  @ManyToOne(() => Organization, { nullable: true })
  @JoinColumn({ name: 'party_organization_id' })
  party_organization: Organization;

  @Column({ type: 'enum', enum: PartyType })
  party_type: PartyType;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  contact_person: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  invitation_token: string;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  invitation_status: string;

  @Column({ type: 'jsonb', nullable: true })
  permissions: Record<string, boolean>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @OneToMany(() => ContractorResponse, (cr) => cr.party)
  responses: ContractorResponse[];
}
