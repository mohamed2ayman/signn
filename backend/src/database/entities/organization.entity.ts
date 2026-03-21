import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { Project } from './project.entity';
import { Clause } from './clause.entity';
import { KnowledgeAsset } from './knowledge-asset.entity';
import { OrganizationSubscription } from './organization-subscription.entity';
import { AuditLog } from './audit-log.entity';

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  industry: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  crn: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  logo_url: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => User, (user) => user.organization)
  users: User[];

  @OneToMany(() => Project, (project) => project.organization)
  projects: Project[];

  @OneToMany(() => Clause, (clause) => clause.organization)
  clauses: Clause[];

  @OneToMany(() => KnowledgeAsset, (asset) => asset.organization)
  knowledge_assets: KnowledgeAsset[];

  @OneToMany(() => OrganizationSubscription, (sub) => sub.organization)
  subscriptions: OrganizationSubscription[];

  @OneToMany(() => AuditLog, (log) => log.organization)
  audit_logs: AuditLog[];
}
