import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ContractorResponse } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2a: ContractorResponse scoped repository (CLEAN direct child).
 *
 * Resolves org via the canonical `response → contract → project →
 * organization_id` chain (Ayman B spec Q1: canonical-only). NOTE: the entity
 * also has a SECOND FK `response_contract_id` (the responding sub-contract) —
 * the parent for tenancy is the PRIMARY `contract_id`, joined via the `contract`
 * relation; `response_contract_id` is never the resolution path.
 *
 * Walls stay independent and in front; this is the data-layer tenancy load.
 */
@Injectable()
export class ContractorResponseScopedRepository extends ScopedContractRepository<ContractorResponse> {
  protected readonly notFoundMessage = 'Contractor response not found';
  protected readonly entityAlias = 'response';

  constructor(
    @InjectRepository(ContractorResponse)
    repo: Repository<ContractorResponse>,
  ) {
    super(repo);
  }

  /** `response → contract → project`, both inner joins, org filter mandatory. */
  private joinedToOrg(orgId: string): SelectQueryBuilder<ContractorResponse> {
    return this.repo
      .createQueryBuilder('response')
      .innerJoin('response.contract', 'contract')
      .innerJoin('contract.project', 'project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<ContractorResponse> {
    const qb = this.joinedToOrg(orgId).andWhere('response.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // CHILD override pins the PARENT contract (`response.contract_id`).
      qb.andWhere('response.contract_id = :contractIdOverride', { contractIdOverride });
    }

    return qb;
  }

  protected buildScopedListQuery(orgId: string): SelectQueryBuilder<ContractorResponse> {
    return this.joinedToOrg(orgId);
  }
}
