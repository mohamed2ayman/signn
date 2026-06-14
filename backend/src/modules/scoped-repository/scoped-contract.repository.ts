import { NotFoundException } from '@nestjs/common';
import {
  FindManyOptions,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

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

  // ── SCOPED LIST (Ayman B spec Q3 — add a scoped list method) ────────────

  /**
   * The query alias the entity uses in {@link buildScopedListQuery}. The base's
   * {@link scopedFind} appends `filter` / `order` predicates against this alias.
   */
  protected abstract readonly entityAlias: string;

  /**
   * S2c-1 (Ayman ratified) — per-entity ALLOWLIST of filter KEYS that
   * {@link scopedFind} may accept.
   *
   * scopedFind interpolates each filter KEY into the SQL string (the VALUES
   * are always bound as parameters; keys cannot be). Today every key at every
   * call site is a code-controlled literal, but later buckets wire more
   * callers — so the key is guarded structurally: a key not in the subclass's
   * allowlist throws BEFORE any interpolation happens.
   *
   * Declare ONLY the keys the subclass's wired reads actually filter on.
   * Widening a subclass's allowlist is a deliberate per-bucket decision,
   * never a drive-by. Subclasses with no wired scopedFind caller declare an
   * EMPTY set (any filter key throws until a bucket wires one).
   *
   * Scope note: this guard is the filter-KEY gate only. Operator/range
   * support and a query-builder wrapper are explicitly NOT this mechanism's
   * job — complex reads stay raw QB → the lint bucket (Q3). The `relations` /
   * `order` identifiers remain code-controlled literals at every call site
   * (same posture filter keys had pre-S2c-1).
   */
  protected abstract readonly allowedFilterKeys: ReadonlySet<string>;

  /**
   * Build the org-scoped LIST query base: a fresh query builder aliased
   * {@link entityAlias}, with the child→parent-contract→project join and the
   * org filter ALWAYS applied — the SAME join hops as {@link buildScopedQuery},
   * minus the by-id predicate.
   *
   * IRON RULE (identical to the by-id path): ALWAYS apply
   * `project.organization_id = :orgId`. This is the structural tenancy gate for
   * {@link scopedFind}; there is no orgId-override anywhere — the org is
   * whatever the caller passed. Canonical-only: resolve org via
   * `contract → project → organization_id`; NEVER read a denormalized `org_id`
   * column (Ayman B spec Q1 — the drift columns are non-authoritative).
   */
  protected abstract buildScopedListQuery(orgId: string): SelectQueryBuilder<T>;

  /**
   * List the contract-scoped rows matching `filter`, with
   * `project.organization_id = :orgId` ALWAYS applied. Optional single-level
   * `relations` and `order` mirror the `repo.find({ where, relations, order })`
   * options the wired call sites use, so this is a behavior-preserving drop-in
   * PLUS the tenancy gate.
   *
   * STRUCTURAL ORG-SAFETY (mirrors the by-id methods): there is NO
   * orgId-override parameter. `filter` predicates are applied on the ENTITY
   * alias only ({@link entityAlias}) — they can never touch, relax, or replace
   * the `project.organization_id = :orgId` gate baked into
   * {@link buildScopedListQuery}. A caller cannot pass or change which org the
   * rows are scoped to; the org is always the `orgId` argument (the caller's
   * real org). Filter values are bound as parameters.
   */
  async scopedFind(
    filter: FindOptionsWhere<T>,
    orgId: string,
    options?: { relations?: string[]; order?: Record<string, 'ASC' | 'DESC'> },
  ): Promise<T[]> {
    const qb = this.buildScopedListQuery(orgId);

    for (const [key, value] of Object.entries(filter)) {
      // ALLOWLIST GUARD (S2c-1) — the filter KEY is interpolated into SQL
      // below; reject anything the subclass has not explicitly declared,
      // BEFORE the key touches the query string.
      if (!this.allowedFilterKeys.has(key)) {
        throw new Error(
          `scopedFind: filter key "${key}" is not allowlisted for ` +
            `${this.constructor.name} (allowed: ` +
            `[${[...this.allowedFilterKeys].join(', ')}]). Filter keys are ` +
            `interpolated into SQL — declare the key in the subclass's ` +
            `allowedFilterKeys before filtering on it.`,
        );
      }
      // Column ref on the entity alias; value bound as a parameter. The org
      // gate lives on the subclass's gate alias and is untouched by these
      // predicates.
      qb.andWhere(`${this.entityAlias}.${key} = :flt_${key}`, {
        [`flt_${key}`]: value,
      });
    }
    for (const relation of options?.relations ?? []) {
      qb.leftJoinAndSelect(`${this.entityAlias}.${relation}`, relation);
    }
    for (const [column, direction] of Object.entries(options?.order ?? {})) {
      qb.addOrderBy(`${this.entityAlias}.${column}`, direction);
    }

    return qb.getMany();
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
   * WIRING STATUS: the FIRST (and currently ONLY) production caller is the
   * `ObligationReminderProcessor` system sweeper (BullMQ `@Processor`, no JWT /
   * no request org in scope), wired in the processor-sweep bucket. It is
   * reachable ONLY from that queue/scheduler path — never from a request-scoped
   * controller or service (proven by the escape-hatch fence spec,
   * findacrossallorgs-escape-hatch.spec.ts). The ESLint allowlist that fences
   * this method to specific files at lint-time is still a later bucket; until
   * it lands, the fence spec is the structural guard.
   *
   * OPTIONS (minimal additive — processor-sweep bucket): an optional
   * {@link FindManyOptions} is passed straight through to `repo.find(options)`
   * so a system caller can express its native `where` / `relations` shape (the
   * sweeper filters on obligation `status` and hydrates contract/assignee
   * relations). This is a pure TypeORM-native passthrough — it adds NO org
   * filter (the all-orgs behaviour is the whole point of this method) and NO
   * query-builder wrapper / operator DSL. The zero-arg call still works
   * (`options` is optional → `repo.find()`), so the S1 shape is preserved.
   */
  async findAcrossAllOrgs(options?: FindManyOptions<T>): Promise<T[]> {
    return this.repo.find(options);
  }
}
