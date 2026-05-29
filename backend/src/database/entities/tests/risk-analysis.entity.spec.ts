/**
 * Phase 7.17 — Prompt 1, S.1.
 *
 * Unit tests for the @BeforeInsert / @BeforeUpdate hook on RiskAnalysis
 * (entity-level computed-value pattern per Decision 4 in the plan file).
 *
 * Pure unit tests — no Nest, no DB, no TypeORM lifecycle event runner.
 * We exercise the hook directly because that's the contract we care
 * about: invoking `setRiskScore()` MUST set `risk_score = likelihood ×
 * impact`. TypeORM's framework code that wires the hook to .save() is
 * out of scope here (it's tested implicitly by every save-using test).
 */

import { RiskAnalysis } from '../risk-analysis.entity';

describe('RiskAnalysis entity — setRiskScore hook', () => {
  it('computes risk_score from likelihood × impact', () => {
    const r = new RiskAnalysis();
    r.likelihood = 4;
    r.impact = 5;
    r.setRiskScore();
    expect(r.risk_score).toBe(20);
  });

  it('uses default 3 for undefined likelihood and impact (matches DB DEFAULT)', () => {
    const r = new RiskAnalysis();
    // both fields left undefined
    r.setRiskScore();
    expect(r.risk_score).toBe(9); // 3 × 3
  });

  it('is idempotent — calling twice does not double-multiply', () => {
    const r = new RiskAnalysis();
    r.likelihood = 3;
    r.impact = 4;
    r.setRiskScore();
    expect(r.risk_score).toBe(12);
    r.setRiskScore();
    expect(r.risk_score).toBe(12);
  });

  // Edge cases beyond the plan's 3 — cheap to add, useful for future
  // reviewers seeing the boundary behaviour.
  it('handles minimum L=1, I=1 → score=1', () => {
    const r = new RiskAnalysis();
    r.likelihood = 1;
    r.impact = 1;
    r.setRiskScore();
    expect(r.risk_score).toBe(1);
  });

  it('handles maximum L=5, I=5 → score=25', () => {
    const r = new RiskAnalysis();
    r.likelihood = 5;
    r.impact = 5;
    r.setRiskScore();
    expect(r.risk_score).toBe(25);
  });
});
