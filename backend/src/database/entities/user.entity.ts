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
import { ProjectMember } from './project-member.entity';
import { Notification } from './notification.entity';
import { AuditLog } from './audit-log.entity';

export enum UserRole {
  SYSTEM_ADMIN = 'SYSTEM_ADMIN',
  OPERATIONS = 'OPERATIONS',
  OWNER_ADMIN = 'OWNER_ADMIN',
  OWNER_CREATOR = 'OWNER_CREATOR',
  OWNER_REVIEWER = 'OWNER_REVIEWER',
  CONTRACTOR_ADMIN = 'CONTRACTOR_ADMIN',
  CONTRACTOR_CREATOR = 'CONTRACTOR_CREATOR',
  CONTRACTOR_REVIEWER = 'CONTRACTOR_REVIEWER',
  CONTRACTOR_TENDERING = 'CONTRACTOR_TENDERING',
}

export enum JobTitle {
  CONTRACT_ADMINISTRATOR = 'Contract Administrator',
  CONTRACTS_MANAGER = 'Contracts Manager',
  CONTRACTS_DIRECTOR = 'Contracts Director',
  CONTRACTS_CLAIMS_TEAM_LEADER = 'Contracts & Claims Team Leader',
  SENIOR_CONTRACTS_CLAIMS_ENGINEER = 'Senior Contracts and Claims Engineer',
  JUNIOR_CONTRACTS_ENGINEER = 'Junior Contracts Engineer',
  PROJECT_DIRECTOR = 'Project Director',
  PROJECT_MANAGER = 'Project Manager',
  LEGAL_COUNSEL = 'Legal Counsel',
  CEO = 'Chief Operating Officer (CEO)',
  CFO = 'Chief Financial Officer (CFO)',
  COO = 'Chief Operating Officer (COO)',
  MANAGING_DIRECTOR = 'Managing Director',
  TENDERING_MANAGER = 'Tendering Manager',
  TECHNICAL_OFFICE_MANAGER = 'Technical Office Manager',
  PROCUREMENT_MANAGER = 'Procurement Manager',
  COST_CONTROL_MANAGER = 'Cost Control Manager',
  COMMERCIAL_DIRECTOR = 'Commercial Director',
  OPERATIONS_DIRECTOR = 'Operations Director',
  FORENSIC_PLANNER = 'Forensic Planner',
}

export enum PermissionLevel {
  VIEWER = 'VIEWER',
  COMMENTER = 'COMMENTER',
  EDITOR = 'EDITOR',
  APPROVER = 'APPROVER',
}

/** Default permission level for each job title (can be overridden per user per project) */
export const JOB_TITLE_DEFAULT_PERMISSION: Record<JobTitle, PermissionLevel> = {
  [JobTitle.CEO]: PermissionLevel.APPROVER,
  [JobTitle.CFO]: PermissionLevel.APPROVER,
  [JobTitle.COO]: PermissionLevel.APPROVER,
  [JobTitle.MANAGING_DIRECTOR]: PermissionLevel.APPROVER,
  [JobTitle.CONTRACTS_DIRECTOR]: PermissionLevel.APPROVER,
  [JobTitle.PROJECT_DIRECTOR]: PermissionLevel.APPROVER,
  [JobTitle.CONTRACTS_MANAGER]: PermissionLevel.EDITOR,
  [JobTitle.TENDERING_MANAGER]: PermissionLevel.EDITOR,
  [JobTitle.PROJECT_MANAGER]: PermissionLevel.EDITOR,
  [JobTitle.LEGAL_COUNSEL]: PermissionLevel.EDITOR,
  [JobTitle.CONTRACTS_CLAIMS_TEAM_LEADER]: PermissionLevel.EDITOR,
  [JobTitle.SENIOR_CONTRACTS_CLAIMS_ENGINEER]: PermissionLevel.EDITOR,
  [JobTitle.CONTRACT_ADMINISTRATOR]: PermissionLevel.EDITOR,
  [JobTitle.JUNIOR_CONTRACTS_ENGINEER]: PermissionLevel.EDITOR,
  [JobTitle.TECHNICAL_OFFICE_MANAGER]: PermissionLevel.VIEWER,
  [JobTitle.PROCUREMENT_MANAGER]: PermissionLevel.VIEWER,
  [JobTitle.COST_CONTROL_MANAGER]: PermissionLevel.VIEWER,
  [JobTitle.COMMERCIAL_DIRECTOR]: PermissionLevel.VIEWER,
  [JobTitle.OPERATIONS_DIRECTOR]: PermissionLevel.VIEWER,
  [JobTitle.FORENSIC_PLANNER]: PermissionLevel.VIEWER,
};

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  organization_id: string;

  @ManyToOne(() => Organization, (org) => org.users, { nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255 })
  password_hash: string;

  @Column({ type: 'varchar', length: 100 })
  first_name: string;

  @Column({ type: 'varchar', length: 100 })
  last_name: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column({ type: 'varchar', length: 100, nullable: true })
  job_title: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  default_permission_level: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'boolean', default: false })
  is_email_verified: boolean;

  @Column({ type: 'boolean', default: false })
  mfa_enabled: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mfa_secret: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  invitation_token: string;

  @Column({ type: 'timestamptz', nullable: true })
  invitation_expires_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  last_login_at: Date;

  @Column({ type: 'varchar', length: 10, default: 'en' })
  preferred_language: string;

  @Column({ type: 'int', default: 0 })
  failed_login_attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  locked_until: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  refresh_token_hash: string;

  @Column({ type: 'boolean', default: false })
  onboarding_completed: boolean;

  @Column({ type: 'varchar', length: 20, default: 'none' })
  onboarding_level: string; // 'none' | 'quick' | 'comprehensive'

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => ProjectMember, (pm) => pm.user)
  project_memberships: ProjectMember[];

  @OneToMany(() => Notification, (n) => n.user)
  notifications: Notification[];

  @OneToMany(() => AuditLog, (log) => log.user)
  audit_logs: AuditLog[];
}
