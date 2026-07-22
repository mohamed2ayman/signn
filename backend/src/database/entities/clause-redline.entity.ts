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
import { Contract } from './contract.entity';
import { ContractClause } from './contract-clause.entity';
import { ContractVersion } from './contract-version.entity';
import { Clause } from './clause.entity';
import { User } from './user.entity';

/**
 * 7.19 Slice 1 — the redline lifecycle. Stored as varchar (SignatureStatus /
 * ClauseSource convention), not a pg enum.
 *
 *   PROPOSED  → the live state; the only state a decision can act on.
 *   ACCEPTED  → host promoted the proposed body into the live clause set
 *               (snapshot + parent-chain; resulting_version_id/_clause_id set).
 *   REJECTED  → host declined; clause untouched.
 *   COUNTERED → host answered with a child redline (parent_redline_id chain,
 *               round + 1). Counterparty-side accept of a counter is DEFERRED —
 *               a host counter sits PROPOSED with no accept path in Slice 1.
 *   WITHDRAWN → the author pulled it back; clause untouched.
 *   STALE     → an accept found the live clause body no longer matches
 *               base_content_snapshot (someone changed the clause since
 *               propose-time) — the redline is dead, nothing was mutated.
 */
export enum RedlineStatus {
  PROPOSED = 'PROPOSED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  COUNTERED = 'COUNTERED',
  WITHDRAWN = 'WITHDRAWN',
  STALE = 'STALE',
}

/**
 * Who the author IS structurally. Slice 1 traffic is Model A managing-user
 * counterparties (via "Shared with me" bindings) → MANAGING_USER. GUEST is
 * reserved for the later org-less-counterparty slice (gated on #8c): guest
 * accounts are currently HARD-EXCLUDED from redline writes at the service
 * seam (RedlineService.assertNotGuestWriter — uniform 404), so no new row
 * carries GUEST today; the enum keeps the data model identity-agnostic for
 * when that slice re-opens writes atomically with its hardened gate.
 */
export enum RedlineAuthorIdentitySource {
  MANAGING_USER = 'MANAGING_USER',
  GUEST = 'GUEST',
}

/**
 * 7.19 Slice 1 — one clause-level block-replace proposal in the counterparty
 * negotiation loop (see the migration doc for the full model). Anchored on the
 * contract_clauses JUNCTION row (the stable anchor comments use) so the thread
 * survives clause promotions, which repoint the junction's clause_id but keep
 * the junction id.
 */
@Entity('clause_redlines')
@Index('idx_clause_redlines_contract_clause_status', [
  'contract_id',
  'contract_clause_id',
  'status',
])
export class ClauseRedline {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Column({ type: 'uuid' })
  contract_clause_id: string;

  @ManyToOne(() => ContractClause, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_clause_id' })
  contract_clause: ContractClause;

  /** Negotiation round on this clause thread: 1 = opening proposal, +1 per counter. */
  @Column({ type: 'int', default: 1 })
  round: number;

  /** The redline this one counters (null for an opening proposal). */
  @Column({ type: 'uuid', nullable: true })
  parent_redline_id: string | null;

  @ManyToOne(() => ClauseRedline, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_redline_id' })
  parent_redline: ClauseRedline | null;

  @Column({ type: 'text', nullable: true })
  proposed_title: string | null;

  /** The full replacement clause body (block-replace unit). */
  @Column({ type: 'text' })
  proposed_content: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /**
   * The ACTIVE clause body at propose-time — the diff base for rendering AND
   * the staleness guard on accept (mismatch with the live body ⇒ STALE, no
   * mutation).
   */
  @Column({ type: 'text' })
  base_content_snapshot: string;

  @Column({ type: 'uuid', nullable: true })
  author_user_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_user_id' })
  author: User | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: RedlineAuthorIdentitySource.MANAGING_USER,
  })
  author_identity_source: RedlineAuthorIdentitySource;

  @Column({ type: 'varchar', length: 20, default: RedlineStatus.PROPOSED })
  status: RedlineStatus;

  @Column({ type: 'uuid', nullable: true })
  decided_by_user_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'decided_by_user_id' })
  decided_by: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'text', nullable: true })
  decision_note: string | null;

  /** The contract_version snapshot minted by the accept (null until ACCEPTED). */
  @Column({ type: 'uuid', nullable: true })
  resulting_version_id: string | null;

  @ManyToOne(() => ContractVersion, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resulting_version_id' })
  resulting_version: ContractVersion | null;

  /** The promoted Clause row the accept minted (null until ACCEPTED). */
  @Column({ type: 'uuid', nullable: true })
  resulting_clause_id: string | null;

  @ManyToOne(() => Clause, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resulting_clause_id' })
  resulting_clause: Clause | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
