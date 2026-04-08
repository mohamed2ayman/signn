import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { User } from './user.entity';

export enum ContractVersionEventType {
  CREATED = 'CREATED',
  EDITED = 'EDITED',
  RISK_ANALYZED = 'RISK_ANALYZED',
  SUBMITTED_FOR_APPROVAL = 'SUBMITTED_FOR_APPROVAL',
  APPROVED = 'APPROVED',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  SHARED_WITH_COUNTERPARTY = 'SHARED_WITH_COUNTERPARTY',
  COUNTERPARTY_RESPONSE_RECEIVED = 'COUNTERPARTY_RESPONSE_RECEIVED',
  SUBMITTED_FOR_REVIEW = 'SUBMITTED_FOR_REVIEW',
  REVIEWED_AND_RETURNED = 'REVIEWED_AND_RETURNED',
  SUBMITTED_TO_COUNTERPARTY = 'SUBMITTED_TO_COUNTERPARTY',
  CERTIFIED_BY_COUNTERPARTY = 'CERTIFIED_BY_COUNTERPARTY',
  FORWARDED_TO_COUNTERPARTY = 'FORWARDED_TO_COUNTERPARTY',
  NEGOTIATION_ROUND = 'NEGOTIATION_ROUND',
  ESCALATED = 'ESCALATED',
  EXECUTED = 'EXECUTED',
  AMENDMENT_ADDED = 'AMENDMENT_ADDED',
}

@Entity('contract_versions')
export class ContractVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, (contract) => contract.versions)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'int' })
  version_number: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  version_label: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  event_type: ContractVersionEventType | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  event_description: string | null;

  @Column({ type: 'uuid', nullable: true })
  triggered_by: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'triggered_by' })
  triggered_by_user: User;

  @Column({ type: 'varchar', length: 100, nullable: true })
  triggered_by_role: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  counterparty_role: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  contract_status_at_version: string | null;

  @Column({ type: 'jsonb' })
  snapshot: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  clause_snapshot: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  is_milestone: boolean;

  @Column({ type: 'text', nullable: true })
  change_summary: string;

  @Column({ type: 'uuid', nullable: true })
  created_by: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
