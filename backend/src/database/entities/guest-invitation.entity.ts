import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { Contract } from './contract.entity';
import { User } from './user.entity';

/**
 * Phase 7.18 bucket 1b-i — Guest Portal invitation.
 *
 * Purpose-built and DISTINCT from:
 *   • users.invitation_token        — admin org-level user invite
 *   • project_parties.invitation_token — project-party invite
 *   • ContractShare                 — internal cross-tenant sharing
 *
 * Lifecycle:
 *
 *   PENDING ──exchange──▶ ACCEPTED        (1b-i: viewer credential issued
 *                                          on first successful exchange)
 *       │  ──revoke──▶ REVOKED
 *       │  ──expires_at lapses──▶ EXPIRED (status not flipped on the row;
 *                                          expiry computed at verify time)
 *
 * Token wire format (HMAC, signed in InvitationTokenService):
 *   `<base64url({ invitation_id, expires_at })>.<base64url(hmac_sha256)>`
 *
 * The raw token is NEVER stored on this row. Verification is signature-
 * first (HMAC-before-DB), then the row is loaded by id from the payload
 * to enforce revoke / status / expiry. This mirrors the in-house pattern
 * established by ObligationTokenService and PortfolioExportTokenService.
 *
 * Hard rules for this row (must be enforced by the service layer):
 *  • The creator must have authority to access the bound contract
 *    (ContractAccessService.findInOrg) — the create path goes through
 *    the existing authority.
 *  • Status transitions are one-way: PENDING → ACCEPTED, PENDING → REVOKED.
 *    REVOKED and ACCEPTED are terminal w.r.t. exchange (a revoked or
 *    accepted invitation must NOT mint new viewer credentials).
 *    NOTE: ACCEPTED is reused on subsequent successful exchanges within
 *    TTL until 1b-ii promotes it to a durable identity; the gating
 *    check is revoke + expiry, not status.
 *  • Expiry is ops-configurable (GUEST_INVITE_TTL_DAYS, default 30).
 */
export enum GuestInvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

@Entity('guest_invitations')
export class GuestInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_guest_invitations_contract_id')
  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  /** Email of the invited recipient. Stored verbatim (case-preserving). */
  @Column({ type: 'varchar', length: 255 })
  invited_email: string;

  /**
   * UI language to render for the recipient on landing. ISO 639-1 (en/ar/fr).
   * Defaults to 'en'; the creator may override at invite-creation time.
   */
  @Column({ type: 'varchar', length: 10, default: 'en' })
  invited_language: string;

  @Column({
    type: 'enum',
    enum: GuestInvitationStatus,
    default: GuestInvitationStatus.PENDING,
  })
  status: GuestInvitationStatus;

  /** When this invitation stops minting viewer credentials. */
  @Column({ type: 'timestamptz' })
  expires_at: Date;

  /** Stamped when an authenticated creator revokes the invitation. */
  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  /** Stamped on the first successful exchange. */
  @Column({ type: 'timestamptz', nullable: true })
  accepted_at: Date | null;

  /**
   * The inviting managing user. SET NULL on user delete so the audit
   * trail (status / accepted_at / expires_at) survives even after the
   * inviter is removed — same pattern as guest_contract_access.granted_by.
   */
  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
