import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';

import { PlaybookPosition, PlaybookScope } from '../../database/entities';

/** What the caller is resolving FOR. Both narrowings are optional. */
export interface PlaybookResolveTarget {
  /** Narrow to a project — PROJECT-scoped positions for this id become eligible. */
  projectId?: string | null;
  /** Narrow to a contract — CONTRACT-scoped positions for this id become eligible. */
  contractId?: string | null;
}

/**
 * 7.22 Slice 2 — the scope-precedence RESOLVER.
 *
 * Answers "which standard positions actually apply here?" for a given
 * (org, project?, contract?) target. Slice 1 stores positions at three scopes
 * and deliberately does NOT resolve them; this is that missing half.
 *
 * PRECEDENCE — most specific wins, PER CLAUSE TYPE:
 *
 *     CONTRACT  >  PROJECT  >  ORG
 *
 * ORG positions are always the base set. A PROJECT position for the target
 * project HIDES the ORG position on the same clause type; a CONTRACT position
 * for the target contract HIDES both. Clause types with no override fall
 * through to the ORG default, so the result is the org's full position sheet
 * with the narrower overrides substituted in — never a partial sheet.
 *
 * The override is WHOLE-POSITION, not field-merged: an override replaces the
 * less specific position outright (its rule_type may legitimately differ — an
 * org RANGE on `payment` can be overridden by a contract TEXT). Merging typed
 * value_configs across rule_types has no coherent meaning.
 *
 * TENANCY: `organization_id = :orgId` is on the query unconditionally — the
 * same wall as every Slice-1 read, and the ONLY thing establishing tenancy.
 * `projectId` / `contractId` are NARROWING predicates layered on top, never a
 * tenancy root: a foreign project/contract id simply matches no row of this
 * org's, so it resolves to the ORG defaults rather than leaking anything. The
 * caller must still have passed its own JWT org — this service never derives
 * one.
 *
 * INACTIVE positions are excluded. Slice 1's entity defines `is_active` as
 * "Deactivating retains the position without it being resolved" — this is the
 * code that honours that contract. NOTE the consequence: deactivating a
 * CONTRACT override does not merely remove it, it UNCOVERS the PROJECT/ORG
 * position underneath, which is the intended "revert to our default" behaviour.
 */
@Injectable()
export class PlaybookResolverService {
  private readonly logger = new Logger(PlaybookResolverService.name);

  constructor(
    @InjectRepository(PlaybookPosition)
    private readonly repo: Repository<PlaybookPosition>,
  ) {}

  /**
   * The effective position set for the target, one row per clause type.
   *
   * Ordered deterministically by the normalized clause-type key so callers
   * (notably the serializer, whose output is fed to a model) get a reproducible
   * result for the same data.
   */
  async resolveEffectivePositions(
    orgId: string,
    target: PlaybookResolveTarget = {},
  ): Promise<PlaybookPosition[]> {
    if (!orgId) return [];

    const candidates = await this.loadCandidates(orgId, target);
    return this.foldByPrecedence(candidates);
  }

  /**
   * 7.22 Item 4 — which of these ids are real playbook positions. Used to guard
   * the echoed playbook_position_id on a compliance finding (an invented id is
   * dropped, so the FK never dangles).
   */
  async filterExistingIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.repo.find({
      where: { id: In(ids) },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Every position of this org that COULD apply to the target: all ORG rows,
   * plus PROJECT rows for this project, plus CONTRACT rows for this contract.
   *
   * Rows for OTHER projects/contracts are excluded in SQL rather than in
   * memory — an org with positions on many contracts must not pull them all
   * back to discard them here.
   */
  private async loadCandidates(
    orgId: string,
    target: PlaybookResolveTarget,
  ): Promise<PlaybookPosition[]> {
    const projectId = target.projectId ?? null;
    const contractId = target.contractId ?? null;

    const qb = this.repo
      .createQueryBuilder('p')
      // THE WALL. Unconditional, first, and never derived from the target.
      .where('p.organization_id = :orgId', { orgId })
      .andWhere('p.is_active = true')
      .andWhere(
        new Brackets((b) => {
          b.where('p.scope = :orgScope', { orgScope: PlaybookScope.ORG });
          if (projectId) {
            b.orWhere('(p.scope = :projScope AND p.project_id = :projectId)', {
              projScope: PlaybookScope.PROJECT,
              projectId,
            });
          }
          if (contractId) {
            b.orWhere(
              '(p.scope = :ctrScope AND p.contract_id = :contractId)',
              { ctrScope: PlaybookScope.CONTRACT, contractId },
            );
          }
        }),
      )
      // Deterministic input ordering so the fold's duplicate tie-break below
      // is reproducible rather than dependent on Postgres heap order.
      .orderBy('p.updated_at', 'DESC')
      .addOrderBy('p.id', 'ASC');

    return qb.getMany();
  }

  /**
   * Collapse the candidate set to one winner per clause type.
   *
   * Two positions collide when their clause types match after normalization
   * (trim + lowercase). Normalizing is deliberate: an override authored as
   * "Payment" must override an org default stored as "payment", and a stray
   * trailing space must not silently produce two competing positions on the
   * same subject. The winner's ORIGINAL `clause_type` string is preserved for
   * display — only the comparison key is normalized.
   *
   * Ties WITHIN a scope tier (an org may hold two ORG rows for the same clause
   * type — there is no unique constraint, by design, since clause_type is free
   * text) resolve to the most recently updated row, then lowest id. That is
   * what the SQL ordering above guarantees, so first-seen-wins here.
   */
  private foldByPrecedence(
    candidates: PlaybookPosition[],
  ): PlaybookPosition[] {
    const winners = new Map<string, PlaybookPosition>();

    for (const row of candidates) {
      const key = normalizeClauseTypeKey(row.clause_type);
      const held = winners.get(key);
      if (!held || scopeRank(row.scope) > scopeRank(held.scope)) {
        winners.set(key, row);
      }
    }

    return Array.from(winners.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, row]) => row);
  }
}

/** The comparison key two positions collide on. Exported for the tests. */
export function normalizeClauseTypeKey(clauseType: string): string {
  return (clauseType ?? '').trim().toLowerCase();
}

/**
 * Specificity, high wins. An unrecognised scope string ranks BELOW ORG so a
 * future scope value that predates this code can never silently outrank a real
 * position — it is ignored rather than trusted.
 */
function scopeRank(scope: PlaybookScope | string): number {
  switch (scope) {
    case PlaybookScope.CONTRACT:
      return 3;
    case PlaybookScope.PROJECT:
      return 2;
    case PlaybookScope.ORG:
      return 1;
    default:
      return 0;
  }
}
