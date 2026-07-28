import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';

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
 * ─── #8c Part 4a — REVOCATION (standing invariant) ────────────────────────
 * A binding is revoked by a SOFT stamp (`revoked_at`), never a delete. This
 * file owns EVERY `guest_contract_access` statement in the backend, and the
 * rule inside it is:
 *
 *   • AUTHORIZATION reads filter `revoked_at IS NULL` — hasGuestBinding,
 *     findForGuest, listGuestBindings, and the locking
 *     assertGuestBindingLiveForUpdate. A revoked binding grants NOTHING and
 *     produces the SAME uniform 404 as never having been bound (no oracle:
 *     "revoked" and "never shared" are indistinguishable to the caller).
 *     Only the last of those takes a row lock; it is the TOCTOU guard run
 *     inside the pin's transaction (see its own doc).
 *   • HISTORICAL reads deliberately do NOT filter it, because the row is the
 *     durable record that the share once existed. There are exactly two:
 *       (1) the idempotency probe inside revokeGuestBinding below;
 *       (2) GuestInvitationService.establishIdentity's binding-existence
 *           probe (guest-invitation.service.ts). That one MUST stay
 *           revocation-INCLUSIVE: `uq_guest_contract_access_user_contract`
 *           is a PLAIN unique constraint, so if that probe were filtered a
 *           revoked user re-clicking their invitation link would miss the
 *           existing row, attempt an INSERT, and hit a duplicate-key 500.
 *           Leaving it inclusive is ALSO the correct authorization outcome:
 *           the probe finds the revoked row, skips re-granting, and the
 *           binding stays revoked — revoke wins over a re-establish.
 *
 * Adding a new binding read? It is an authorization read unless you can
 * state why it is not — filter `revoked_at IS NULL`.
 *
 * NOT covered by revocation: the VIEWER-CREDENTIAL path (1b-i) never reads
 * this table — the HMAC credential IS the auth — so revoking a binding does
 * not invalidate a live viewer credential (it expires on its own short TTL).
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

/**
 * Feature #8a — one row of the caller's own guest-binding list
 * (GET /guest/my-contracts). A MINIMAL SAFE PROJECTION, deliberately tighter
 * than the single-contract detail read: no org/project/granted_by/binding
 * UUIDs, no clauses, no risk/compliance, no comments, no reservation ids.
 *
 * shared_by_org / shared_by_user are NOT pre-composed server-side — the
 * presentation decision belongs to the consumer (#8b). Both nullable; an
 * empty/whitespace label is normalized to null, and a UUID is never emitted.
 * NOTE: the data cannot distinguish a real company org from an individual's
 * placeholder-looking org name (Portal Rule 8's workspace_mode is unbuilt) —
 * we surface what exists and let the UI compose.
 */
export interface GuestBindingListRow {
  contract_id: string;
  contract_name: string;
  contract_type: string;
  status: string;
  signature_status: string | null;
  party_first_name: string | null;
  party_second_name: string | null;
  project_name: string | null;
  shared_by_org: string | null;
  shared_by_user: string | null;
  granted_at: Date;
}

