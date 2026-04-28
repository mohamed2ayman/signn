import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { User } from './user.entity';

export enum NegotiationEventType {
  CLAUSE_FLAGGED = 'CLAUSE_FLAGGED',
  CLAUSE_REPLACED = 'CLAUSE_REPLACED',
  CLAUSE_ACCEPTED = 'CLAUSE_ACCEPTED',
  CLAUSE_REJECTED = 'CLAUSE_REJECTED',
  AI_SUGGESTION_APPLIED = 'AI_SUGGESTION_APPLIED',
}

export enum NegotiationEventSource {
  WORD_ADDIN = 'WORD_ADDIN',
  WEB_APP = 'WEB_APP',
}

@Entity('negotiation_events')
@Index('idx_negotiation_contract_clause', ['contract_id', 'clause_ref'])
export class NegotiationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'varchar', length: 255 })
  clause_ref: string;

  @Column({ type: 'enum', enum: NegotiationEventType })
  event_type: NegotiationEventType;

  @Column({ type: 'text', nullable: true })
  original_text: string | null;

  @Column({ type: 'text', nullable: true })
  new_text: string | null;

  @Column({ type: 'uuid' })
  performed_by: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'performed_by' })
  performer: User | null;

  @Column({ type: 'enum', enum: NegotiationEventSource })
  source: NegotiationEventSource;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
