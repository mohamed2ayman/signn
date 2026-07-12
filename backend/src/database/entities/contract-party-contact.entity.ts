import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ContractParty } from './contract-party.entity';

/**
 * Multi-tier trunk — Slice T0c-1. A named CONTACT PERSON under a contract
 * party. Owned child (ON DELETE CASCADE from contract_parties).
 *
 * is_designated_signatory is service-enforced (ContractPartiesService):
 * only allowed when the parent party is_signatory=true, and at most ONE
 * designated signatory per party.
 */
@Entity('contract_party_contacts')
export class ContractPartyContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_party_id: string;

  @ManyToOne(() => ContractParty, (party) => party.contacts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'contract_party_id' })
  contract_party: ContractParty;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'boolean', default: false })
  is_designated_signatory: boolean;
}
