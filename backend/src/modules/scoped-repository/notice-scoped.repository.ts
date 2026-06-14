import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';

import { Notice } from '../../database/entities';
import { ScopedContractRepository } from './scoped-contract.repository';

/**
 * Option B — S2e: Notice scoped repository.
 *
 * Resolves org via the canonical `notice → contract → project →
 * organization_id` chain ONLY (Ayman B spec Q1). The DENORMALIZED
 * `notice.org_id` column is NEVER part of the resolution path — it is a
 * non-authoritative attribution column that can drift; the `contract_id` FK is
 * the tenancy truth. Proven by the drifted-`org_id` probe in
 * notice-scoped.s2e.repository.spec.ts (the canonical-only check still resolves
 * an orgA notice whose `org_id` maliciously points at orgB).
 *
 * GATE-ALIAS NOTE (same deliberate deviation as ObligationScopedRepository /
 * RiskScopedRepository): the org-gate joins are aliased `org_gate_contract` /
 * `org_gate_project` so the base's scopedFind relation-hydration
 * (`leftJoinAndSelect('notice.<rel>', '<rel>')`) can never collide with the
 * gate join. The S2e-wired notice LIST read (findAllByContract) requests
 * `relations: ['submitter']` — no overlap with the gate aliases — but the
 * distinct gate aliases keep the tenancy gate independent regardless.
 *
 * S2e wires the per-contract LIST read (NoticesService.findAllByContract)
 * through scopedFind, and the by-id load (NoticesService.findById — the shared
 * loader for acknowledge/respond/updateStatus) through scopedFindByIdOrThrow.
 * The nested-relation hydration on findById exceeds the scoped base's
 * single-level relation support, so it stays a two-step (scoped tenancy load →
 * hydrate the validated id) — the base is NOT grown.
 *
 * The independent #57 (S0-part-2) child-id wall (ContractAccessService.findInOrg
 * keyed on the notice's OWN contract_id) and the Tier 3 create/list wall STAY in
 * front of every wired read — this is the second, persona-blind tenancy layer
 * (two checks, two layers — CLAUDE.md Option B).
 */
@Injectable()
export class NoticeScopedRepository extends ScopedContractRepository<Notice> {
  // Matches the existing thrown message in NoticesService.findById so the S2e
  // OrThrow wiring is a byte-faithful drop-in. 404, never 403 — no existence
  // leak.
  protected readonly notFoundMessage = 'Notice not found';
  protected readonly entityAlias = 'notice';

  // S2e allowlist: the wired list read filters on contract_id only.
  // Widening this set is a deliberate per-bucket decision, never a drive-by.
  protected readonly allowedFilterKeys: ReadonlySet<string> = new Set([
    'contract_id',
  ]);

  constructor(
    @InjectRepository(Notice)
    repo: Repository<Notice>,
  ) {
    super(repo);
  }

  /**
   * `notice → contract → project`, both inner joins, org filter mandatory.
   * Canonical-only (Q1): the join walks the `notice.contract` FK; the
   * denormalized `notice.org_id` column is never consulted.
   */
  private joinedToOrg(orgId: string): SelectQueryBuilder<Notice> {
    return this.repo
      .createQueryBuilder('notice')
      .innerJoin('notice.contract', 'org_gate_contract')
      .innerJoin('org_gate_contract.project', 'org_gate_project')
      // TENANCY GATE — always the caller's real org. Non-negotiable.
      .andWhere('org_gate_project.organization_id = :orgId', { orgId });
  }

  protected buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<Notice> {
    const qb = this.joinedToOrg(orgId).andWhere('notice.id = :id', { id });

    if (contractIdOverride !== undefined) {
      // Pin the parent contract (`notice.contract_id`). SAFETY: the org filter
      // is ALWAYS `:orgId`; this only NARROWS to a parent contract and can
      // never widen or change the caller's org.
      qb.andWhere('notice.contract_id = :contractIdOverride', {
        contractIdOverride,
      });
    }

    return qb;
  }

  protected buildScopedListQuery(orgId: string): SelectQueryBuilder<Notice> {
    return this.joinedToOrg(orgId);
  }
}
