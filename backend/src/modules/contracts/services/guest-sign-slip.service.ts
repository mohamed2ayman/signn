import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';

import {
  AuditLog,
  Contract,
  GuestSignSlip,
  GuestSignSlipStatus,
  SignatureStatus,
} from '../../../database/entities';
import { ContractAccessService } from './contract-access.service';
import {
  ContractPinningService,
  MARK_SIGNED_ALLOWED_STATUSES,
  PinResult,
} from './contract-pinning.service';

/** Host-facing slip projection (management surface — includes the grantee). */
export interface HostSignSlipView {
  id: string;
  contract_id: string;
  grantee_user_id: string;
  grantee_email: string | null;
  grantee_name: string | null;
  status: GuestSignSlipStatus;
  granted_at: Date;
  accepted_at: Date | null;
  accepted_version_id: string | null;
  accepted_content_hash: string | null;
  voided_at: Date | null;
}

/**
 * Guest-facing slip projection — MINIMAL. No granter identity, no version
 * UUID (internal pointer; the host list carries it), no envelope_id
 * (reserved-null). The content hash IS exposed on execution: it is the
 * signer's own integrity receipt for what they executed.
 */
export interface GuestSignSlipView {
  slip_id: string;
  status: GuestSignSlipStatus;
  granted_at: Date;
  accepted_at: Date | null;
  accepted_content_hash: string | null;
}

export interface GuestAcceptResult extends GuestSignSlipView {
  executed: boolean;
  /** True when the contract was already pinned before this acceptance
   *  (host-pins-while-slip-PENDING: acceptance recorded, pin no-op). */
  already_pinned: boolean;
}

/** The uniform guest-door denial — byte-identical for no-binding AND
 *  binding-but-no-slip (and for voided/declined slips). Matches every other
 *  guest-surface denial ('Contract not found', 404). */
const uniformDenial = () => new NotFoundException('Contract not found');

/**
 * Guest Signing v1 — the SLIP service.
 *
 * Capability model: a slip is a per-(guest, contract) record authorizing
 * signing. DEFAULT-DENY — a bare guest_contract_access binding NEVER implies
 * signing. Slips are created ONLY by explicit host action (APPROVER,
 * findInOrg-walled) and consumed by the guest door, which authorizes on
 * BINDING + SLIP together:
 *
 *   ── THE R11 ATOMIC GATE (standing invariants 1–5) ──
 *   Both probes (binding, slip) run UNCONDITIONALLY, then ONE combined
 *   check throws the uniform 404. There is no early-return on a missing
 *   binding that would skip the slip probe — so no-binding and
 *   binding-but-no-slip are indistinguishable in status, body, AND
 *   timing-class. The resolution never reads organization_id, never
 *   branches on account_type, never touches APPROVER machinery.
 *
 * "Signing" v1 = version-lock: acceptance funnels through the EXISTING
 * pinExecutedContract (door 'GUEST_SIGN') — no new pin logic. Already-pinned
 * (host pinned while the slip was PENDING) is NOT an error: the guest's
 * acceptance is recorded against the existing pin (idempotent pin no-op).
 */
