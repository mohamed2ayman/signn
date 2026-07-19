'use strict';

/**
 * Option B — Lint bucket, PHASE 1 (DISCOVERY, REPORT-ONLY).
 *
 * Flags BARE access to a contract-scoped repository — i.e. a direct TypeORM
 * repository / EntityManager data call on an entity that is rooted in the
 * `contract → project → organization_id` chain, made OUTSIDE the scoped-repository
 * chokepoint module.
 *
 * The ratified ban (conservative reading): "Contract-scoped reads / by-id loads
 * must go through a scoped repository (the chokepoint)." This rule implements
 * that ban but is wired in WARN mode for discovery — it never fails the build.
 * PHASE 2 flips it to `error`, adds the allowlist annotations, and lands the
 * CLAUDE.md Architecture Rule. This file changes NO production code.
 *
 * ── What counts as "bare access" ────────────────────────────────────────────
 *   (inject)        @InjectRepository(<Entity>)                — injection point
 *   (getRepository) getRepository(<Entity>) / x.getRepository  — bare acquisition
 *   (call)          <repoIdent>.<dataMethod>(...) where repoIdent is typed
 *                   Repository<Entity> / decorated @InjectRepository(Entity)
 *   (manager)       <manager>.<dataMethod>(<Entity>, ...)      — EntityManager call
 *
 * ── How identifiers are mapped to entities (no type-checker required) ────────
 * The parser is `@typescript-eslint/parser` WITHOUT type information, so the
 * mapping is purely syntactic and intentionally conservative:
 *   - a constructor parameter-property / class field / variable whose TYPE
 *     ANNOTATION is `Repository<Entity>` (or TreeRepository/MongoRepository/…)
 *     is tracked as a bare repo for `Entity`;
 *   - a constructor parameter-property / field decorated `@InjectRepository(Entity)`
 *     is tracked too (and the decorator itself is reported as `inject`).
 * A `this.<prop>` access is matched against tracked PROPERTIES; a bare
 * `<ident>.<m>()` against tracked LOCALS. Scoped-repository injected providers
 * (typed `ContractScopedRepository` etc., NOT `Repository<…>`) are never tracked,
 * so calls like `this.scoped.scopedFindById()` are correctly NOT flagged.
 *
 * ── Scope exclusion (category B — the chokepoint's own internals) ────────────
 * Files whose path contains any `chokepointPathFragments` entry are SKIPPED
 * entirely — the scoped-repository module (the scoped base + per-entity
 * subclasses) and the ContractAccessService wall (findInOrg) are where scoped
 * access is DEFINED, so bare repo access there is the definition, not a
 * violation. These are excluded by SCOPE, never by inline annotation.
 *
 * getRepository asymmetry: the `getRepository(Entity)` ACQUISITION is reported
 * once; downstream calls on the obtained local are NOT separately tracked (they
 * belong to the same bare acquisition). Injected/typed repos ARE tracked at
 * every call site, because the injection point and the call sites are far apart
 * and each call is a distinct site a migration must touch.
 */

// ── Defaults (overridable via rule options) ─────────────────────────────────

// The contract-scoped entity set. Tier 1 = the known refactor set (11). Tier 2 =
// newly-discovered entities also rooted in contract → project → org (direct
// contract_id, or transitively via a contract-scoped parent). Phase 1 is
// deliberately OVER-INCLUSIVE — discovery first, allowlist tuning in Phase 2.
const DEFAULT_ENTITIES = [
  // Tier 1 — known refactor set (scoped repos already exist for these)
  'Contract',
  'ContractVersion',
  'ContractorResponse',
  'ContractApprover',
  'ContractComment',
  'Obligation',
  'RiskAnalysis',
  'Notice',
  'Claim',
  'SubContract',
  'DocumentUpload',
  // Tier 2 — newly-discovered, DIRECT contract_id (no scoped repo yet)
  'ContractClause',
  'ComplianceCheck',
  'NegotiationEvent',
  'ContractShare',
  'GuestContractAccess',
  'GuestInvitation',
  'ChatSession', // nullable contract_id (borderline)
  'ChatMessage', // nullable contract_id (borderline)
  // Tier 2 — newly-discovered, TRANSITIVE child of a contract-scoped parent
  'ComplianceFinding', // → ComplianceCheck → Contract
  'ComplianceReportJob', // → ComplianceCheck → Contract
  'RiskAnalysisOverrideLog', // → RiskAnalysis → Contract
  'ObligationAssignee', // → Obligation → Contract
  'ObligationReminderLog', // → Obligation → Contract
  // Multi-tier T0c-1 — contract parties spine
  'ContractParty', // direct contract_id
  'ContractPartyContact', // → ContractParty → Contract
  // Guest Signing v1 — slip capability rows (direct contract_id)
  'GuestSignSlip',
  // 7.19 Slice 1 — counterparty redlining spine
  'ClauseRedline', // direct contract_id
  // NOTE: PartyRole is deliberately NOT listed — it is a GLOBAL registry
  // (no org/contract rooting), same class as ContractRelationshipType.
];

