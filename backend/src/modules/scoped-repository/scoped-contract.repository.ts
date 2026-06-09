import { NotFoundException } from '@nestjs/common';
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

/**
 * Option B — S1: the scoped-repository BASE CLASS.
 *
 * This is the data-layer TENANCY chokepoint. It is the second of the two
 * independent checks that protect every contract-scoped read/write:
 *
 *   1. The WALL  (ContractAccessService.findInOrg / findAccessibleContract,
 *      the Tier 1-3 / S0 walls) — PERSONA authorization at route entry:
 *      "may THIS caller (managing / guest / viewer) touch THIS contract?"
 *
 *   2. The SCOPED REPO (this class) — TENANCY at the data load:
 *      "no contract-scoped row crosses an org boundary, ever, regardless of
 *      how the call got here."
 *
 * The two are complementary, NOT redundant (CLAUDE.md Option B). The wall is
 * persona-aware and lives at the route entry; the scoped repo is persona-blind
 * and lives at the data load. S1 ADDS the scoped repo — it removes no wall.
 * `findInOrg` STAYS independent; nothing here touches, absorbs, or rewires it.
 *
 * ── The org-scope contract ────────────────────────────────────────────────
 * EVERY read method REQUIRES an explicit `orgId` and filters by it through the
 * canonical `contract → project → organization_id` path (mirroring
 * ContractAccessService.findInOrg at contract-access.service.ts:105). No method
 * on this class can load a contract-scoped entity WITHOUT an orgId. The orgId
 * is ALWAYS supplied by the caller's authenticated context (the JWT org via
 * `@OrganizationId()`), never derived from request-supplied data.
 *
 * The ONLY exception is the deliberately-named {@link findAcrossAllOrgs}
 * tenancy bypass — read its doc comment before using it.
 *
 * ── Auto vs override parent-contract resolution (Ayman's B spec, item 1) ───
 * For a CHILD entity (e.g. an Obligation) the parent contract is resolved
 * AUTOMATICALLY by following the child's FK to the contract, then to the
 * project, then to the org. {@link scopedFindByIdViaContract} ALSO exposes a
 * manual override (`contractIdOverride`) — a fallback for buggy auto-resolution
 * where the caller pins WHICH CONTRACT the org is resolved through.
 *
 *   CRITICAL SAFETY CONSTRAINT (structurally enforced — see the note on
 *   `buildScopedQuery` below): the override lets the caller specify which
 *   PARENT CONTRACT to resolve the org from. It does NOT, and CANNOT, let the
 *   caller pass an arbitrary `orgId`. There is no `orgId` override parameter
 *   anywhere on this class. The org scoped against is ALWAYS the `orgId`
 *   argument the method already requires — the caller's real org. The override
 *   can only NARROW the result to a specific parent contract; it can never
 *   widen or change which org the caller is treated as. A caller in org A
 *   passing org B's contractId as the override is still DENIED, because that
 *   contract's `project.organization_id` is not `:orgId` (= org A) and the
 *   filter yields zero rows. Proven by the override-safety probe in
 *   contract-scoped.repository.spec.ts.
 *
 * No CHILD entity is wired in S1 — the auto/override shape is established here
 * and tested against the Contract ROOT (where parent == self). Child entities
 * are the next bucket; the lint + CLAUDE.md Architecture Rule land last
 * (writing the Rule now would claim an invariant that isn't true yet — bare
 * repo access still exists everywhere until the lint ships).
 *
 * Generic base + per-entity subclass (audit Option 3.1.B): each subclass
 * declares its join to org in {@link buildScopedQuery}; the base owns the
 * public method surface so the API evolves in one place.
 */
export abstract class ScopedContractRepository<T extends ObjectLiteral> {
  protected constructor(protected readonly repo: Repository<T>) {}

  /**
   * Message for the 404 thrown by the `*OrThrow` variants. Subclasses set this
   * to match the existing no-existence-leak convention (the wall throws
   * `NotFoundException('Contract not found')` — never 403 — so existence is
   * never leaked; see contract-access.service.ts:117).
   */
  protected abstract readonly notFoundMessage: string;

