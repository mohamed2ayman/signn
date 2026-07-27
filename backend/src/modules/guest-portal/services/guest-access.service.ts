import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  ContractAccessService,
  GuestBindingRevocation,
} from '../../contracts/services/contract-access.service';

/**
 * Guest Portal #8c Part 4a — HOST-side control over a shared contract's guest
 * bindings.
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

  constructor(private readonly contractAccess: ContractAccessService) {}

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
    }

    return result;
  }
}
