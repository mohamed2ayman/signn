import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { ProjectParty } from './project-party.entity';

@Entity('contractor_responses')
export class ContractorResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, (contract) => contract.contractor_responses)
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid' })
  party_id: string;

  @ManyToOne(() => ProjectParty, (party) => party.responses)
  @JoinColumn({ name: 'party_id' })
  party: ProjectParty;

  @Column({ type: 'uuid', nullable: true })
  response_contract_id: string;

  @ManyToOne(() => Contract, { nullable: true })
  @JoinColumn({ name: 'response_contract_id' })
  response_contract: Contract;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  status: string;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
