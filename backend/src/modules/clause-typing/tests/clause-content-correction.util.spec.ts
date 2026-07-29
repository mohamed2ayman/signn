import { applyClauseContentEdit } from '../clause-content-correction.util';

describe('applyClauseContentEdit (clause-content provenance tracking — Fix #3)', () => {
  it('flips is_content_edited_by_user + snapshots the original on a REAL change', () => {
    const clause = {
      content: 'AI-extracted clause text v1', // set at write time (extraction)
      original_ai_content: 'AI-extracted clause text v1',
      is_content_edited_by_user: false,
    };
    applyClauseContentEdit(clause, 'human-corrected clause text');
    expect(clause.content).toBe('human-corrected clause text'); // new human text applied
    expect(clause.is_content_edited_by_user).toBe(true); // correction flagged
    expect(clause.original_ai_content).toBe('AI-extracted clause text v1'); // AI original preserved
  });

  it('does NOT flip on a no-op change (same value)', () => {
    const clause = {
      content: 'unchanged text',
      original_ai_content: 'unchanged text',
      is_content_edited_by_user: false,
    };
    applyClauseContentEdit(clause, 'unchanged text');
    expect(clause.is_content_edited_by_user).toBe(false); // unchanged
    expect(clause.content).toBe('unchanged text');
    expect(clause.original_ai_content).toBe('unchanged text');
  });

  it('is snapshot-once — a second edit never overwrites the AI original', () => {
    const clause = {
      content: 'the rate is 9/15', // the AI reconstruction (from OCR garble)
      original_ai_content: 'the rate is 9/15',
      is_content_edited_by_user: false,
    };
    applyClauseContentEdit(clause, 'the rate is 15%'); // human: 9/15 -> 15%
    applyClauseContentEdit(clause, 'the rate is fifteen percent'); // human again
    expect(clause.content).toBe('the rate is fifteen percent');
    expect(clause.is_content_edited_by_user).toBe(true);
    expect(clause.original_ai_content).toBe('the rate is 9/15'); // still the FIRST AI text
  });

  it('snapshots the pre-edit value when no original exists (older/pre-migration row)', () => {
    const clause: {
      content: string;
      original_ai_content?: string | null;
      is_content_edited_by_user?: boolean;
    } = { content: 'legacy clause text', original_ai_content: null };
    applyClauseContentEdit(clause, 'edited legacy text');
    expect(clause.original_ai_content).toBe('legacy clause text'); // captured pre-edit value
    expect(clause.is_content_edited_by_user).toBe(true);
    expect(clause.content).toBe('edited legacy text');
  });

  it('extraction write shape: original_ai_content == content, flag == false (mirrors writeClausesInTx), and a later human edit preserves that extraction snapshot', () => {
    // Mirror how writeClausesInTx creates a clause at extraction time.
    const extracted = {
      content: 'raw AI extraction',
      original_ai_content: 'raw AI extraction', // = content at creation
      is_content_edited_by_user: false, // never edited yet
    };
    expect(extracted.original_ai_content).toBe(extracted.content);
    expect(extracted.is_content_edited_by_user).toBe(false);

    // A human then corrects it — the extraction snapshot must survive verbatim.
    applyClauseContentEdit(extracted, 'reviewer-corrected extraction');
    expect(extracted.original_ai_content).toBe('raw AI extraction'); // extraction snapshot intact
    expect(extracted.is_content_edited_by_user).toBe(true);
    expect(extracted.content).toBe('reviewer-corrected extraction');
  });
});
