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
import { ProjectMember } from './project-member.entity';
import { Contract } from './contract.entity';
import { ProjectParty } from './project-party.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  organization_id: string;

  @ManyToOne(() => Organization, (org) => org.projects)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  objective: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string;

  @Column({ type: 'date', nullable: true })
  start_date: Date;

  @Column({ type: 'date', nullable: true })
  end_date: Date;

  /**
   * Party Foundation Slice 1a — the project-level DEFAULT party role that a
   * contract inherits for `contracts.host_party_role_code`. Soft varchar CODE
   * from the party_roles registry, validated against ACTIVE rows in
   * ProjectsService (create + update); no hard FK, matching the
   * contract_parties.role_code convention. NULL = no default set.
   *
   * NOTE: this holds a CONTRACT-scoped role code, not a project-scoped one.
   * Any future consumer must query the contract-scoped role list — filtering
   * the registry by applies_to = 'project' returns nothing usable today.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  default_party_role_code: string | null;

  @Column({ type: 'uuid' })
  created_by: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => ProjectMember, (pm) => pm.project)
  members: ProjectMember[];

  @OneToMany(() => Contract, (c) => c.project)
  contracts: Contract[];

  @OneToMany(() => ProjectParty, (pp) => pp.project)
  parties: ProjectParty[];
}
