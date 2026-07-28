import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';

import { User } from './user.entity';
import { Contract } from './contract.entity';

/**
 * Phase 7.18 — Bucket 1a: guest ↔ contract binding.
 *
 * One row per (guest user, contract) pair the guest is allowed to access.
 * ContractAccessService READs this table to decide whether a GUEST caller
 * may access a specific contract. Bucket 1a does NOT populate it — that
 * is the job of the GuestInvitation flow shipped in bucket 1b. For
 * verification, seed rows are inserted directly in the DB.
 *
 * Hard rules (CLAUDE.md Portal Architecture, Rule 5):
 *  • Guest scope is CONTRACT-level, never project-level. A guest bound
 *    to contract X may NOT see sibling contract Y in the same project
 *    unless a separate row binds them to Y as well.
 *  • Cascading delete: removing the user OR the contract removes the
 *    binding automatically (no orphan rows can survive).
 *  • granted_by is SET NULL on delete so revoking an admin user does
 *    not break audit trail rows pointing at historical grants.
 *  • #8c Part 4a — REVOCATION IS A SOFT STAMP, NEVER A DELETE.
 *    `revoked_at IS NULL` means LIVE; a non-null value means the host has
 *    withdrawn access. The row STAYS on disk because it is the historical
 *    record that the share once existed — DocumentProcessingService's
 *    proposed-vs-live document classification reads that history, so a hard
 *    delete would retroactively rewrite how an already-uploaded document is
 *    treated. Every AUTHORIZATION read in ContractAccessService therefore
 *    filters `revoked_at IS NULL`; historical/provenance reads deliberately
 *    do not.
 */
@Entity('guest_contract_access')
@Unique('uq_guest_contract_access_user_contract', ['user_id', 'contract_id'])
export class GuestContractAccess {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_guest_contract_access_user_id')
  @Column({ type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index('idx_guest_contract_access_contract_id')
  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @CreateDateColumn({ type: 'timestamptz' })
  granted_at: Date;

  @Column({ type: 'uuid', nullable: true })
  granted_by: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'granted_by' })
  granter: User | null;

  /**
   * #8c Part 4a — NULL = LIVE binding. Non-null = host-revoked; the row
   * grants NOTHING from that moment on but is retained as history.
   * This column is the authorization discriminator (see class doc).
   */
  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  /**
   * Who performed the revocation. SET NULL on user delete — same contract as
   * `granted_by`: losing the actor must not break the historical row. NULL
   * therefore means either "never revoked" (pair with revoked_at) or
   * "revoked by a since-deleted user".
   */
  @Column({ type: 'uuid', nullable: true })
  revoked_by: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'revoked_by' })
  revoker: User | null;
}
