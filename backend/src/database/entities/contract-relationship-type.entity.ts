import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Multi-tier trunk — Slice T0a. The relationship-type REGISTRY.
 *
 * One row per relationship type (MAIN / SUBCONTRACT / NOMINATED_SUB / …) —
 * the contract's position in the delivery chain / legal relationship.
 * SEPARATE from ContractType (the standard form, e.g. FIDIC_RED_BOOK_2017).
 *
 * The registry is the SINGLE SOURCE for per-type metadata (labels, parent-link
 * rule, allowed parents, default signatory roles) — served to the frontend via
 * GET /contract-relationship-types and used by ContractsService to validate
 * CreateContractDto.relationship_type. Adding a future type = INSERT a row
 * (no code change, no ALTER TYPE).
 *
 * `contracts.relationship_type` stores the `code` as a SOFT varchar reference
 * (no hard FK) — matching the contract_type varchar convention.
 *
 * parent_link_rule / allowed_parent_types / default_signatory_role_* are
 * seeded metadata NOT consumed until later slices (T0b parent linking, T0c
 * signatories). Roles are plain string codes: PartyType vocabulary where
 * possible; GRANTOR / BENEFICIARY / SUPPLIER are new codes deliberately NOT
 * added to the PartyType enum in this slice.
 */
@Entity('contract_relationship_types')
export class ContractRelationshipType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable machine code (MAIN, SUBCONTRACT, …) — what contracts.relationship_type stores. */
  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  label_en: string;

  @Column({ type: 'varchar', length: 120 })
  label_ar: string;

  @Column({ type: 'varchar', length: 120 })
  label_fr: string;

  /** delivery_chain | appointment | property_rights | party_agreement */
  @Column({ type: 'varchar', length: 30 })
  domain_group: string;

  /** none | required | optional — consumed in T0b (parent linking). */
  @Column({ type: 'varchar', length: 20, default: 'none' })
  parent_link_rule: string;

  /** Array of relationship-type codes allowed as parent (T0b). */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  allowed_parent_types: string[];

  /** Default first-signatory role code (T0c). NULL for inactive/party-agreement types. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  default_signatory_role_1: string | null;

  /** Default second-signatory role code (T0c). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  default_signatory_role_2: string | null;

  /** Inactive rows are seeded "coming soon" types — rejected on create, hidden from the default list. */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
