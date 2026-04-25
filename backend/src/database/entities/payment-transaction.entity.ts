import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from './organization.entity';

export enum PaymentTransactionStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PENDING = 'PENDING',
}

@Entity('payment_transactions')
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  organization_id: string;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paymob_transaction_id: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 10 })
  currency: string;

  @Index()
  @Column({ type: 'varchar', length: 20 })
  status: string;

  @Column({ type: 'uuid', nullable: true })
  plan_id: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  plan_name: string | null;

  @Column({ type: 'jsonb', nullable: true })
  webhook_payload: Record<string, unknown> | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
