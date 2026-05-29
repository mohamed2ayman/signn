/**
 * Phase 7.17 — Prompt 1, A.1.1 unit tests.
 *
 * Pure-function tests for both severity mappers. No Nest, no DI,
 * no DB. Pattern: jest describe/it with table-driven coverage via
 * it.each for the categorical values + edge-case boundary tests
 * for the score mapper.
 */

import { RiskLevel } from '../../../../database/entities';
import {
  mapScoreToRiskLevel,
  mapSeverityToLikelihoodImpact,
} from '../severity-mapping';

describe('mapSeverityToLikelihoodImpact', () => {
  // ── Canonical mappings ────────────────────────────────────────
  it.each([
    ['critical', 4, 5],
    ['high',     3, 5],
    ['medium',   3, 3],
    ['low',      2, 2],
  ])('maps "%s" to L=%i, I=%i', (severity, l, i) => {
    expect(mapSeverityToLikelihoodImpact(severity)).toEqual({ l, i });
  });

  // ── Case-insensitivity (the AI is allowed to return any case) ─
  it.each([
    ['CRITICAL', 4, 5],
    ['High',     3, 5],
    ['MEDIUM',   3, 3],
    ['LoW',      2, 2],
  ])('maps "%s" case-insensitively', (severity, l, i) => {
    expect(mapSeverityToLikelihoodImpact(severity)).toEqual({ l, i });
  });

  // ── Unknown / missing values fall back to MEDIUM ───────────────
  it.each([
    ['unknown_severity'],
    [''],
    [undefined],
    [null],
  ])('falls back to MEDIUM (L=3, I=3) for input %p', (input) => {
    expect(mapSeverityToLikelihoodImpact(input as any)).toEqual({ l: 3, i: 3 });
  });
});

describe('mapScoreToRiskLevel', () => {
  // ── Band boundary tests — exact transitions ───────────────────
  it.each([
    // LOW band: 1-5
    [1, RiskLevel.LOW],
    [5, RiskLevel.LOW],
    // MEDIUM band: 6-14
    [6, RiskLevel.MEDIUM],
    [9, RiskLevel.MEDIUM],
    [14, RiskLevel.MEDIUM],
    // HIGH band: 15-20
    [15, RiskLevel.HIGH],
    [20, RiskLevel.HIGH],
    // CRITICAL band (21-25) collapses into HIGH per Decision 10
    [21, RiskLevel.HIGH],
    [25, RiskLevel.HIGH],
  ])('maps score %i to %s', (score, expected) => {
    expect(mapScoreToRiskLevel(score)).toBe(expected);
  });

  // ── Defensive: out-of-range inputs clamp sensibly ─────────────
  it('maps score 0 (below band) to LOW', () => {
    expect(mapScoreToRiskLevel(0)).toBe(RiskLevel.LOW);
  });

  it('maps negative score to LOW', () => {
    expect(mapScoreToRiskLevel(-5)).toBe(RiskLevel.LOW);
  });

  it('maps score 100 (above band) to HIGH', () => {
    // Demonstrates the high-floor inequality is >= not strict —
    // any score >= 15 is HIGH regardless of upper bound.
    expect(mapScoreToRiskLevel(100)).toBe(RiskLevel.HIGH);
  });
});
