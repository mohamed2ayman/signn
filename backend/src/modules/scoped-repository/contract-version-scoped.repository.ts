import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ContractVersion } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2a: ContractVersion scoped repository (CLEAN direct child).
 *
 * First CHILD subclass of {@link ScopedContractRepository}. Resolves org via the
 * canonical `version → contract → project → organization_id` chain (Ayman B spec
 * Q1: canonical-only; ContractVersion carries no denormalized org column anyway).
 * The override-safety shape (no orgId-override; org filter always applied) is
 * inherited from the base unchanged — for a CHILD the override pins
 * `version.contract_id`, never the org.
 *
 * The independent walls (`ContractAccessService.findInOrg`, the Tier 2 walls on
 * the version read endpoints) stay in front; this is the data-layer tenancy load
 * that fires AFTER the persona wall (two checks, two layers — CLAUDE.md Option B).
 */
@Injectable()
export class ContractVersionScopedRepository extends ScopedContractRepository<ContractVersion> {
  protected readonly notFoundMessage = 'Contract version not found';
  protected readonly entityAlias = 'version';

  constructor(
    @InjectRepository(ContractVersion)
    repo: Repository<ContractVersion>,
  ) {
    super(repo);
  }

  /** `version → contract → project`, both inner joins, org filter mandatory. */
  private joinedToOrg(orgId: string): SelectQueryBuilder<ContractVersion> {
    return this.repo
      .createQueryBuilder('version')
      .innerJoin('version.contract', 'contract')
      .innerJoin('contract.project', 'project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<ContractVersion> {
    const qb = this.joinedToOrg(orgId).andWhere('version.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // CHILD override pins the PARENT contract (`version.contract_id`). SAFETY:
      // the org filter is ALWAYS `:orgId`; this only NARROWS to a parent
      // contract and can never widen or change the caller's org.
      qb.andWhere('version.contract_id = :contractIdOverride', { contractIdOverride });
    }

    return qb;
  }

  protected buildScopedListQuery(orgId: string): SelectQueryBuilder<ContractVersion> {
    return this.joinedToOrg(orgId);
  }
}