@Injectable()
export class GuestSignSlipService {
  private readonly logger = new Logger(GuestSignSlipService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly contractAccess: ContractAccessService,
    private readonly pinning: ContractPinningService,
    @InjectRepository(GuestSignSlip)
    private readonly slipRepo: Repository<GuestSignSlip>, // lint-exempt: slip capability rows are walled at every entry point (host: findInOrg; guest: the binding+slip atomic gate) before any read/write below
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>, // lint-exempt: wall-protected — read ONLY after the binding+slip gate has authorized the caller (guest door), mirroring pinExecutedContract's caller-owns-the-gate contract
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  // ─── HOST SIDE (findInOrg-walled; permission gate on the controller) ──────

  /**
   * Issue a PENDING slip — the explicit host action that authorizes signing.
   * Preconditions:
   *   • contract in the caller's org (findInOrg → cross-tenant 404),
   *   • contract NOT already executed/pinned (400),
   *   • contract status in MARK_SIGNED_ALLOWED_STATUSES (400 — the SAME
   *     exported set the manual mark-signed door enforces),
   *   • the grantee ALREADY holds a guest_contract_access binding (400 — a
   *     slip without a binding would be a dead capability: the guest door
   *     requires both, so issuance validates rather than issuing junk),
   *   • no existing non-terminal slip for (contract, grantee) (409; the
   *     partial unique index is the race backstop).
   */
  async issueSlip(
    contractId: string,
    granteeUserId: string,
    host: { userId: string; orgId: string },
  ): Promise<HostSignSlipView> {
    const contract = await this.contractAccess.findInOrg(contractId, host.orgId);

    if (
      contract.pinned_version_id ||
      contract.signature_status === SignatureStatus.FULLY_EXECUTED
    ) {
      throw new BadRequestException(
        'Contract is already executed — no further signing slips can be issued.',
      );
    }
    if (!MARK_SIGNED_ALLOWED_STATUSES.has(contract.status)) {
      throw new BadRequestException(
        `Contract cannot be offered for signing from status ${contract.status}. ` +
          `Allowed: ${[...MARK_SIGNED_ALLOWED_STATUSES].join(', ')}.`,
      );
    }

    // REFINEMENT (locked): validate the binding BEFORE issuing — never mint
    // an unreachable slip. Clean host-side 400 (the host already knows the
    // contract exists; nothing is leaked).
    if (!(await this.contractAccess.hasGuestBinding(contractId, granteeUserId))) {
      throw new BadRequestException(
        'The selected user does not hold guest access to this contract. ' +
          'Share the contract with them first, then issue the signing slip.',
      );
    }

    const existing = await this.slipRepo.findOne({
      where: {
        contract_id: contractId,
        grantee_user_id: granteeUserId,
        status: In([GuestSignSlipStatus.PENDING, GuestSignSlipStatus.ACCEPTED]),
      },
    });
    if (existing) {
      throw new ConflictException(
        'An active signing slip already exists for this user on this contract.',
      );
    }

    try {
      const slip = await this.slipRepo.save(
        this.slipRepo.create({
          contract_id: contractId,
          grantee_user_id: granteeUserId,
          granted_by: host.userId,
          status: GuestSignSlipStatus.PENDING,
        }),
      );
      return this.toHostView(slip);
    } catch (err: any) {
      // Partial-unique-index race backstop (two concurrent issues).
      if (err?.code === '23505') {
        throw new ConflictException(
          'An active signing slip already exists for this user on this contract.',
        );
      }
      throw err;
    }
  }

  /** Host list — all slips on the contract, newest first, grantee resolved. */
  async listSlips(
    contractId: string,
    orgId: string,
  ): Promise<HostSignSlipView[]> {
    await this.contractAccess.findInOrg(contractId, orgId);
    const slips = await this.slipRepo.find({
      where: { contract_id: contractId },
      relations: ['grantee'],
      order: { granted_at: 'DESC' },
    });
    return slips.map((s) => this.toHostView(s));
  }

  /**
   * Host VOID — cancel a slip before it is executed. Status-guarded
   * conditional UPDATE (PENDING|ACCEPTED → VOIDED only, at-most-once).
   * Already-EXECUTED → 400. Already-VOIDED → idempotent no-op.
   */
  async voidSlip(
    contractId: string,
    slipId: string,
    host: { userId: string; orgId: string },
  ): Promise<HostSignSlipView> {
    await this.contractAccess.findInOrg(contractId, host.orgId);

    const res = await this.slipRepo
      .createQueryBuilder()
      .update(GuestSignSlip)
      .set({
        status: GuestSignSlipStatus.VOIDED,
        voided_at: () => 'now()',
        voided_by: host.userId,
      })
      .where('id = :slipId AND contract_id = :contractId', {
        slipId,
        contractId,
      })
      .andWhere('status IN (:...voidable)', {
        voidable: [GuestSignSlipStatus.PENDING, GuestSignSlipStatus.ACCEPTED],
      })
      .execute();

    const slip = await this.slipRepo.findOne({
      where: { id: slipId, contract_id: contractId },
    });
    if (!slip) {
      throw new NotFoundException('Signing slip not found');
    }
    if (res.affected !== 1 && slip.status === GuestSignSlipStatus.EXECUTED) {
      throw new BadRequestException(
        'This signing slip has already been executed and can no longer be voided.',
      );
    }
    return this.toHostView(slip);
  }

  // ─── GUEST DOOR (binding + slip, atomic, uniform 404) ─────────────────────

  /**
   * THE R11 ATOMIC GATE. Both probes run unconditionally (Promise.all), then
   * one combined check. Uniform 404 on: no binding, no slip, voided slip,
   * declined slip — all byte-identical, same query count, same timing-class.
   *
   * NEVER reads organization_id. NEVER branches on account_type. NEVER
   * touches APPROVER/permission machinery. Any change to this method must
   * keep binding-check + slip-check together (standing invariant 5).
   */
  private async resolveSlipGate(
    contractId: string,
    granteeUserId: string,
  ): Promise<GuestSignSlip> {
    const [hasBinding, slips] = await Promise.all([
      this.contractAccess.hasGuestBinding(contractId, granteeUserId),
      this.slipRepo.find({
        where: {
          contract_id: contractId,
          grantee_user_id: granteeUserId,
          status: In([
            GuestSignSlipStatus.PENDING,
            GuestSignSlipStatus.ACCEPTED,
            GuestSignSlipStatus.EXECUTED,
          ]),
        },
        order: { granted_at: 'DESC' },
      }),
    ]);
    // At most one non-terminal slip exists (partial unique index); prefer it
    // over a historical EXECUTED row.
    const slip =
      slips.find((s) => s.status !== GuestSignSlipStatus.EXECUTED) ?? slips[0];
    if (!hasBinding || !slip) {
      throw uniformDenial();
    }
    return slip;
  }

  /** Guest slip-status read — the frontend's render gate. Uniform 404 on
   *  either miss (never `{active:false}` — no oracle). */
  async getSlipForGuest(
    contractId: string,
    granteeUserId: string,
  ): Promise<GuestSignSlipView> {
    const slip = await this.resolveSlipGate(contractId, granteeUserId);
    return this.toGuestView(slip);
  }

  /**
   * "Accept & Execute" — the guest sign door.
   *
   *   gate (binding+slip, uniform 404)
   *   → signable-status check (FRESH-PIN PATH ONLY — an already-pinned
   *     contract skips it: acceptance is recorded, pin is a no-op)
   *   → slip PENDING→ACCEPTED
   *   → pinExecutedContract(door 'GUEST_SIGN')  [the EXISTING shared pin op]
   *   → slip ACCEPTED→EXECUTED + capture accepted_version_id/content_hash
   *     from the PinResult (fresh pin AND already-pinned both carry them)
   *   → post-commit best-effort AuditLog 'guest_contract_signed'.
   *
   * Idempotent: a second click finds the EXECUTED slip and returns the
   * recorded acceptance (no error). A crash between pin and finalize leaves
   * the slip ACCEPTED — the next call resumes (pin no-op → finalize).
   *
   * The slip row is locked (pessimistic_write) across the pin so a
   * concurrent host VOID serializes against the execution: it either lands
   * before the lock (we see VOIDED → uniform 404, nothing pinned) or waits
   * and finds EXECUTED (→ its own 400).
   */
  async acceptAndExecute(
    contractId: string,
    granteeUserId: string,
  ): Promise<GuestAcceptResult> {
    const gateSlip = await this.resolveSlipGate(contractId, granteeUserId);

    // Idempotent replay — already executed: return the recorded acceptance.
    if (gateSlip.status === GuestSignSlipStatus.EXECUTED) {
      return { ...this.toGuestView(gateSlip), executed: true, already_pinned: true };
    }

    // Signable-status check — FRESH-PIN PATH ONLY (locked decision). The
    // contract read happens strictly AFTER the gate authorized the caller
    // (pinExecutedContract's caller-owns-the-gate contract).
    const contract = await this.contractRepo.findOne({ // lint-exempt: wall-protected (binding+slip atomic gate above authorized this caller for this contract)
      where: { id: contractId },
    });
    if (!contract) {
      throw uniformDenial();
    }
    if (
      !contract.pinned_version_id &&
      !MARK_SIGNED_ALLOWED_STATUSES.has(contract.status)
    ) {
      throw new BadRequestException(
        `Contract cannot be executed from status ${contract.status}.`,
      );
    }

    let transitioned = false;
    let pin: PinResult | null = null;

    const finalSlip = await this.dataSource.transaction(async (manager) => {
      const txSlipRepo = manager.getRepository(GuestSignSlip); // lint-exempt: wall-protected (binding+slip atomic gate above); txn-bound pessimistic-lock slip transition
      const locked = await txSlipRepo
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.id = :id', { id: gateSlip.id })
        .getOne();

      if (!locked) {
        throw uniformDenial();
      }
      if (locked.status === GuestSignSlipStatus.EXECUTED) {
        // A concurrent accept won the race — return its recorded result.
        return locked;
      }
      if (
        locked.status === GuestSignSlipStatus.VOIDED ||
        locked.status === GuestSignSlipStatus.DECLINED
      ) {
        // Voided between gate and lock — uniform denial, nothing pinned.
        throw uniformDenial();
      }

      const acceptedAt = locked.accepted_at ?? new Date();
      if (locked.status === GuestSignSlipStatus.PENDING) {
        await txSlipRepo.update(
          { id: locked.id },
          { status: GuestSignSlipStatus.ACCEPTED, accepted_at: acceptedAt },
        );
      }

      // The EXISTING pin operation — its own transaction (separate pooled
      // connection), idempotent under already-pinned. If it throws, OUR
      // transaction rolls back to ACCEPTED at worst and the next accept
      // call resumes cleanly.
      pin = await this.pinning.pinExecutedContract(contractId, {
        actorUserId: granteeUserId,
        door: 'GUEST_SIGN',
      });

      await txSlipRepo.update(
        { id: locked.id },
        {
          status: GuestSignSlipStatus.EXECUTED,
          accepted_at: acceptedAt,
          accepted_version_id: pin.pinned_version_id,
          accepted_content_hash: pin.content_hash,
        },
      );
      transitioned = true;
      return txSlipRepo.findOneOrFail({ where: { id: locked.id } });
    });

    // Post-commit, best-effort audit — the pinning-service pattern: an audit
    // hiccup never rolls back a legally-significant execution record. In the
    // already-pinned case the pin op emits NO audit (no-op branch), so this
    // row is the ONLY record of the guest's acceptance — exactly the intent.
    if (transitioned && pin) {
      const pinResult: PinResult = pin;
      try {
        await this.auditLogRepo.insert({
          user_id: granteeUserId,
          action: 'guest_contract_signed',
          entity_type: 'contract',
          entity_id: contractId,
          new_values: {
            door: 'GUEST_SIGN',
            slip_id: finalSlip.id,
            grantee_user_id: granteeUserId,
            accepted_version_id: pinResult.pinned_version_id,
            accepted_content_hash: pinResult.content_hash,
            already_pinned: pinResult.already_pinned,
          },
        });
      } catch (err) {
        this.logger.warn(`Failed to record guest_contract_signed audit: ${err}`);
      }
      this.logger.log(
        `Guest ${granteeUserId} accepted & executed contract ${contractId} ` +
          `via slip ${finalSlip.id} (already_pinned=${pinResult.already_pinned})`,
      );
    }

    return {
      ...this.toGuestView(finalSlip),
      executed: finalSlip.status === GuestSignSlipStatus.EXECUTED,
      already_pinned: pin ? (pin as PinResult).already_pinned : true,
    };
  }

  // ─── Projections ──────────────────────────────────────────────────────────

  private toHostView(slip: GuestSignSlip): HostSignSlipView {
    const granteeName = slip.grantee
      ? [slip.grantee.first_name, slip.grantee.last_name]
          .filter(Boolean)
          .join(' ')
          .trim() || null
      : null;
    return {
      id: slip.id,
      contract_id: slip.contract_id,
      grantee_user_id: slip.grantee_user_id,
      grantee_email: slip.grantee?.email ?? null,
      grantee_name: granteeName,
      status: slip.status,
      granted_at: slip.granted_at,
      accepted_at: slip.accepted_at,
      accepted_version_id: slip.accepted_version_id,
      accepted_content_hash: slip.accepted_content_hash,
      voided_at: slip.voided_at,
    };
  }

  private toGuestView(slip: GuestSignSlip): GuestSignSlipView {
    return {
      slip_id: slip.id,
      status: slip.status,
      granted_at: slip.granted_at,
      accepted_at: slip.accepted_at,
      accepted_content_hash:
        slip.status === GuestSignSlipStatus.EXECUTED
          ? slip.accepted_content_hash
          : null,
    };
  }
}
