import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Multi-tier trunk — Slice T0c-1. The party-role REGISTRY.
 *
 * One row per party-role code (EMPLOYER / CONTRACTOR / ENGINEER / …) — the
 * role a party plays on a project or contract. Mirrors the
 * ContractRelationshipType registry pattern (migration 1768000000001):
 * the registry is the SINGLE SOURCE for valid codes + labels ×3 locales,
 * served via GET /party-roles and used by ContractPartiesService to validate
 * contract_parties.role_code (a SOFT varchar reference, no hard FK — the
 * contract_type / relationship_type convention). Adding a future role =
 * INSERT a row (no code change, no ALTER TYPE).
 *
 * applies_to scopes where a role is offered: 'project' | 'contract' | 'both'.
 * The contract-party picker consumes applies_to IN ('contract','both').
 *
 * NOTE: distinct from the legacy PartyType enum on ProjectParty — that enum
 * stays untouched; a shared role-vocabulary consolidation is a later slice.
 */
@Entity('party_roles')
export class PartyRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable machine code (EMPLOYER, CONTRACTOR, …) — what contract_parties.role_code stores. */
  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  label_en: string;

  @Column({ type: 'varchar', length: 120 })
  label_ar: string;

  /** DRAFT pending legal-terminology review (clauseType.* posture). */
  @Column({ type: 'varchar', length: 120 })
  label_fr: string;

  /** 'project' | 'contract' | 'both' — where this role may be used (DB CHECK-enforced). */
  @Column({ type: 'varchar', length: 10 })
  applies_to: string;

  /** Inactive rows are hidden from the default list and rejected on write. */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