/** #8c Part 4a — result of a host revoking a guest's binding. */
export interface GuestBindingRevocation {
  contract_id: string;
  user_id: string;
  revoked_at: Date;
  revoked_by: string | null;
  /** true when this call was a no-op because the binding was already revoked. */
  already_revoked: boolean;
}

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
      // #8c Part 4a — LIVE bindings only. A host-revoked row grants nothing.
      where: {
        user_id: userId,
        contract_id: contractId,
        revoked_at: IsNull(),
      },
    });
    return !!binding;
  }

  /**
   * #8c Part 4a (TOCTOU, Option A) — LOCKING liveness assertion on a binding,
   * executed on a CALLER-SUPPLIED EntityManager.
   *
   * This is the one binding read that takes a row lock. It exists for exactly
   * one caller: the guest-sign door's `precondition` closure, which the
   * ContractPinningService invokes INSIDE the pin's own transaction. Running
   * it there is what makes the check and the pin write atomic — see the hook's
   * doc on `pinExecutedContract`.
   *
   * `FOR UPDATE` (not a plain read) is load-bearing. Under READ COMMITTED a
   * plain SELECT sees only revocations that have already COMMITTED; an
   * in-flight uncommitted revoke would be invisible and the pin would proceed.
   * `FOR UPDATE` blocks on the revoking transaction instead, and when that
   * transaction commits Postgres re-evaluates this predicate against the NEW
   * row version (EvalPlanQual) — `revoked_at IS NULL` then fails, the row is
   * filtered out, and we throw. So a revoke that is committed OR in flight at
   * this instant always wins.
   *
   * LOCK ORDER: `guest_contract_access` is acquired LAST here, as everywhere
   * else (cf. the fixed order documented on RedlineService). The revoking
   * transaction locks only this same row, so the two contend on ONE row —
   * ordinary serialization, not a cycle. The pin locks the contract row, which
   * the revoke path never locks (its contract read is a plain MVCC SELECT).
   *
   * Denial is the same uniform 404 every other binding path throws.
   */
  async assertGuestBindingLiveForUpdate(
    contractId: string,
    userId: string,
    manager: EntityManager,
  ): Promise<void> {
    const binding = await manager
      .getRepository(GuestContractAccess)
      .createQueryBuilder('gca')
      .setLock('pessimistic_write')
      .where('gca.contract_id = :contractId', { contractId })
      .andWhere('gca.user_id = :userId', { userId })
      .andWhere('gca.revoked_at IS NULL')
      .getOne();

    if (!binding) {
      throw new NotFoundException('Contract not found');
    }
  }

  /**
   * Feature #8a — list the caller's OWN guest bindings (discovery for
   * "Shared with me"). SELF-SCOPING: the only filter is
   * `gca.user_id = :userId` (the JWT principal's id), so there is no
   * requested resource to deny — no bindings is simply `[]`, never a 404.
   * The uniform-404 invariant continues to govern the single-contract
   * routes each row links into.
   *
   * The caller key is user.id and NOTHING else: no account_type gate (the
   * binding is the sole grant — a MANAGING JWT lists its bindings exactly
   * like a GUEST JWT, and a managing user's own-org contracts have no
   * binding rows, so the list is naturally external-only), and the
   * caller's organization_id is never read (standing invariant 3).
   *
   * EXPLICIT raw SELECT — never the entity. See GuestBindingListRow for
   * what is (and is deliberately NOT) exposed.
   */
  async listGuestBindings(userId: string): Promise<GuestBindingListRow[]> {
    const rows = await this.guestAccessRepository
      .createQueryBuilder('gca')
      .innerJoin('gca.contract', 'contract')
      .leftJoin('contract.project', 'project')
      .leftJoin('project.organization', 'organization')
      .leftJoin('gca.granter', 'granter')
      .where('gca.user_id = :userId', { userId })
      // #8c Part 4a — LIVE bindings only: a revoked share disappears from
      // "Shared with me" (matching the 404 its contract now returns).
      .andWhere('gca.revoked_at IS NULL')
      .select([
        'contract.id AS contract_id',
        'contract.name AS contract_name',
        'contract.contract_type AS contract_type',
        'contract.status AS status',
        'contract.signature_status AS signature_status',
        'contract.party_first_name AS party_first_name',
        'contract.party_second_name AS party_second_name',
        'project.name AS project_name',
        'organization.name AS shared_by_org_raw',
        'granter.first_name AS granter_first_name',
        'granter.last_name AS granter_last_name',
        'gca.granted_at AS granted_at',
      ])
      .orderBy('gca.granted_at', 'DESC')
      .getRawMany();

    return rows.map((r): GuestBindingListRow => {
      const granterName = [r.granter_first_name, r.granter_last_name]
        .filter(Boolean)
        .join(' ');
      return {
        contract_id: r.contract_id,
        contract_name: r.contract_name,
        contract_type: r.contract_type,
        status: r.status,
        signature_status: r.signature_status ?? null,
        party_first_name: r.party_first_name ?? null,
        party_second_name: r.party_second_name ?? null,
        project_name: r.project_name ?? null,
        shared_by_org: this.labelOrNull(r.shared_by_org_raw),
        shared_by_user: this.labelOrNull(granterName),
        granted_at: r.granted_at,
      };
    });
  }

  /**
   * #8c Part 4a — SOFT-revoke a guest binding (the host withdrawing a share).
   *
   * PURE DATA OPERATION — it performs NO authorization. The caller MUST have
   * already proven host authority over `contractId` (findInOrg). It lives on
   * this service for one reason: every `guest_contract_access` statement in
   * the backend stays in ONE file, which is what makes the "all binding reads
   * are revocation-filtered" property auditable by reading a single file.
   *
   * Race-safe + idempotent via the codebase's hot-row idiom (ARCHITECTURE
   * RULE 9 Invariant 2): a single atomic conditional UPDATE whose
   * affected-row count IS the gate. Two concurrent revokes → exactly one
   * flips the row; the loser falls through to the read and returns the
   * already-revoked row, so the FIRST revoker's identity and timestamp are
   * never overwritten.
   *
   * Never deletes. See the entity doc for why the row must survive.
   */
  async revokeGuestBinding(
    contractId: string,
    granteeUserId: string,
    revokedByUserId: string,
  ): Promise<GuestBindingRevocation> {
    const result = await this.guestAccessRepository
      .createQueryBuilder()
      .update(GuestContractAccess)
      .set({ revoked_at: new Date(), revoked_by: revokedByUserId })
      .where('contract_id = :contractId', { contractId })
      .andWhere('user_id = :granteeUserId', { granteeUserId })
      // The gate: only a LIVE row transitions. An already-revoked row is
      // untouched, so re-revoking cannot rewrite the original actor/time.
      .andWhere('revoked_at IS NULL')
      .returning(['revoked_at', 'revoked_by'])
      .execute();

    if (result.affected === 1) {
      const row = result.raw?.[0] ?? {};
      return {
        contract_id: contractId,
        user_id: granteeUserId,
        revoked_at: row.revoked_at ?? new Date(),
        revoked_by: row.revoked_by ?? revokedByUserId,
        already_revoked: false,
      };
    }

    // affected === 0 → either the binding never existed, or it is already
    // revoked. Distinguish with a REVOCATION-INCLUSIVE read (this is the
    // idempotency probe, not an authorization read).
    const existing = await this.guestAccessRepository.findOne({
      where: { user_id: granteeUserId, contract_id: contractId },
    });
    if (!existing) {
      throw new NotFoundException('Guest access not found');
    }
    return {
      contract_id: contractId,
      user_id: granteeUserId,
      revoked_at: existing.revoked_at as Date,
      revoked_by: existing.revoked_by,
      already_revoked: true,
    };
  }

  /** Empty/whitespace labels become null — never emit a blank-looking label. */
  private labelOrNull(value: string | null | undefined): string | null {
    const trimmed = (value ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
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
      // #8c Part 4a — LIVE bindings only. Deliberately duplicated rather than
      // delegated to hasGuestBinding (that would change this method's query
      // count/shape); the two predicates MUST stay identical.
      where: {
        user_id: userId,
        contract_id: contractId,
        revoked_at: IsNull(),
      },
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

  /**
   * PUBLIC (7.19 Slice 1): also consumed by RedlineService's guest
   * write-exclusion gate — redline WRITES (propose/counter) are closed to
   * guest accounts until the #8c-hardened guest surface exists, and that
   * gate must key on the SAME identity predicate this dispatcher uses (one
   * definition, no drift), throwing the same uniform 404.
   */
  isGuestUser(caller: ContractAccessCaller): boolean {
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
