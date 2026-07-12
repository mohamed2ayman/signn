/**
 * Option B — Lint bucket, PHASE 1 (DISCOVERY, REPORT-ONLY).
 *
 * DEDICATED, ISOLATED ESLint config for the bare-contract-repo discovery rule.
 * It is deliberately SEPARATE from the project's main `lint` script (which
 * currently has no config and carries a dangerous `--fix`). This config:
 *   - enables ONLY the custom `no-bare-contract-repo-access` rule, in `warn`
 *     mode (report-only — never fails the build);
 *   - is run via `npm run lint:contract-repo` with `--no-eslintrc` so it cannot
 *     pick up any ambient config and cannot trigger any other rule;
 *   - applies NO `--fix` and rewrites NO files.
 *
 * PHASE 2 flips the rule to `error`, lands the allowlist annotations, and wires
 * it into the CI gate. Until then this is discovery only.
 *
 * The rule is loaded via `--rulesdir tools/eslint-rules` (see the npm script).
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // NOTE: no `project` — the rule is purely syntactic (no type-checker), so
    // type-aware linting is unnecessary and this stays fast + robust.
  },
  env: { node: true, es2022: true },
  // Ignore ALL inline eslint directives. Two reasons: (1) discovery must not be
  // suppressible by any pre-existing `// eslint-disable` comment in a file; and
  // (2) `--no-eslintrc` means unrelated inline directives (e.g. disabling
  // `@typescript-eslint/no-var-requires`, which this isolated config does not
  // load) would otherwise raise a spurious "rule not found" ERROR and make the
  // run exit non-zero. With this on, the run is cleanly warnings-only.
  noInlineConfig: true,
  // Inventory scope: production source under src/. Spec/test files and build
  // output are excluded — bare repo access in test fixtures is expected and is
  // not what the ban governs. (The report calls out the test-file picture
  // separately.)
  ignorePatterns: [
    'dist/**',
    'node_modules/**',
    'coverage/**',
    '**/*.spec.ts',
    '**/tests/**',
    'test/**',
    'tools/**',
  ],
  rules: {
    // PHASE 2 — ENFORCING (error). The rule's own defaults carry the full
    // contract-scoped entity set and chokepoint scope-exclusions; passed
    // explicitly here so the reviewable surface lives in config. Every flagged
    // production site is now either excluded by scope (category B) or annotated
    // with a `// lint-exempt: <reason>` comment the rule recognises. CI runs
    // this with `--quiet` so the only ESLint output that can appear (and fail
    // the build) is an `error` from THIS rule — a new, un-annotated bare
    // contract-scoped repo access.
    'no-bare-contract-repo-access': [
      'error',
      {
        entities: [
          // ── Tier 1 — known refactor set (scoped repos already exist) ──
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
          // ── Tier 2 — newly discovered: DIRECT contract_id (no scoped repo) ──
          'ContractClause',
          'ComplianceCheck',
          'NegotiationEvent',
          'ContractShare',
          'GuestContractAccess',
          'GuestInvitation',
          'ChatSession', // nullable contract_id (borderline)
          'ChatMessage', // nullable contract_id (borderline)
          // ── Tier 2 — newly discovered: TRANSITIVE child of a scoped parent ──
          'ComplianceFinding',
          'ComplianceReportJob',
          'RiskAnalysisOverrideLog',
          'ObligationAssignee',
          'ObligationReminderLog',
          // ── Multi-tier T0c-1 — contract parties spine ──
          'ContractParty', // direct contract_id
          'ContractPartyContact', // → ContractParty → Contract
          // PartyRole deliberately NOT listed — global registry, no
          // org/contract rooting (ContractRelationshipType class).
        ],
        // Category B — chokepoint internals, excluded by SCOPE (not annotation).
        chokepointPathFragments: [
          'modules/scoped-repository/',
          'modules/contracts/services/contract-access.service.ts',
        ],
      },
    ],
  },
};
