import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  AccountType,
  Contract,
  GuestContractAccess,
  UserRole,
} from '../../../database/entities';

/**
 * Phase 7.18 — the single authority for "can THIS caller access THIS contract?".
 *
 * Three caller shapes, three paths:
 *
 *   MANAGING (bucket 1a) → org-scope via contract → project → organization_id.
 *     (Mirrors the inlined logic from PR #42 — extracted here so every
 *      contract read goes through one helper.)
 *     UNIFIED MEMBERSHIP (Slice 1): after the own-org path denies, a real
 *     account holding a guest_contract_access binding for THIS contract is
 *     served the binding-scoped read (findForGuest) — org-first,
 *     binding-fallback. Own-org access is byte-identical to pre-unified;
 *     the binding is the SOLE cross-org grant; every denial stays 404.
 *
 *   GUEST USER ROW (bucket 1a) → contract-level binding via
 *     guest_contract_access. Guest scope is CONTRACT-level, never
 *     project-level (CLAUDE.md Portal Architecture Rule 5): a guest
 *     bound to contract X must be DENIED a sibling contract Y in the
 *     same project unless a separate binding row exists.
 *
 *   VIEWER CREDENTIAL (bucket 1b-i) → pre-password recipient holding a
 *     short-lived HMAC-signed credential. Read-only. Bound to ONE
 *     contract_id. The credential IS the auth — there is no user row
 *     and no org. The bound contract_id is the scope; anything else
 *     returns 404 (per the assertContractInOrg convention).
 *
 * Every denial throws NotFoundException (404) — never 403 — so existence
 * is not leaked. Matches the assertContractInOrg convention in
 * negotiation.service.ts.
 *
 * Externally observable behaviour for managing callers is byte-identical
 * to the pre-extraction contracts.service.findById: same joins, same
 * sort, same sensitive-field scrub on creator/approver. The guest-user
 * and viewer paths reuse the same load+scrub helper.
 */
export interface ManagingOrGuestCaller {
  type?: 'user';
  id: string;
  organization_id: string | null;
  role: UserRole;
  account_type: AccountType;
}

export interface ViewerCaller {
  type: 'viewer';
  viewer: {
    /** The single contract this credential grants read on. */
    contract_id: string;
    /** Source invitation (audit / 1b-ii linkage). */
    invitation_id: string;
  };
}

export type ContractAccessCaller = ManagingOrGuestCaller | ViewerCaller;

