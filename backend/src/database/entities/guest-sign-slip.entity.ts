import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

import { User } from './user.entity';
import { Contract } from './contract.entity';
import { ContractVersion } from './contract-version.entity';

/**
 * Guest Signing v1 — the SLIP: a per-(guest, contract) capability record that
 * authorizes signing. Default-deny: a bare guest_contract_access binding NEVER
 * implies signing — the slip is created ONLY by explicit host action
 * (POST /contracts/:id/sign-slips, APPROVER) and consumed by the guest sign
 * door (POST /guest/contracts/:id/sign-slip/accept), which authorizes on
 * BINDING + SLIP together, atomically, uniform-404 on either miss.
 *
 * Lifecycle: PENDING → ACCEPTED → EXECUTED. Side exits: VOIDED (host cancels
 * pre-EXECUTED), DECLINED (RESERVED in v1 — the status value exists, no
 * endpoint or UI ever sets it).
 *
 * Hard rules:
 *  • envelope_id is RESERVED for v2 DocuSign — the column exists, v1 code
 *    NEVER populates it.
 *  • accepted_version_id / accepted_content_hash are captured from the
 *    PinResult at execution — for a fresh pin AND for the already-pinned
 *    no-op (host pinned while the slip was PENDING: the guest's acceptance
 *    is still recorded against the existing pin, no error).
 *  • One non-terminal slip per (contract, grantee) — enforced by the partial
 *    unique index uq_guest_sign_slips_active (status IN PENDING|ACCEPTED).
 *  • contract_id / grantee_user_id CASCADE on delete (owned capability rows
 *    die with either end); granted_by / voided_by SET NULL so revoking a host
 *    admin never breaks the historical trail (guest_contract_access
 *    precedent); accepted_version_id SET NULL (the pin's own FK on contracts
 *    is RESTRICT — version rows are not deletable while pinned anyway).
 */
export enum GuestSignSlipStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  EXECUTED = 'EXECUTED',
  /** RESERVED — no v1 endpoint or UI ever sets this. */
  DECLINED = 'DECLINED',
  VOIDED = 'VOIDED',
}

@Entity('guest_sign_slips')
export class GuestSignSlip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_guest_sign_slips_contract_id')
  @Column({ type: 'uuid' })
  contract_id: string;

  @ManyToOne(() => Contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contract_id' })
  contract: Contract;

  @Index('idx_guest_sign_slips_grantee_user_id')
  @Column({ type: 'uuid' })
  grantee_user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grantee_user_id' })
  grantee: User;

  @Column({ type: 'uuid', nullable: true })
  granted_by: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'granted_by' })
  granter: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  granted_at: Date;

  @Column({ type: 'varchar', length: 20, default: GuestSignSlipStatus.PENDING })
  status: GuestSignSlipStatus;

  @Column({ type: 'timestamptz', nullable: true })
  accepted_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  accepted_version_id: string | null;

  @ManyToOne(() => ContractVersion, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'accepted_version_id' })
  accepted_version: ContractVersion | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  accepted_content_hash: string | null;

  /** RESERVED for v2 DocuSign — NEVER populated in v1. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  envelope_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  voided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voided_by: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'voided_by' })
  voider: User | null;
}
