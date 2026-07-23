import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Contract, NegotiationStatus } from '../../../database/entities';
import {
  ContractAccessService,
  ManagingOrGuestCaller,
} from './contract-access.service';

/** Coded 409 envelopes — the CONTRACT_PINNED / STALE_REDLINE precedent. */
export const INVALID_NEGOTIATION_TRANSITION_ERROR =
  'INVALID_NEGOTIATION_TRANSITION';
export const OPEN_REDLINES_EXIST_ERROR = 'OPEN_REDLINES_EXIST';

/**
 * The FULL transition map — the single source of truth for the negotiation
 * lane. Mirrors validateStatusTransition's Record<from, to[]> shape (the
 * lifecycle guard is NOT modified — separate lane, separate guard).
 *
 *   DRAFT         → SHARED
 *   SHARED        → UNDER_REVIEW
 *   UNDER_REVIEW  → AGREED (precondition: ZERO open redlines) | SHARED (step back)
 *   AGREED        → UNDER_REVIEW (bounce-back on a new redline) | READY_TO_SIGN
 *   READY_TO_SIGN → (TERMINAL — nothing; the slip→pin handoff past it is #2's)
 */
const NEGOTIATION_TRANSITIONS: Record<NegotiationStatus, NegotiationStatus[]> = {
  [NegotiationStatus.DRAFT]: [NegotiationStatus.SHARED],
  [NegotiationStatus.SHARED]: [NegotiationStatus.UNDER_REVIEW],
  [NegotiationStatus.UNDER_REVIEW]: [
    NegotiationStatus.AGREED,
    NegotiationStatus.SHARED,
  ],
  [NegotiationStatus.AGREED]: [
    NegotiationStatus.UNDER_REVIEW,
    NegotiationStatus.READY_TO_SIGN,
  ],
  [NegotiationStatus.READY_TO_SIGN]: [],
};

/**
 * 7.19 Slice 2 — the negotiation status machine.
 *
 * ALL writes to contracts.negotiation_status flow through applyTransition
 * (guarded map + AGREED precondition + conditional-UPDATE race gate) — no raw
 * negotiation_status update exists anywhere else. Auto-hooks (share, redline
 * propose) also route through it, so an illegal auto-move surfaces as a coded
 * 409 bug signal, never a silent write.
 *
 * Access shape (the Slice-1 pattern):
 *  - manual agree / readyToSign → findInOrg (HOST-ORG ONLY; a caller with no
 *    org, incl. any guest account, gets the same uniform 404 — the caller's
 *    organization_id is read ONLY on this own-org decision path, never a
 *    binding path).
 *  - getStatus → findAccessibleContract (either bound party; uniform 404).
 *
 * Every DB touch takes an optional EntityManager so an auto-hook can ride the
 * TRIGGERING action's transaction (redline propose) — a rollback there reverts
 * the status move too (no orphan UNDER_REVIEW without its redline).
 */
@Injectable()
export class NegotiationStatusService {
  private readonly logger = new Logger(NegotiationStatusService.name);

