import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from './organization.entity';
import { Project } from './project.entity';
import { Contract } from './contract.entity';
import { User } from './user.entity';

/**
 * 7.22 Slice 1 — how far a position reaches.
 *
 * Stored as varchar (the RedlineStatus / SignatureStatus / ClauseSource
 * convention), NOT a pg enum, so adding a scope later is a code change with no
 * `ALTER TYPE` migration (CLAUDE.md ARCHITECTURE RULE 10 / the soft-code
 * `relationship_type` + `role_code` precedent).
 *
 *   ORG      → the org-wide default. `project_id` and `contract_id` are NULL.
 *   PROJECT  → narrows to one project. `project_id` set, `contract_id` NULL.
 *   CONTRACT → narrows to one contract. `contract_id` set; `project_id` MAY
 *              also be set (the contract's parent project) as a denormalized
 *              convenience for the Slice-2 resolver's scope-precedence query.
 *
 * Precedence (CONTRACT beats PROJECT beats ORG) is a SLICE-2 resolver concern —
 * this slice only stores the scope, it never resolves it.
 */
export enum PlaybookScope {
  ORG = 'ORG',
  PROJECT = 'PROJECT',
  CONTRACT = 'CONTRACT',
}

/**
 * 7.22 Slice 1 — the shape of the standard position, which determines how
 * `value_config` is read. Also varchar, same rationale as PlaybookScope.
 *
 * Maps 1:1 onto the NEXT_PHASES 7.22 worked examples:
 *   RANGE     → "Payment terms: acceptable 28-45 days"
 *   THRESHOLD → "Retention: max 10%" / "Liability cap: min 100% of value"
 *   ENUM      → "Dispute resolution: preferred ICC Arbitration"
 *   REQUIRED  → "this clause type must be present at all"
 *   TEXT      → a free-text standard position (the Arabic/English
 *               playbook-definition case)
 */
export enum PlaybookRuleType {
  RANGE = 'RANGE',
  THRESHOLD = 'THRESHOLD',
  ENUM = 'ENUM',
  REQUIRED = 'REQUIRED',
  TEXT = 'TEXT',
}

/** Which side of the threshold is acceptable. */
export enum PlaybookThresholdDirection {
  AT_MOST = 'AT_MOST',
  AT_LEAST = 'AT_LEAST',
}

// ─── value_config shapes, keyed by rule_type ────────────────────────────────
//
// `value_config` is jsonb and is ALWAYS read through `rule_type` — the pair is
// the unit of meaning, and neither half is interpretable alone. The DTO layer
// validates the shape per rule_type on create; the service re-validates the
// MERGED (existing + patch) pair on update, because a PATCH may change either
// half independently and only the merged result is meaningful.
//
//   RANGE:     { "min": number, "max": number, "unit": string }
//   THRESHOLD: { "direction": "AT_MOST" | "AT_LEAST", "value": number, "unit": string }
//   ENUM:      { "allowed": string[] }
//   REQUIRED:  { "required": true }
//   TEXT:      { "text": string }

/** RANGE — an acceptable band, e.g. payment terms 28–45 days. */
export interface PlaybookRangeConfig {
  min: number;
  max: number;
  unit: string;
}

/** THRESHOLD — a one-sided bound, e.g. retention AT_MOST 10 percent. */
export interface PlaybookThresholdConfig {
  direction: PlaybookThresholdDirection;
  value: number;
  unit: string;
}

/** ENUM — a closed set of acceptable values, e.g. preferred seats/rules. */
export interface PlaybookEnumConfig {
  allowed: string[];
}

/** REQUIRED — the clause type must simply be present. */
export interface PlaybookRequiredConfig {
  required: true;
}

/** TEXT — a free-text standard position (supports Arabic per 7.22). */
export interface PlaybookTextConfig {
  text: string;
}

export type PlaybookValueConfig =
  | PlaybookRangeConfig
  | PlaybookThresholdConfig
  | PlaybookEnumConfig
  | PlaybookRequiredConfig
  | PlaybookTextConfig;