  /**
   * Build the org-scoped query for a single entity by id. Subclasses encode
   * the join hops from the entity to its parent contract, then to the project,
   * then apply the org filter.
   *
   * IRON RULE for every subclass implementation:
   *   - ALWAYS apply `project.organization_id = :orgId`. This is the tenancy
   *     gate and it is non-negotiable; it is what makes "no method can load a
   *     contract-scoped entity without an orgId" structurally true.
   *   - When `contractIdOverride` is provided, ADDITIONALLY pin the parent
   *     contract to it (for the ROOT, `contract.id = :contractIdOverride`; for
   *     a CHILD, `child.contract_id = :contractIdOverride`). This only NARROWS;
   *     it must NEVER replace or relax the org filter above.
   *   - There is no `orgId` override parameter. The org is whatever the caller
   *     passed — their real org — full stop.
   */
  protected abstract buildScopedQuery(
    id: string,
    orgId: string,
    contractIdOverride?: string,
  ): SelectQueryBuilder<T>;

  // ── ROOT by-id (automatic resolution) ──────────────────────────────────

  /**
   * Load the entity by id, scoped to `orgId`. Returns the row only if it
   * belongs to the org; otherwise `null`. No existence leak — the caller
   * decides whether `null` becomes a 404 (use {@link scopedFindByIdOrThrow}
   * for the wall-matching 404).
   */
  async scopedFindById(id: string, orgId: string): Promise<T | null> {
    return this.buildScopedQuery(id, orgId).getOne();
  }

  /**
   * Like {@link scopedFindById} but throws `NotFoundException` (404) on a miss,
   * matching the wall's no-existence-leak convention.
   */
  async scopedFindByIdOrThrow(id: string, orgId: string): Promise<T> {
    const entity = await this.scopedFindById(id, orgId);
    if (!entity) {
      throw new NotFoundException(this.notFoundMessage);
    }
    return entity;
  }

  // ── CHILD resolution (automatic, with manual parent-contract override) ──

  /**
   * Load the entity by id, scoped to `orgId`, resolving the parent contract
   * AUTOMATICALLY (default) or via a manual override.
   *
   * @param options.contractIdOverride  Optional manual parent-contract pin —
   *   a fallback for buggy auto-resolution. SAFETY: this only changes WHICH
   *   CONTRACT the org is resolved through; the org scoped against is ALWAYS
   *   `orgId` (the caller's real org). It can never widen or change the
   *   caller's org. See the class doc comment's safety constraint.
   *
   * For the Contract ROOT subclass, parent == self, so the override pins
   * `contract.id` — used to establish and test the override-safety shape
   * before any child entity is wired (S1).
   */
  async scopedFindByIdViaContract(
    id: string,
    orgId: string,
    options?: { contractIdOverride?: string },
  ): Promise<T | null> {
    return this.buildScopedQuery(id, orgId, options?.contractIdOverride).getOne();
  }

  /**
   * Like {@link scopedFindByIdViaContract} but throws `NotFoundException` (404)
   * on a miss, matching the wall's no-existence-leak convention.
   */
  async scopedFindByIdViaContractOrThrow(
    id: string,
    orgId: string,
    options?: { contractIdOverride?: string },
  ): Promise<T> {
    const entity = await this.scopedFindByIdViaContract(id, orgId, options);
    if (!entity) {
      throw new NotFoundException(this.notFoundMessage);
    }
    return entity;
  }

  // ── SYSTEM-LEVEL TENANCY BYPASS — read this before using ────────────────

  /**
   * ⚠️  TENANCY BYPASS — SYSTEM / BACKGROUND USE ONLY.  ⚠️
   *
   * Returns rows ACROSS ALL ORGANIZATIONS with NO org filter. This is the ONE
   * deliberate, named escape hatch from the tenancy gate. It exists for
   * legitimately org-blind background work — e.g. the daily/weekly
   * ObligationReminderProcessor sweeper, which MUST iterate every org's data
   * (audit §4.3). It must NEVER be reachable from a request-scoped (per-user)
   * code path.
   *
   * If you are about to call this from a controller, a service handling an
   * HTTP request, or anything with a JWT user in scope: STOP. You almost
   * certainly want {@link scopedFindById} / {@link scopedFindByIdViaContract}
   * with the caller's `orgId` instead.
   *
   * S1 status: DEFINED (shape + this comment) but UNWIRED — there is no
   * production caller. The ObligationReminderProcessor migration and the
   * ESLint allowlist that fences this method to specific files are a later
   * bucket. Adding a caller now is out of S1 scope.
   */
  async findAcrossAllOrgs(): Promise<T[]> {
    return this.repo.find();
  }
}
