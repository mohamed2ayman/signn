import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AccountType, User } from '../../../database/entities';
import {
  ContractAccessService,
  GuestBindingRevocation,
  HostGuestBindingRow,
} from '../../contracts/services/contract-access.service';
import { AuthService } from '../../auth/auth.service';

/**
 * Guest Portal #8c Part 4a/4b — HOST-side control over a shared contract's
 * guest bindings (4a: revoke; 4b: list "who has access").
 *
 * This is a HOST surface, NOT a guest surface. The distinction is the whole
 * security posture of the file:
 *
 *   • Guest surfaces (guest-upload / -download / -chat / -comments / -status /
 *     -import / -sign) authorize on the BINDING — `assertGuestSurfaceCaller`
 *     or `findAccessibleContract` — because the caller is the counterparty.
 *   • THIS service authorizes on the ORG WALL — `findInOrg` — because the
 *     caller is the host acting on their own contract. It must NOT be
 *     reachable through the binding: a bound counterparty must never be able
 *     to revoke anybody, including themselves or the other party.
 *
 * The wall is exactly the one `GuestInvitationService.revoke` uses for the
 * sibling operation (revoking an invitation), so both halves of "withdraw
 * this person's access" share one authorization model.
 *
 * NOTE (deliberate v1 scope): revoking a binding does NOT revoke the
 * invitation that created it. Those are separate resources with separate
 * endpoints — a host who wants to fully close the door uses both. Making one
 * cascade into the other is a product decision, not a security fix: the
 * binding stamp already stops access, and a re-established invitation cannot
 * resurrect a revoked binding (see the revocation-inclusive probe in
 * GuestInvitationService.establishIdentity).
 */
@Injectable()
export class GuestAccessService {
  private readonly logger = new Logger(GuestAccessService.name);

  constructor(
    private readonly contractAccess: ContractAccessService,
    private readonly authService: AuthService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Withdraw a counterparty's access to one contract.
   *
   * Ordering is load-bearing and mirrors `GuestInvitationService.revoke`:
   *   1. no-org actor → 404 before any lookup (a caller with no org can never
   *      resolve a contract; 404 not 403, no existence leak);
   *   2. ORG WALL — `findInOrg` proves the contract belongs to the actor's
   *      org. A cross-org contract id yields the uniform 404 HERE, so the
   *      revoke path can never touch another tenant's binding;
   *   3. only then the soft stamp, which is itself atomic + idempotent.
   */
  async revoke(
    contractId: string,
    granteeUserId: string,
    actor: { id: string; organization_id: string | null },
  ): Promise<GuestBindingRevocation> {
    if (!actor.organization_id) {
      throw new NotFoundException('Contract not found');
    }

    // ORG WALL — the ONLY authorization in this path. Throws the uniform 404
    // for a contract outside the actor's org.
    await this.contractAccess.findInOrg(contractId, actor.organization_id);

    const result = await this.contractAccess.revokeGuestBinding(
      contractId,
      granteeUserId,
      actor.id,
    );

    if (!result.already_revoked) {
      this.logger.log(
        `Guest access revoked: user ${granteeUserId} → contract ${contractId} ` +
          `by ${actor.id}`,
      );
      await this.tearDownGuestSessions(granteeUserId);
    }

    return result;
  }

  /**
   * #8c Part 4b — list one contract's guest bindings ("who has access to my
   * contract"). The read half of `revoke` above: each row carries the
   * `user_id` the revoke DTO takes, plus identity / provenance / revoked
   * state for the UI.
   *
   * Authorization is EXACTLY revoke's, steps 1–2 (no-org 404, then the
   * findInOrg org wall) — this is a HOST read via the org wall, NEVER the
   * guest-surface binding path. Returns BOTH live and revoked bindings
   * (revoked_at populated) — see listBindingsForContract's doc for why the
   * historical rows are the host's to see. A contract with no guests is
   * simply `[]` with 200 (the wall already resolved the contract, so there
   * is no denied resource to hide).
   */
  async listGuests(
    contractId: string,
    actor: { id: string; organization_id: string | null },
  ): Promise<HostGuestBindingRow[]> {
    if (!actor.organization_id) {
      throw new NotFoundException('Contract not found');
    }

    // ORG WALL — the ONLY authorization in this path. Throws the uniform 404
    // for a contract outside the actor's org.
    await this.contractAccess.findInOrg(contractId, actor.organization_id);

    return this.contractAccess.listBindingsForContract(contractId);
  }

  /**
   * #8c Part 4a (Checkpoint C) — second layer behind the read filter: end the
   * revoked party's live session instead of leaving an already-issued access
   * token technically valid until it expires.
   *
   * PURE GUESTS ONLY. The predicate is `account_type === GUEST`, the same
   * identity discriminator ContractAccessService.isGuestUser uses — a MANAGING
   * account acting as a guest keeps its own-organisation session, because that
   * session is not what the host granted and not theirs to revoke.
   *
   * Runs only on a real transition (never on an idempotent re-revoke, so
   * re-revoking cannot be used to repeatedly boot someone) and is BEST-EFFORT:
   * the binding stamp is already committed and is what actually stops access,
   * so a teardown failure must never turn a successful revoke into an error.
   * Same convention as the guest-import / ERP notify paths.
   */
  private async tearDownGuestSessions(granteeUserId: string): Promise<void> {
    try {
      const grantee = await this.userRepository.findOne({
        where: { id: granteeUserId },
        select: ['id', 'account_type'],
      });

      if (grantee?.account_type !== AccountType.GUEST) {
        // MANAGING-as-guest → read filter only. Deliberate, not an omission.
        return;
      }

      const revoked = await this.authService.revokeAllGuestSessions(
        granteeUserId,
      );
      this.logger.log(
        `Guest session teardown: ${revoked} session(s) revoked for ${granteeUserId}`,
      );
    } catch (err) {
      this.logger.warn(
        `Guest session teardown failed for ${granteeUserId} (binding IS revoked; ` +
          `access is already blocked by the read filter): ${(err as Error).message}`,
      );
    }
  }
}
