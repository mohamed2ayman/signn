import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { OrganizationSubscription } from './organization-subscription.entity';

@Entity('subscription_plans')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency: string;

  @Column({ type: 'int' })
  duration_days: number;

  @Column({ type: 'int' })
  max_projects: number;

  @Column({ type: 'int' })
  max_users: number;

  @Column({ type: 'int' })
  max_contracts_per_project: number;

  @Column({ type: 'jsonb', nullable: true })
  features: Record<string, boolean>;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'boolean', default: false })
  require_mfa: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @OneToMany(() => OrganizationSubscription, (sub) => sub.plan)
  subscriptions: OrganizationSubscription[];
}
