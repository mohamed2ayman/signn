import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { Contract } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S1: the Contract ROOT scoped repository.
 *
 * First concrete subclass of {@link ScopedContractRepository}. The Contract is
 * the ROOT of the contract-scoped entity tree (audit §1.1) — its parent
 * contract IS itself, so the auto/override resolution degenerates to
 * `contract.id`. This is exactly why the ROOT is the right place to establish
 * AND test the override-safety shape before any child entity is wired.
 *
 * The tenancy resolution here mirrors ContractAccessService.findInOrg
 * (contract-access.service.ts:105) — `contract → project → organization_id` —
 * so the data-layer gate is consistent with the wall. It does NOT call,
 * absorb, or modify `findInOrg`; the two are independent by design (CLAUDE.md
 * Option B: two separate checks = true defense-in-depth).
 */
@Injectable()
export class ContractScopedRepository extends ScopedContractRepository<Contract> {
  /** Matches the wall's 404 message — existence is never leaked. */
  protected readonly notFoundMessage = 'Contract not found';

  /** Alias used by {@link buildScopedQuery} and {@link buildScopedListQuery}. */
  protected readonly entityAlias = 'contract';

  constructor(
    @InjectRepository(Contract)
    contractRepository: Repository<Contract>,
  ) {
    super(contractRepository);
  }

  /**
   * `contract → project → organization_id`, mirroring findInOrg's resolution.
   *
   * `innerJoin` (not `innerJoinAndSelect`) — the project is joined purely to
   * apply the org filter and is NOT hydrated onto the returned entity, so the
   * result is a clean Contract row safe to mutate + save (no relation cascade).
   * Callers that need the wall's full presentation shape (clauses, creator,
   * approver, scrub) still go through `findInOrg`; this is a pure tenancy load.
   */
  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<Contract> {
    const qb = this.repo
      .createQueryBuilder('contract')
      .innerJoin('contract.project', 'project')
      .where('contract.id = :id', { id })
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('project.organization_id = :orgId', { orgId });

    if (contractIdOverride !== undefined) {
      // CHILD-RESOLUTION OVERRIDE. For the Contract ROOT, parent == self, so
      // the override pins `contract.id`. (A future CHILD subclass would pin
      // `child.contract_id = :contractIdOverride` instead.)
      //
      // SAFETY: the org filter above is ALWAYS `:orgId`. This clause can only
      // NARROW the result to a specific parent contract; it can never widen or
      // change the org. A caller in org A pinning org B's contractId still gets
      // zero rows — that contract's `project.organization_id` is org B, not
      // org A. The override never lets a caller claim or reach a different org.
      qb.andWhere('contract.id = :contractIdOverride', { contractIdOverride });
    }

    return qb;
  }

  /**
   * The org-scoped LIST base for the ROOT — same `contract → project`
   * resolution as {@link buildScopedQuery}, minus the by-id predicate. The
   * `project.organization_id = :orgId` gate is ALWAYS applied (structural).
   */
  protected buildScopedListQuery(orgId: string): SelectQueryBuilder<Contract> {
    return this.repo
      .createQueryBuilder('contract')
      .innerJoin('contract.project', 'project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('project.organization_id = :orgId', { orgId });
  }
}
