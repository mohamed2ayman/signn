import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { ContractClause } from './contract-clause.entity';
import { User } from './user.entity';

export enum ObligationStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  OVERDUE = 'OVERDUE',
}

@Entity('obligations')
export class Obligation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, (contract) => contract.obligations)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid', nullable: true })
  contract_clause_id: string;

  @ManyToOne(() => ContractClause, (cc) => cc.obligations, { nullable: true })
  @JoinColumn({ name: 'contract_clause_id' })
  contract_clause: ContractClause;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  responsible_party: string;

  @Column({ type: 'date', nullable: true })
  due_date: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  frequency: string;

  @Column({ type: 'enum', enum: ObligationStatus, default: ObligationStatus.PENDING })
  status: ObligationStatus;

  @Column({ type: 'int', default: 7 })
  reminder_days_before: number;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;

  @Column({ type: 'uuid', nullable: true })
  completed_by: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'completed_by' })
  completer: User;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  evidence_url: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
