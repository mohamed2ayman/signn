import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { ContractClause } from './contract-clause.entity';
import { User } from './user.entity';

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum RiskAnalysisStatus {
  OPEN = 'OPEN',
  APPROVED = 'APPROVED',
  MANUAL_ADJUSTED = 'MANUAL_ADJUSTED',
  OBSERVED = 'OBSERVED',
  REJECTED = 'REJECTED',
}

@Entity('risk_analyses')
export class RiskAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, (contract) => contract.risk_analyses)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid', nullable: true })
  contract_clause_id: string;

  @ManyToOne(() => ContractClause, (cc) => cc.risk_analyses, { nullable: true })
  @JoinColumn({ name: 'contract_clause_id' })
  contract_clause: ContractClause;

  @Column({ type: 'varchar', length: 100 })
  risk_category: string;

  @Column({ type: 'enum', enum: RiskLevel })
  risk_level: RiskLevel;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text', nullable: true })
  recommendation: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  citation_source: string;

  @Column({ type: 'text', nullable: true })
  citation_excerpt: string;

  @Column({ type: 'varchar', length: 50, default: RiskAnalysisStatus.OPEN })
  status: string;

  @Column({ type: 'uuid', nullable: true })
  handled_by: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'handled_by' })
  handler: User;

  @Column({ type: 'timestamptz', nullable: true })
  handled_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
