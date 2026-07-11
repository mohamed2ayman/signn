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

  // S2c-1 allowlist guard: no scopedFind caller is wired on the Contract ROOT
  // — EMPTY set; any filter key throws until a bucket deliberately wires one.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set();

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

  // ── BY-ID WITH HYDRATED CLAUSES (silent-null, for chat contract context) ──

  /**
   * The chokepoint for AI Chat's CONTRACT-CONTEXT load (Phase 7.27). Loads the
   * contract by id, org-walled, with the `project` (for jurisdiction) AND its
   * live clause set HYDRATED, so `ChatService.buildContractContext` can render
   * `[§section] title (type) + content` blocks for the conversational agent.
   *
   * Why a purpose-built method instead of {@link scopedFindByIdWithRelations}:
   * that helper flat-joins single-level relations (`rel_<name>`) and CANNOT
   * hydrate the NESTED `contract_clauses → clause` path the assembler needs
   * (the clause's `content` / `title` / `clause_type` live on `Clause`, one hop
   * past the `contract_clauses` junction). This method adds that nested hop.
   *
   * Same tenancy gate as every other method here — it reuses
   * {@link buildScopedQuery} (`contract → project → organization_id = :orgId`),
   * so an out-of-org id yields zero rows. Returns `null` on a miss — NEVER
   * throws — matching {@link scopedFindByIdWithRelations}: chat treats null as
   * "no contract context" and proceeds (best-effort grounding).
   *
   * Filters + ordering, and why:
   *  - `contract_clauses.is_proposed = false` — proposed clauses are a bound
   *    guest's un-merged new-version pile (Slice 1 Option C); they are excluded
   *    from every host-facing read, so chat context must not see them either.
   *  - `clause.is_active = true` — retired clause versions (superseded by the
   *    parent-chain promotion) must not appear in the grounding.
   *  - `ORDER BY contract_clauses.order_index ASC` — deterministic section
   *    order so the assembled `[§N]` blocks read top-to-bottom like the contract.
   *
   * `rel_project` is a DISTINCT hydration alias so it can't collide with the
   * gate's own `innerJoin('contract.project', 'project')` — same aliasing
   * discipline as {@link scopedFindByIdWithRelations}.
   */
  async scopedFindByIdWithClauses(
    id: string,
    orgId: string,
  ): Promise<Contract | null> {
    return this.buildScopedQuery(id, orgId)
      .leftJoinAndSelect('contract.project', 'rel_project')
      .leftJoinAndSelect(
        'contract.contract_clauses',
        'contract_clauses',
        'contract_clauses.is_proposed = false',
      )
      .leftJoinAndSelect(
        'contract_clauses.clause',
        'clause',
        'clause.is_active = true',
      )
      .orderBy('contract_clauses.order_index', 'ASC')
      .getOne();
  }
}