const DEFAULT_REPO_TYPES = [
  'Repository',
  'TreeRepository',
  'MongoRepository',
  'AbstractRepository',
];

// TypeORM Repository / EntityManager data methods (the ones that actually read
// or write rows). Intentionally excludes in-memory helpers (create, merge) and
// metadata accessors (metadata, target, manager).
const DEFAULT_DATA_METHODS = [
  'find',
  'findBy',
  'findAndCount',
  'findAndCountBy',
  'findOne',
  'findOneBy',
  'findOneOrFail',
  'findOneByOrFail',
  'count',
  'countBy',
  'exist',
  'exists',
  'existsBy',
  'sum',
  'average',
  'minimum',
  'maximum',
  'createQueryBuilder',
  'save',
  'insert',
  'update',
  'upsert',
  'delete',
  'softDelete',
  'restore',
  'remove',
  'softRemove',
  'recover',
  'increment',
  'decrement',
  'clear',
  'preload',
  'query',
];

const DEFAULT_MANAGER_OBJECTS = [
  'manager',
  'entityManager',
  'em',
  'transactionalEntityManager',
];

const DEFAULT_CHOKEPOINT_FRAGMENTS = [
  'modules/scoped-repository/',
  'modules/contracts/services/contract-access.service.ts',
];

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Report-only discovery of bare contract-scoped repository access (Option B chokepoint).',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          entities: { type: 'array', items: { type: 'string' } },
          repositoryTypes: { type: 'array', items: { type: 'string' } },
          dataMethods: { type: 'array', items: { type: 'string' } },
          managerObjects: { type: 'array', items: { type: 'string' } },
          chokepointPathFragments: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      inject:
        'BARE-REPO[inject] @InjectRepository({{entity}}) — contract-scoped repo injected; route through the scoped repository (Option B chokepoint).',
      getRepository:
        'BARE-REPO[getRepository] getRepository({{entity}}) — contract-scoped repo acquired bare; route through the scoped repository.',
      call:
        'BARE-REPO[call:{{method}}] .{{method}}() on Repository<{{entity}}> — bare contract-scoped repo call; route through the scoped repository.',
      manager:
        'BARE-REPO[manager:{{method}}] <manager>.{{method}}({{entity}}, …) — bare contract-scoped EntityManager call; route through the scoped repository.',
    },
  },

  create(context) {
    const opts = (context.options && context.options[0]) || {};
    const entities = new Set(opts.entities || DEFAULT_ENTITIES);
    const repoTypes = new Set(opts.repositoryTypes || DEFAULT_REPO_TYPES);
    const dataMethods = new Set(opts.dataMethods || DEFAULT_DATA_METHODS);
    const managerObjects = new Set(
      opts.managerObjects || DEFAULT_MANAGER_OBJECTS,
    );
    const chokepointFragments =
      opts.chokepointPathFragments || DEFAULT_CHOKEPOINT_FRAGMENTS;

    const filename = (context.getFilename() || '').replace(/\\/g, '/');
    // Category B — chokepoint internals are excluded by SCOPE, not annotation.
    if (chokepointFragments.some((frag) => filename.includes(frag))) {
      return {};
    }

    /** property name (this.<X>) -> entity */
    const thisRepoProps = new Map();
    /** local identifier name -> entity */
    const localRepoVars = new Map();
    /** deferred call candidates resolved at Program:exit */
    const callCandidates = [];

    // ── // lint-exempt: <reason> suppression (Phase 2) ──────────────────────
    // A flagged site is suppressed when its line — or the line directly above —
    // carries a `// lint-exempt: <reason>` comment with a NON-EMPTY reason.
    // A bare `// lint-exempt` (no reason) does NOT suppress: the regex requires
    // at least one non-space character after the colon, forcing every exemption
    // to state why. This is the rule's OWN comment convention, independent of
    // ESLint's inline-directive system (which `noInlineConfig` disables), so the
    // two never interfere. Reasons are reviewed in the Phase 1 inventory + the
    // CLAUDE.md Architecture Rule; this rule only checks that a reason EXISTS.
    const EXEMPT_RE = /(?:^|\s)lint-exempt:\s*\S/;
    const sourceCode = context.getSourceCode();
    /** Set of line numbers carrying a valid lint-exempt comment. */
    const exemptLines = new Set();
    for (const comment of sourceCode.getAllComments()) {
      // Line comments and block comments both honoured; reason must be non-empty.
      if (EXEMPT_RE.test(comment.value)) {
        for (let l = comment.loc.start.line; l <= comment.loc.end.line; l++) {
          exemptLines.add(l);
        }
      }
    }
    // Report only if the site is not exempted. A comment on line L exempts a
    // site whose first line is L (trailing comment) or L+1 (comment directly
    // above) — i.e. site line R is exempt if exemptLines has R or R-1.
    function maybeReport(node, messageId, data) {
      const line = node.loc && node.loc.start ? node.loc.start.line : 0;
      if (exemptLines.has(line) || exemptLines.has(line - 1)) return;
      context.report({ node, messageId, data });
    }

    // ── helpers ───────────────────────────────────────────────────────────

    // Given a type-annotation-ish node, return the contract-scoped entity name
    // if the type is Repository<Entity> (or another tracked repo wrapper).
    function entityFromRepoType(node) {
      let ref = node;
      if (ref && ref.type === 'TSTypeAnnotation') ref = ref.typeAnnotation;
      if (!ref || ref.type !== 'TSTypeReference') return null;
      const tn = ref.typeName;
      if (!tn || tn.type !== 'Identifier' || !repoTypes.has(tn.name)) {
        return null;
      }
      // @typescript-eslint v6 exposes `typeArguments`; older builds `typeParameters`.
      const args = ref.typeArguments || ref.typeParameters;
      if (!args || !args.params || !args.params.length) return null;
      const first = args.params[0];
      if (
        first &&
        first.type === 'TSTypeReference' &&
        first.typeName &&
        first.typeName.type === 'Identifier' &&
        entities.has(first.typeName.name)
      ) {
        return first.typeName.name;
      }
      return null;
    }

    // @InjectRepository(Entity) on a decorators array -> entity name (or null).
    function entityFromInjectDecorators(decorators) {
      if (!decorators || !decorators.length) return null;
      for (const d of decorators) {
        const ex = d.expression || d;
        if (
          ex &&
          ex.type === 'CallExpression' &&
          ex.callee &&
          ex.callee.type === 'Identifier' &&
          ex.callee.name === 'InjectRepository' &&
          ex.arguments &&
          ex.arguments[0] &&
          ex.arguments[0].type === 'Identifier' &&
          entities.has(ex.arguments[0].name)
        ) {
          return ex.arguments[0].name;
        }
      }
      return null;
    }

    // getRepository(Entity) / x.getRepository(Entity) -> entity (or null).
    function entityFromGetRepository(callNode) {
      const callee = callNode.callee;
      let isGetRepo = false;
      if (callee.type === 'Identifier' && callee.name === 'getRepository') {
        isGetRepo = true;
      } else if (
        callee.type === 'MemberExpression' &&
        callee.property &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'getRepository'
      ) {
        isGetRepo = true;
      }
      if (!isGetRepo) return null;
      const a = callNode.arguments && callNode.arguments[0];
      if (a && a.type === 'Identifier' && entities.has(a.name)) return a.name;
      return null;
    }

    // <manager>.<dataMethod>(Entity, ...) -> {entity, method} (or null).
    function managerCall(callNode) {
      const callee = callNode.callee;
      if (callee.type !== 'MemberExpression') return null;
      if (!callee.property || callee.property.type !== 'Identifier') return null;
      const method = callee.property.name;
      if (!dataMethods.has(method)) return null;
      // object must look like an entity manager
      const obj = callee.object;
      let objName = null;
      if (obj.type === 'Identifier') objName = obj.name;
      else if (
        obj.type === 'MemberExpression' &&
        obj.property &&
        obj.property.type === 'Identifier'
      ) {
        objName = obj.property.name; // e.g. this.dataSource.manager, x.manager
      }
      if (!objName || !managerObjects.has(objName)) return null;
      const a = callNode.arguments && callNode.arguments[0];
      if (a && a.type === 'Identifier' && entities.has(a.name)) {
        return { entity: a.name, method };
      }
      return null;
    }

    // Register an identifier as a bare repo of `entity`.
    function registerThisProp(name, entity) {
      if (name && entity) thisRepoProps.set(name, entity);
    }
    function registerLocal(name, entity) {
      if (name && entity) localRepoVars.set(name, entity);
    }

    return {
      // ── injection points: constructor parameter properties ───────────────
      TSParameterProperty(node) {
        const param = node.parameter || node;
        const ident = param.type === 'Identifier' ? param : null;
        const name = ident ? ident.name : null;

        // decorators may live on the TSParameterProperty or on the inner param
        const decorators =
          (node.decorators && node.decorators.length && node.decorators) ||
          (param.decorators && param.decorators) ||
          [];
        const injEntity = entityFromInjectDecorators(decorators);
        const typeEntity = ident
          ? entityFromRepoType(ident.typeAnnotation)
          : null;
        const entity = injEntity || typeEntity;

        if (entity) registerThisProp(name, entity);
        if (injEntity) {
          maybeReport(node, 'inject', { entity: injEntity });
        }
      },

      // ── injection points / fields: plain params (no accessibility) ───────
      // Iterate function params directly (robust; avoids fragile esquery field
      // selectors). Catches @InjectRepository / Repository<Entity> on a plain
      // parameter that is NOT a parameter-property (rare, but complete).
      ':function'(node) {
        for (const param of node.params || []) {
          const ident = param.type === 'Identifier' ? param : null;
          if (!ident) continue;
          const decorators = ident.decorators || [];
          const injEntity = entityFromInjectDecorators(decorators);
          const typeEntity = entityFromRepoType(ident.typeAnnotation);
          const entity = injEntity || typeEntity;
          if (entity) registerLocal(ident.name, entity);
          if (injEntity) {
            maybeReport(param, 'inject', { entity: injEntity });
          }
        }
      },

      PropertyDefinition(node) {
        const decorators = node.decorators || [];
        const injEntity = entityFromInjectDecorators(decorators);
        const typeEntity = entityFromRepoType(node.typeAnnotation);
        const entity = injEntity || typeEntity;
        const name =
          node.key && node.key.type === 'Identifier' ? node.key.name : null;
        if (entity) registerThisProp(name, entity);
        if (injEntity) {
          maybeReport(node, 'inject', { entity: injEntity });
        }
      },

      // ── typed local variables: const x: Repository<Entity> = … ───────────
      VariableDeclarator(node) {
        if (node.id && node.id.type === 'Identifier' && node.id.typeAnnotation) {
          const entity = entityFromRepoType(node.id.typeAnnotation);
          if (entity) registerLocal(node.id.name, entity);
        }
      },

      // ── calls: getRepository, manager.method(Entity), repo.method() ──────
      CallExpression(node) {
        // getRepository(Entity) / x.getRepository(Entity)
        const grEntity = entityFromGetRepository(node);
        if (grEntity) {
          maybeReport(node, 'getRepository', { entity: grEntity });
          return;
        }
        // <manager>.<dataMethod>(Entity, …)
        const mc = managerCall(node);
        if (mc) {
          maybeReport(node, 'manager', { entity: mc.entity, method: mc.method });
          return;
        }
        // <repoIdent>.<dataMethod>(…)  — deferred (needs the identifier map)
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          callee.property &&
          callee.property.type === 'Identifier' &&
          dataMethods.has(callee.property.name)
        ) {
          const method = callee.property.name;
          const obj = callee.object;
          if (
            obj.type === 'MemberExpression' &&
            obj.object &&
            obj.object.type === 'ThisExpression' &&
            obj.property &&
            obj.property.type === 'Identifier'
          ) {
            // this.<prop>.<method>(…)
            callCandidates.push({
              node,
              scope: 'this',
              key: obj.property.name,
              method,
            });
          } else if (obj.type === 'Identifier') {
            // <localIdent>.<method>(…)
            callCandidates.push({
              node,
              scope: 'local',
              key: obj.name,
              method,
            });
          }
        }
      },

      'Program:exit'() {
        for (const cand of callCandidates) {
          const entity =
            cand.scope === 'this'
              ? thisRepoProps.get(cand.key)
              : localRepoVars.get(cand.key);
          if (entity) {
            maybeReport(cand.node, 'call', { entity, method: cand.method });
          }
        }
      },
    };
  },
};
