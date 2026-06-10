import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ContractApprover } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2a: ContractApprover scoped repository (CLEAN direct child).
 *
 * Resolves org via the canonical `approver → contract → project →
 * organization_id` chain (Ayman B spec Q1: canonical-only; no denormalized org
 * column on this entity). Override-safety inherited from the base unchanged.
 *
 * Walls stay independent and in front; this is the data-layer tenancy load.
 */
@Injectable()
export class ContractApproverScopedRepository extends ScopedContractRepository<ContractApprover> {
  protected readonly notFoundMessage = 'Contract approver not found';
  protected readonly entityAlias = 'approver';

  constructor(
    @InjectRepository(ContractApprover)
    repo: Repository<ContractApprover>,
  ) {
    super(repo);
  }

  /** `approver → contract → project`, both inner joins, org filter mandatory. */
  private joinedToOrg(orgId: string): SelectQueryBuilder<ContractApprover> {
    return this.repo
      .createQueryBuilder('approver')
      .innerJoin('approver.contract', 'contract')
      .innerJoin('contract.project', 'project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<ContractApprover> {
    const qb = this.joinedToOrg(orgId).andWhere('approver.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // CHILD override pins the PARENT contract (`approver.contract_id`).
      qb.andWhere('approver.contract_id = :contractIdOverride', { contractIdOverride });
    }

    return qb;
  }

  protected buildScopedListQuery(orgId: string): SelectQueryBuilder<ContractApprover> {
    return this.joinedToOrg(orgId);
  }
}
