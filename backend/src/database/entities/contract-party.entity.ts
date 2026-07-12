import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Contract } from './contract.entity';
import { Organization } from './organization.entity';
import { ContractPartyContact } from './contract-party-contact.entity';

/**
 * Multi-tier trunk — Slice T0c-1. A PARTY on a contract (Employer,
 * Contractor, Engineer, …).
 *
 * Contract-scoped (rooted in contract → project → organization_id): every
 * read/write MUST first pass the ContractAccessService.findInOrg wall
 * (404-not-403) — see ContractPartiesService. contract_id is ON DELETE
 * CASCADE: parties are owned children of their contract (deliberately NOT
 * the RESTRICT used for contracts.parent_contract_id).
 *
 * role_code is a SOFT varchar reference into the party_roles registry
 * (no hard FK — the contract_type / relationship_type convention);
 * validated in the service: must be active + applies_to IN
 * ('contract','both').
 *
 * organization_id is an OPTIONAL link to a SIGN organization — v1
 * org-scoped: only the host org itself may be linked (a foreign org id
 * resolves 404, no existence leak). ON DELETE SET NULL.
 */
@Entity('contract_parties')
export class ContractParty {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  /** Soft code from the party_roles registry (EMPLOYER, CONTRACTOR, …). */
  @Column({ type: 'varchar', length: 50 })
  role_code: string;

  /** The party's organisation/firm name as it appears on the contract. */
  @Column({ type: 'varchar', length: 255 })
  org_name: string;

  /** Whether this party signs the contract. Gates designated-signatory contacts. */
  @Column({ type: 'boolean', default: false })
  is_signatory: boolean;

  /** Optional link to a SIGN organization (v1: host org only). */
  @Column({ type: 'uuid', nullable: true })
  organization_id: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  legal_tax_card: string | null;

  @Column({ type: 'text', nullable: true })
  legal_address: string | null;

  @OneToMany(() => ContractPartyContact, (contact) => contact.contract_party)
  contacts: ContractPartyContact[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
