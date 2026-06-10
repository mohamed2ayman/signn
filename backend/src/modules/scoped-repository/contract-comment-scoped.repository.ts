import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { ContractComment } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2b: ContractComment scoped repository (CLEAN direct child).
 *
 * Wires the comment by-id MUTATION-path loads (resolveComment / updateComment /
 * deleteComment in contracts.service) through the data-layer tenancy chokepoint.
 * Resolves org via the canonical `comment → contract → project →
 * organization_id` chain (Ayman B spec Q1: canonical-only; ContractComment
 * carries no denormalized org column — the `contract_clause_id` FK is unrelated
 * to tenancy and is never the resolution path).
 *
 * S2b WIRES the by-id path (`scopedFindByIdViaContract` + override) — this is
 * where the child by-id + parent-contract override do real mutation-path work,
 * as the S2a doc earmarked. The comment LIST read (`getComments`) stays a raw
 * `createQueryBuilder` → the CI lint bucket (Q3); `buildScopedListQuery` is
 * implemented only because the base requires it, exactly like the S2a children.
 *
 * The independent walls (`ContractAccessService.findInOrg`, the Tier-1 walls on
 * the comment mutation routes) stay in front; this is the second, persona-blind
 * tenancy layer that fires AFTER the wall and BEFORE the author/permission check
 * (two checks, two layers — CLAUDE.md Option B).
 */
@Injectable()
export class ContractCommentScopedRepository extends ScopedContractRepository<ContractComment> {
  // Matches the existing thrown message in contracts.service so the OrThrow
  // variants are a byte-faithful drop-in (no existence leak; never 403).
  protected readonly notFoundMessage = 'Comment not found';
  protected readonly entityAlias = 'comment';

  constructor(
    @InjectRepository(ContractComment)
    repo: Repository<ContractComment>,
  ) {
    super(repo);
  }

  /** `comment → contract → project`, both inner joins, org filter mandatory. */
  private joinedToOrg(orgId: string): SelectQueryBuilder<ContractComment> {
    return this.repo
      .createQueryBuilder('comment')
      .innerJoin('comment.contract', 'contract')
      .innerJoin('contract.project', 'project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<ContractComment> {
    const qb = this.joinedToOrg(orgId).andWhere('comment.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // CHILD override pins the PARENT contract (`comment.contract_id`). SAFETY:
      // the org filter is ALWAYS `:orgId`; this only NARROWS to a parent
      // contract and can never widen or change the caller's org. The comment
      // mutation routes use it to preserve the existing "comment must belong to
      // the URL contract" constraint.
      qb.andWhere('comment.contract_id = :contractIdOverride', { contractIdOverride });
    }

    return qb;
  }

  protected buildScopedListQuery(orgId: string): SelectQueryBuilder<ContractComment> {
    return this.joinedToOrg(orgId);
  }
}
