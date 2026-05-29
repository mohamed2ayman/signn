/**
 * Source of a RiskAnalysis row's likelihood and impact values.
 *
 * Phase 7.17 — Risk Methodology Foundation (B.1).
 *
 * Returned by `RiskMethodologyResolverService.resolveDefaults()` and stored
 * on `RiskAnalysis.likelihood_source` / `RiskAnalysis.impact_source` once
 * the S.1 migration lands. The priority chain (USER_KB_REFERENCE →
 * ORG_LEARNED → PLATFORM_DEFAULT → FALLBACK) is documented in
 * `risk-methodology-resolver.service.ts`. `USER_OVERRIDE` is set by B.3
 * after a user manually edits a finding's L/I values.
 *
 * Defined in this enum file (not on the entity) so B.1 can ship before the
 * S.1 entity update — the resolver and its tests need the enum from day 1.
 */
export enum RiskSourceType {
  /** Org's user-flagged Knowledge Base entry provided the L/I values. */
  USER_KB_REFERENCE = 'USER_KB_REFERENCE',
  /** Org has accumulated ≥10 overrides; median L/I now used as baseline. */
  ORG_LEARNED = 'ORG_LEARNED',
  /** SIGN's platform-owned research default applied (with APA citation). */
  PLATFORM_DEFAULT = 'PLATFORM_DEFAULT',
  /** A user manually edited this finding's L/I (set by B.3 override service). */
  USER_OVERRIDE = 'USER_OVERRIDE',
  /** No reference available — conservative L=3, I=3 returned. */
  FALLBACK = 'FALLBACK',
}
