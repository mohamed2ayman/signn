import { applyClauseTypeEdit } from '../clause-type-correction.util';

describe('applyClauseTypeEdit (clause-type correction tracking)', () => {
  it('flips is_type_edited_by_user + snapshots the original on a REAL change', () => {
    const clause = {
      clause_type: 'general',
      original_ai_clause_type: 'general', // set at write time (inline provider)
      is_type_edited_by_user: false,
    };
    applyClauseTypeEdit(clause, 'payment');
    expect(clause.clause_type).toBe('payment'); // new human label applied
    expect(clause.is_type_edited_by_user).toBe(true); // correction flagged
    expect(clause.original_ai_clause_type).toBe('general'); // AI original preserved
  });

  it('does NOT flip on a no-op change (same value)', () => {
    const clause = {
      clause_type: 'payment',
      original_ai_clause_type: 'payment',
      is_type_edited_by_user: false,
    };
    applyClauseTypeEdit(clause, 'payment');
    expect(clause.is_type_edited_by_user).toBe(false); // unchanged
    expect(clause.clause_type).toBe('payment');
    expect(clause.original_ai_clause_type).toBe('payment');
  });

  it('is snapshot-once — a second edit never overwrites the AI original', () => {
    const clause = {
      clause_type: 'general',
      original_ai_clause_type: 'general',
      is_type_edited_by_user: false,
    };
    applyClauseTypeEdit(clause, 'payment'); // human: general -> payment
    applyClauseTypeEdit(clause, 'time'); // human again: payment -> time
    expect(clause.clause_type).toBe('time');
    expect(clause.is_type_edited_by_user).toBe(true);
    expect(clause.original_ai_clause_type).toBe('general'); // still the FIRST AI label
  });

  it('snapshots the pre-edit value when no original exists (older/pre-migration row)', () => {
    const clause: {
      clause_type: string | null;
      original_ai_clause_type?: string | null;
      is_type_edited_by_user?: boolean;
    } = { clause_type: 'liability', original_ai_clause_type: null };
    applyClauseTypeEdit(clause, 'indemnification');
    expect(clause.original_ai_clause_type).toBe('liability'); // captured pre-edit value
    expect(clause.is_type_edited_by_user).toBe(true);
    expect(clause.clause_type).toBe('indemnification');
  });
});
