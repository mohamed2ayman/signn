import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Contract } from './contract.entity';
import { Clause } from './clause.entity';
import { RiskAnalysis } from './risk-analysis.entity';
import { Obligation } from './obligation.entity';
import { ContractComment } from './contract-comment.entity';

@Entity('contract_clauses')
export class ContractClause {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, (contract) => contract.contract_clauses)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid' })
  clause_id: string;

  @ManyToOne(() => Clause, (clause) => clause.contract_clauses)
  @JoinColumn({ name: 'clause_id' })
  clause: Clause;

  @Column({ type: 'varchar', length: 50, nullable: true })
  section_number: string | null;

  @Column({ type: 'int', default: 0 })
  order_index: number;

  @Column({ type: 'jsonb', nullable: true })
  customizations: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @OneToMany(() => RiskAnalysis, (ra) => ra.contract_clause)
  risk_analyses: RiskAnalysis[];

  @OneToMany(() => Obligation, (o) => o.contract_clause)
  obligations: Obligation[];

  @OneToMany(() => ContractComment, (c) => c.contract_clause)
  comments: ContractComment[];
}