@Injectable()
export class ContractAccessService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepository: Repository<Contract>,
    @InjectRepository(GuestContractAccess)
    private readonly guestAccessRepository: Repository<GuestContractAccess>,
  ) {}

  /**
   * Public entry point. Branches on caller shape and returns the contract
   * (with relations + scrubbed user fields) or throws NotFoundException.
   */
  async findAccessibleContract(
    contractId: string,
    caller: ContractAccessCaller,
  ): Promise<Contract> {
    // 1b-i viewer credential: contract_id IS the scope.
    if (this.isViewer(caller)) {
      return this.findForViewer(contractId, caller.viewer.contract_id);
    }

    // 1a guest user row: contract-level binding via guest_contract_access.
    if (this.isGuestUser(caller)) {
      return this.findForGuest(contractId, caller.id);
    }

    // Managing (or FREE) user — ORG-FIRST, BINDING-FALLBACK (unified
    // membership). The own-org path runs FIRST and is byte-identical to the
    // pre-unified behaviour: same findInOrg query, same result, zero extra
    // reads in the common case (managing user, own-org contract). ONLY where
    // that path already denied (cross-org / no-org — previously a terminal
    // 404) do we consult guest_contract_access: a real account holding a
    // binding for THIS contract is served the SAME binding-scoped read a
    // guest gets (findForGuest — binding or 404). The BINDING is the sole
    // grant for cross-org access; account_type grants nothing. Both denial
    // paths throw the identical NotFoundException('Contract not found') —
    // no existence oracle, no 403.
    if (caller.organization_id) {
      try {
        return await this.findInOrg(contractId, caller.organization_id);
      } catch (err) {
        if (!(err instanceof NotFoundException)) {
          throw err;
        }
        // Own-org denial → fall through to the binding check.
      }
    }

    return this.findForGuest(contractId, caller.id);
  }

  /**
   * Unified membership — guest-SURFACE caller gate for the /guest/*
   * controllers. Replaces the old per-controller `account_type === GUEST`
   * persona assertion: the guest surface is authorized by GUEST-ness OR a
   * guest_contract_access binding for THIS contract, never by account_type
   * alone.
   *
   *   - GUEST account → pass. The service-level wall (findAccessibleContract
   *     → findForGuest) still enforces the binding downstream, exactly as
   *     before — this gate adds nothing for pure guests.
   *   - Any other account (MANAGING / FREE) → requires a binding row for the
   *     target contract. This keeps the guest surface BINDING-ONLY for real
   *     accounts: a host-org member with no binding must NOT reach guest
   *     machinery on their own org's contracts (watermarked downloads, the
   *     shared per-contract daily counters, guest-channel uploads).
   *
   * Denial is NotFoundException (404) — NEVER the old 403 — so a real
   * account without a binding cannot learn that the route recognises the
   * contract (uniform-404, no existence oracle).
   */
  async assertGuestSurfaceCaller(
    user: { id?: string | null; account_type?: AccountType | null } | null,
    contractId: string,
  ): Promise<void> {
    if (!user?.id) {
      throw new NotFoundException('Contract not found');
    }
    if (user.account_type === AccountType.GUEST) {
      return;
    }
    await this.assertGuestContractAccess(contractId, user.id);
  }

  /**
   * Managing-scope helper. Used directly by contracts.service mutation
   * paths (update, delete, etc.) where the caller has already been
   * authorized by RolesGuard / PermissionLevelGuard and we just need the
   * org-scoped contract read. Preserves PR #42's tenancy fix exactly.
   */
  async findInOrg(contractId: string, orgId: string): Promise<Contract> {
    const contract = await this.contractRepository
      .createQueryBuilder('contract')
      .leftJoinAndSelect('contract.creator', 'creator')
      .leftJoinAndSelect('contract.approver', 'approver')
      .leftJoinAndSelect('contract.project', 'project')
      // Option C — exclude guest-PROPOSED clauses from the host's canonical
      // read. The filter lives in the JOIN ON-clause (not WHERE) so this stays
      // a LEFT JOIN: a contract with only proposed clauses is still returned,
      // just with the proposed pile omitted. Proposed clauses surface ONLY via
      // the host-v1 "proposed clauses" read.
      .leftJoinAndSelect(
        'contract.contract_clauses',
        'contract_clauses',
        'contract_clauses.is_proposed = false',
      )
      .leftJoinAndSelect('contract_clauses.clause', 'clause')
      .where('contract.id = :id', { id: contractId })
      .andWhere('project.organization_id = :orgId', { orgId })
      .getOne();

    if (!contract) {
      throw new NotFoundException('Contract not found');
    }

    return this.scrubAndSort(contract);
  }

  /**
   * Lightweight guest BINDING assertion (1a). Throws NotFoundException (404 —
   * never 403, no existence leak) unless a `guest_contract_access` row binds
   * this user to this specific contract. Same binding check as `findForGuest`
   * but WITHOUT the heavy contract+clauses load — the right shape for a status
   * poll that fires every ~2s. The contract-level scope rule still holds: a
   * sibling contract in the same project is denied unless it carries its own
   * binding row.
   */
  async assertGuestContractAccess(
    contractId: string,
    userId: string,
  ): Promise<void> {
    if (!(await this.hasGuestBinding(contractId, userId))) {
      throw new NotFoundException('Contract not found');
    }
  }

  /**
   * Boolean binding probe (unified membership) — true when a
   * guest_contract_access row binds this user to this contract. For call
   * sites that need a non-throwing check (e.g. the doc-derived
   * proposed-vs-live decision in DocumentProcessingService).
   */
  async hasGuestBinding(contractId: string, userId: string): Promise<boolean> {
    const binding = await this.guestAccessRepository.findOne({
      where: { user_id: userId, contract_id: contractId },
    });
    return !!binding;
  }

  /**
   * Guest-USER-ROW-scope helper (1a). Allows access ONLY if a
   * guest_contract_access row binds this user to this specific contract.
   * Sibling contracts in the same project are denied unless they carry
   * their own binding row.
   */
  private async findForGuest(
    contractId: string,
    userId: string,
  ): Promise<Contract> {
    const binding = await this.guestAccessRepository.findOne({
      where: { user_id: userId, contract_id: contractId },
    });
    if (!binding) {
      throw new NotFoundException('Contract not found');
    }
    return this.fetchContractById(contractId);
  }

  /**
   * Viewer-credential-scope helper (1b-i). The credential is bound to
   * exactly ONE contract_id; requesting any other contract throws 404
   * regardless of project or org. The credential IS the auth — there is
   * no user row and no binding-table lookup.
   */
  private async findForViewer(
    requestedContractId: string,
    boundContractId: string,
  ): Promise<Contract> {
    if (requestedContractId !== boundContractId) {
      throw new NotFoundException('Contract not found');
    }
    return this.fetchContractById(requestedContractId);
  }

  /**
   * Load + scrub + sort. Used by the guest-user and viewer paths after
   * their respective scope check has already authorized access.
   * Managing-path still inlines the org-filtered query because the
   * andWhere clause is part of the tenancy check itself.
   */
  private async fetchContractById(contractId: string): Promise<Contract> {
    const contract = await this.contractRepository
      .createQueryBuilder('contract')
      .leftJoinAndSelect('contract.creator', 'creator')
      .leftJoinAndSelect('contract.approver', 'approver')
      .leftJoinAndSelect('contract.project', 'project')
      // Option C — the guest viewer (and viewer-credential) clause read MUST
      // also exclude proposed clauses: a guest never sees the proposed pile
      // replace the contract they're viewing. JOIN ON-clause keeps it a LEFT
      // JOIN (contract still returned if it has only proposed clauses).
      .leftJoinAndSelect(
        'contract.contract_clauses',
        'contract_clauses',
        'contract_clauses.is_proposed = false',
      )
      .leftJoinAndSelect('contract_clauses.clause', 'clause')
      .where('contract.id = :id', { id: contractId })
      .getOne();
    if (!contract) {
      // Binding/credential existed but contract was hard-deleted (or a
      // stale reference). Treat as 404 either way.
      throw new NotFoundException('Contract not found');
    }
    return this.scrubAndSort(contract);
  }

  private isViewer(caller: ContractAccessCaller): caller is ViewerCaller {
    return (caller as ViewerCaller).type === 'viewer';
  }

  private isGuestUser(caller: ContractAccessCaller): boolean {
    if (this.isViewer(caller)) return false;
    return (
      caller.account_type === AccountType.GUEST || caller.role === UserRole.GUEST
    );
  }

  /**
   * Sort clauses by order_index and strip sensitive fields from nested
   * User relations. Mirrors the in-house convention from
   * contracts.service.ts (pre-extraction) and users.service.ts:364.
   * Documented in PR #42.
   */
  private scrubAndSort(contract: Contract): Contract {
    if (contract.contract_clauses) {
      contract.contract_clauses.sort((a, b) => a.order_index - b.order_index);
    }
    if (contract.creator) {
      const {
        password_hash: _ph,
        mfa_secret: _ms,
        mfa_totp_secret: _mt,
        mfa_recovery_codes: _mr,
        invitation_token: _it,
        ...safe
      } = contract.creator as any;
      contract.creator = safe;
    }
    if (contract.approver) {
      const {
        password_hash: _ph,
        mfa_secret: _ms,
        mfa_totp_secret: _mt,
        mfa_recovery_codes: _mr,
        invitation_token: _it,
        ...safe
      } = contract.approver as any;
      contract.approver = safe;
    }
    return contract;
  }
}
