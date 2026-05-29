import { RiskLevel } from '../../../database/entities';

/**
 * Phase 7.17 — Prompt 1, A.1.
 *
 * Two pure mappers used by the AI risk writer
 * (`document-processing.service.ts#pollAndSaveRisks`):
 *
 *  - `mapSeverityToLikelihoodImpact` — when the AI returns only the
 *    legacy `severity` field (no L/I), derive PMBOK L,I per the
 *    conservative mapping. Identical rule to B.6 backfill except
 *    the AI's `'critical'` value (which the existing DB enum
 *    doesn't have) is mapped to (4, 5) — score 20, top of HIGH band.
 *    See plan Decision 8 + the CRITICAL clarification for why A.1
 *    and B.6 don't conflict despite mapping different sources.
 *
 *  - `mapScoreToRiskLevel` — derive the legacy `risk_level` enum
 *    value from the PMBOK score. Per Decision 10, the legacy column
 *    stays populated for backward compatibility with UI badges,
 *    exports, and dashboard-analytics queries that haven't migrated
 *    to `risk_score`. The CRITICAL band (21-25) maps to HIGH because
 *    the enum has only LOW/MEDIUM/HIGH — a lossy mapping that the
 *    L,I columns recover for any consumer that cares.
 *
 * Pure functions, no DI, easy to unit-test.
 */

/** Band boundaries pulled from the operator's spec for traceability. */
const SCORE_HIGH_FLOOR = 15;   // 15-20 HIGH band + 21-25 CRITICAL band
const SCORE_MEDIUM_FLOOR = 6;  // 6-14 MEDIUM band

/**
 * Map the legacy 4-level severity string to PMBOK L, I. Conservative
 * mapping — same rule as B.6 backfill except CRITICAL.
 *
 * Unknown / missing severity defaults to MEDIUM (L=3, I=3). The
 * function intentionally never throws — the caller treats the
 * fallback as if the AI returned a malformed severity.
 */
export function mapSeverityToLikelihoodImpact(
  severity: string | undefined | null,
): { l: number; i: number } {
  const lower = (severity ?? 'medium').toLowerCase();
  switch (lower) {
    case 'critical':
      return { l: 4, i: 5 }; // score 20 — top of HIGH band
    case 'high':
      return { l: 3, i: 5 }; // score 15 — bottom of HIGH band
    case 'low':
      return { l: 2, i: 2 }; // score 4 — middle of LOW band
    case 'medium':
    default:
      return { l: 3, i: 3 }; // score 9 — middle of MEDIUM band
  }
}

/**
 * Map a PMBOK risk_score (1-25) to the legacy 3-level RiskLevel
 * enum. Per Decision 10, this lets writers continue populating the
 * `risk_level` column for backward compat. The CRITICAL band (21-25)
 * maps to HIGH because the enum has no CRITICAL value — consumers
 * that want CRITICAL granularity must read `risk_score` directly.
 *
 * Out-of-range inputs (score < 1 or score > 25) are clamped into a
 * sensible band: anything < 6 lands at LOW; anything ≥ 6 follows the
 * normal banding. Strictly speaking the @BeforeInsert hook prevents
 * out-of-range scores from existing on the entity, but defensive
 * input-handling keeps the function safe to call from any caller.
 */
export function mapScoreToRiskLevel(score: number): RiskLevel {
  if (score >= SCORE_HIGH_FLOOR) return RiskLevel.HIGH;
  if (score >= SCORE_MEDIUM_FLOOR) return RiskLevel.MEDIUM;
  return RiskLevel.LOW;
}
