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

    // Managing user — org-scoped via contract → project → organization_id.
    if (!caller.organization_id) {
      // Managing caller without an org cannot own contracts.
      // Return 404 (not 403) to avoid leaking the contract's existence.
      throw new NotFoundException('Contract not found');
    }

    return this.findInOrg(contractId, caller.organization_id);
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
    const binding = await this.guestAccessRepository.findOne({
      where: { user_id: userId, contract_id: contractId },
    });
    if (!binding) {
      throw new NotFoundException('Contract not found');
    }
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