  constructor(
    @InjectRepository(Contract) // lint-exempt: wall-protected — every entry point runs findInOrg / findAccessibleContract first; used only for the manager handle + guarded conditional UPDATE on the walled id
    private readonly contractRepo: Repository<Contract>,
    private readonly contractAccess: ContractAccessService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────
  // READ — either bound party
  // ────────────────────────────────────────────────────────────────────────
  async getStatus(
    contractId: string,
    caller: ManagingOrGuestCaller,
  ): Promise<{ negotiation_status: NegotiationStatus }> {
    const contract = await this.contractAccess.findAccessibleContract(
      contractId,
      caller,
    );
    return { negotiation_status: contract.negotiation_status };
  }

  // ────────────────────────────────────────────────────────────────────────
  // MANUAL HOST ACTIONS — findInOrg (host-org only, uniform 404)
  // ────────────────────────────────────────────────────────────────────────
  async agree(
    contractId: string,
    caller: ManagingOrGuestCaller,
  ): Promise<{ negotiation_status: NegotiationStatus }> {
    const contract = await this.hostContract(contractId, caller);
    const next = await this.applyTransition(
      contractId,
      contract.negotiation_status,
      NegotiationStatus.AGREED,
    );
    return { negotiation_status: next };
  }

  async readyToSign(
    contractId: string,
    caller: ManagingOrGuestCaller,
  ): Promise<{ negotiation_status: NegotiationStatus }> {
    const contract = await this.hostContract(contractId, caller);
    const next = await this.applyTransition(
      contractId,
      contract.negotiation_status,
      NegotiationStatus.READY_TO_SIGN,
    );
    return { negotiation_status: next };
  }

  // ────────────────────────────────────────────────────────────────────────
  // AUTO-HOOKS — idempotent; called ONLY from already-walled actions
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Share hook (ContractsService.updateStatus → SENT_TO_CONTRACTOR): first
   * share starts the lane — DRAFT → SHARED. Any later state is left alone
   * (a re-share must never pull the lane backward).
   */
  async autoOnShare(
    contractId: string,
    em?: EntityManager,
  ): Promise<NegotiationStatus> {
    const current = await this.currentStatus(contractId, em);
    if (current !== NegotiationStatus.DRAFT) {
      return current; // idempotent no-op — never backward
    }
    return this.applyTransition(
      contractId,
      current,
      NegotiationStatus.SHARED,
      em,
    );
  }

  /**
   * Redline-propose hook (RedlineService.propose, INSIDE its transaction):
   * SHARED → UNDER_REVIEW (negotiation started) and AGREED → UNDER_REVIEW
   * (bounce-back — a new redline reopens review). Already UNDER_REVIEW →
   * no-op. DRAFT stays DRAFT (a host drafting redlines pre-share does not
   * start the lane). READY_TO_SIGN is never pulled backward — a proposal
   * there is already pin/flow-gated upstream; the lane does not move.
   */
  async autoOnProposeOpened(
    contractId: string,
    em: EntityManager,
  ): Promise<NegotiationStatus> {
    const current = await this.currentStatus(contractId, em);
    if (
      current !== NegotiationStatus.SHARED &&
      current !== NegotiationStatus.AGREED
    ) {
      return current; // idempotent no-op
    }
    return this.applyTransition(
      contractId,
      current,
      NegotiationStatus.UNDER_REVIEW,
      em,
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // THE guard — every negotiation_status write in the codebase lands here
  // ────────────────────────────────────────────────────────────────────────
  private async applyTransition(
    contractId: string,
    from: NegotiationStatus,
    to: NegotiationStatus,
    em?: EntityManager,
  ): Promise<NegotiationStatus> {
    const allowed = NEGOTIATION_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw this.invalidTransition(from, to);
    }

    // AGREED precondition — enforced INSIDE the guard, not at the controller:
    // agreement means the negotiation table is clear; ANY open (PROPOSED)
    // redline blocks it. (Tiny check→update window is acceptable: a redline
    // proposed concurrently bounces AGREED → UNDER_REVIEW via the propose
    // hook anyway, so the lane self-corrects.)
    if (to === NegotiationStatus.AGREED) {
      const open = await this.openRedlineCount(contractId, em);
      if (open > 0) {
        throw new ConflictException({
          statusCode: 409,
          error: OPEN_REDLINES_EXIST_ERROR,
          message:
            `Cannot mark as agreed: ${open} open redline(s) still awaiting a ` +
            'decision. Resolve every proposed redline first.',
        });
      }
    }

    // Conditional UPDATE keyed on the from-status (the lesson #277 / #149
    // affected-rows idiom) — two racing transitions resolve to one winner;
    // the loser learns the real current state and 409s.
    // NOTE (lesson #148): a raw UPDATE via manager.query returns the TypeORM
    // 0.3 `[rows, rowCount]` TUPLE (unlike a SELECT, which returns bare
    // rows) — gate on the tuple's rowCount, never `.length` of the tuple.
    const manager = em ?? this.contractRepo.manager;
    const [returned] = (await manager.query(
      `UPDATE contracts
          SET negotiation_status = $1, updated_at = NOW()
        WHERE id = $2 AND negotiation_status = $3
        RETURNING negotiation_status`,
      [to, contractId, from],
    )) as [Array<{ negotiation_status: NegotiationStatus }>, number];
    if (returned.length !== 1) {
      const current = await this.currentStatus(contractId, em);
      throw this.invalidTransition(current, to);
    }

    this.logger.log(
      `negotiation.transition contract=${contractId} ${from} -> ${to}`,
    );
    return to;
  }

  // ────────────────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────────────────

  /** Host wall — own-org only (mirrors RedlineService.hostContract). */
  private async hostContract(
    contractId: string,
    caller: ManagingOrGuestCaller,
  ): Promise<Contract> {
    if (!caller.organization_id) {
      throw new NotFoundException('Contract not found');
    }
    return this.contractAccess.findInOrg(contractId, caller.organization_id);
  }

  /** Txn-aware current-status read (raw parameterized SQL — pin-guard style). */
  private async currentStatus(
    contractId: string,
    em?: EntityManager,
  ): Promise<NegotiationStatus> {
    const manager = em ?? this.contractRepo.manager;
    const rows: Array<{ negotiation_status: NegotiationStatus }> =
      await manager.query(
        `SELECT negotiation_status FROM contracts WHERE id = $1`,
        [contractId],
      );
    if (rows.length !== 1) {
      // Only reachable if the row vanished after the caller's wall.
      throw new NotFoundException('Contract not found');
    }
    return rows[0].negotiation_status;
  }

  /** Open redlines = PROPOSED rows on the contract (the AGREED blocker). */
  private async openRedlineCount(
    contractId: string,
    em?: EntityManager,
  ): Promise<number> {
    const manager = em ?? this.contractRepo.manager;
    const rows: Array<{ n: number }> = await manager.query(
      `SELECT count(*)::int AS n FROM clause_redlines
        WHERE contract_id = $1 AND status = 'PROPOSED'`,
      [contractId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  private invalidTransition(
    from: NegotiationStatus,
    to: NegotiationStatus,
  ): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: INVALID_NEGOTIATION_TRANSITION_ERROR,
      message: `Cannot transition negotiation status from ${from} to ${to}.`,
    });
  }
}