/**
 * 7.22 Slice 1 — ONE org's standard position for ONE clause type.
 *
 * ORG-SCOPED, NOT contract-scoped. `organization_id` is carried DIRECTLY and is
 * the tenancy root of every read and write, so this entity sits OUTSIDE the
 * Option B contract chokepoint — the same class as `ErpConnection` (CLAUDE.md:
 * "ERP connections are org-scoped, NOT contract-scoped — they carry
 * organization_id directly, so they are outside the Option B contract
 * chokepoint"). `project_id` / `contract_id` are NARROWING columns, never the
 * tenancy root: they scope a position DOWN inside an org that already owns it.
 *
 * FK on-delete follows OWNERSHIP (lesson #233):
 *   organization_id → CASCADE. The org owns the row; without the org it is
 *                     meaningless. Mirrors ErpConnection.organization.
 *   project_id      → CASCADE. A PROJECT-scoped position exists only to narrow
 *                     to that project. SET NULL was rejected: it would leave
 *                     scope='PROJECT' with project_id NULL — a corrupt state
 *                     that reads as "unscoped" to the Slice-2 resolver.
 *   contract_id     → CASCADE. Same argument as project_id.
 *   created_by      → SET NULL. An ACTOR reference, not structure. Deleting the
 *                     admin who authored a position must not delete the org's
 *                     standard position (the `granted_by` / `revoked_by`
 *                     precedent on guest_contract_access).
 *
 * SLICE-1 BOUNDARY: this is the DATA LAYER only. Nothing here is wired into
 * compliance, the AI pipeline, or the frontend — that is Slice 2/3.
 */
@Entity('playbook_positions')
// Serves the resolver's scope-precedence lookup (Slice 2) and any org-wide list.
@Index('idx_playbook_positions_org_scope', [
  'organization_id',
  'scope',
  'project_id',
  'contract_id',
])
// Serves "what is our position on <clause_type>?" within an org.
@Index('idx_playbook_positions_org_clause_type', [
  'organization_id',
  'clause_type',
])
export class PlaybookPosition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Owning org — the tenancy subject for EVERY query. Never client-supplied. */
  @Index('idx_playbook_positions_organization_id')
  @Column({ type: 'uuid' })
  organization_id: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({
    type: 'varchar',
    length: 20,
    default: PlaybookScope.ORG,
  })
  scope: PlaybookScope;

  /** Set when scope = PROJECT (or, denormalized, for a CONTRACT under a project). */
  @Column({ type: 'uuid', nullable: true })
  project_id: string | null;

  @ManyToOne(() => Project, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  /** Set when scope = CONTRACT. */
  @Column({ type: 'uuid', nullable: true })
  contract_id: string | null;

  @ManyToOne(() => Contract, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract | null;

  /**
   * The clause type this position governs. Either one of the 17 standard keys
   * (`payment`, `liability`, `dispute_resolution`, … — the frontend's
   * CLAUSE_TYPE_LABELS vocabulary) or an org's own free string. Deliberately a
   * plain varchar with NO backend allowlist: 7.22 requires "any custom clause
   * type the org wants to track", and `is_custom_clause_type` is what
   * distinguishes the two cases for the UI and the Slice-2 resolver.
   */
  @Column({ type: 'varchar', length: 100 })
  clause_type: string;

  /** true = `clause_type` is org-invented, not one of the standard keys. */
  @Column({ type: 'boolean', default: false })
  is_custom_clause_type: boolean;

  @Column({ type: 'varchar', length: 20 })
  rule_type: PlaybookRuleType;

  /**
   * The typed position value. ALWAYS interpreted through `rule_type` — see the
   * shape table above. NOT NULL: a position with no value has no meaning
   * (REQUIRED stores the explicit `{ "required": true }` rather than NULL, so
   * "no value" is never a legal state).
   */
  @Column({ type: 'jsonb' })
  value_config: PlaybookValueConfig;

  /** Optional free-text rationale shown to reviewers ("why this is our line"). */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Soft on/off. Deactivating retains the position without it being resolved. */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  /** The OWNER_ADMIN who authored it. NULL = author since deleted (SET NULL). */
  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  creator: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
