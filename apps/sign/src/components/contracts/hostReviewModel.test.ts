import { describe, it, expect } from 'vitest';
import {
  buildReviewModel,
  buildApplyDto,
  tallyDecisions,
  categoryMeta,
  type ReviewStatus,
} from './hostReviewModel';
import type { ContractClause, VersionDiffChange } from '@/types';

// Minimal ContractClause factory (only the fields the model reads).
const cc = (
  id: string,
  clause_id: string,
  section_number: string | null,
  clause: Partial<ContractClause['clause']> = {},
): ContractClause =>
  ({
    id,
    contract_id: 'k1',
    clause_id,
    section_number,
    order_index: 0,
    customizations: null,
    created_at: '',
    clause: { id: clause_id, title: '', content: '', ...clause } as ContractClause['clause'],
  }) as ContractClause;

const proposed = [
  cc('pj1', 'pc1', '4', { title: 'Payment', content: 'new', clause_type: 'payment', confidence_score: 0.95 }),
  cc('pj2', 'pc2', '46', { title: 'Cyber', content: 'added', clause_type: 'compliance', confidence_score: 0.83 }),
  cc('pj3', 'pc3', '1', { title: 'Scope', content: 'same', confidence_score: 0.9 }),
];
const live = [
  cc('lj1', 'lc1', '4', { title: 'Payment', content: 'old', clause_type: 'payment' }),
  cc('lj3', 'lc3', '1', { title: 'Scope', content: 'same' }),
  cc('lj9', 'lc9', '27', { title: 'Arbitration', content: 'removed text' }),
];
const changes: VersionDiffChange[] = [
  {
    clauseId: 'pc1',
    clauseNumber: '4',
    clauseTitle: 'Payment',
    changeType: 'MODIFIED',
    originalText: 'old',
    newText: 'new',
    wordLevelDiff: [
      { value: 'old', removed: true },
      { value: 'new', added: true },
    ],
  },
  { clauseId: 'pc2', clauseNumber: '46', clauseTitle: 'Cyber', changeType: 'ADDED', originalText: null, newText: 'added', wordLevelDiff: null },
  { clauseId: 'lc9', clauseNumber: '27', clauseTitle: 'Arbitration', changeType: 'REMOVED', originalText: 'removed text', newText: null, wordLevelDiff: null },
  { clauseId: 'pc3', clauseNumber: '1', clauseTitle: 'Scope', changeType: 'UNCHANGED', originalText: 'same', newText: 'same', wordLevelDiff: null },
];

describe('buildReviewModel', () => {
  const model = buildReviewModel(changes, proposed, live);

  it('partitions changed vs unchanged with correct counts', () => {
    expect(model.counts).toEqual({ modified: 1, added: 1, removed: 1, unchanged: 1 });
    expect(model.totalClauses).toBe(4);
    expect(model.unchanged.map((u) => u.id)).toEqual(['pj3']);
    expect(model.allProposedClauseIds).toEqual(['pj1', 'pj2', 'pj3']);
  });

  it('MODIFIED maps proposed junction id + live replaces id, carries confidence', () => {
    const m = model.changed.find((c) => c.kind === 'modify')!;
    expect(m.proposedContractClauseId).toBe('pj1');
    expect(m.replacesContractClauseId).toBe('lj1'); // matched by section "4"
    expect(m.confidence).toBe(0.95);
    expect(m.wordLevelDiff).not.toBeNull();
  });

  it('ADDED maps proposed junction id with NO replaces', () => {
    const a = model.changed.find((c) => c.kind === 'add')!;
    expect(a.proposedContractClauseId).toBe('pj2');
    expect(a.replacesContractClauseId).toBeNull();
    expect(a.proposedText).toBe('added');
  });

  it('REMOVED maps the live junction id as removal target', () => {
    const r = model.changed.find((c) => c.kind === 'remove')!;
    expect(r.id).toBe('lj9');
    expect(r.removalContractClauseId).toBe('lj9');
    expect(r.originalText).toBe('removed text');
  });
});

describe('buildApplyDto', () => {
  const model = buildReviewModel(changes, proposed, live);
  const statuses: Record<string, ReviewStatus> = {
    pj1: 'accepted', // modify accepted
    pj2: 'merged', // add merged with host text
    lj9: 'accepted', // removal accepted
  };
  const dto = buildApplyDto(model.changed, statuses, { pj2: 'host edited text' }, model.allProposedClauseIds, 'sum');

  it('accept-modify carries replaces_contract_clause_id', () => {
    const d = dto.decisions.find((x) => x.proposed_contract_clause_id === 'pj1')!;
    expect(d.action).toBe('accept');
    expect(d.replaces_contract_clause_id).toBe('lj1');
  });

  it('merge carries action edit + edited_content (no replaces for ADD)', () => {
    const d = dto.decisions.find((x) => x.proposed_contract_clause_id === 'pj2')!;
    expect(d.action).toBe('edit');
    expect(d.edited_content).toBe('host edited text');
    expect(d.replaces_contract_clause_id).toBeUndefined();
  });

  it('accepted removal goes to removals[], not decisions', () => {
    expect(dto.removals).toEqual([{ contract_clause_id: 'lj9', action: 'accept' }]);
    expect(dto.decisions.some((d) => d.proposed_contract_clause_id === 'lj9')).toBe(false);
  });

  it('unchanged proposed duplicate (pj3) is auto-rejected to consume the version', () => {
    const d = dto.decisions.find((x) => x.proposed_contract_clause_id === 'pj3')!;
    expect(d.action).toBe('reject');
  });

  it('rejected removal is omitted (clause kept)', () => {
    const dto2 = buildApplyDto(model.changed, { lj9: 'rejected', pj1: 'rejected', pj2: 'rejected' }, {}, model.allProposedClauseIds);
    expect(dto2.removals).toBeUndefined();
    // pj1/pj2 rejected → reject decisions; pj3 auto-reject. No accept/edit anywhere.
    expect(dto2.decisions.every((d) => d.action === 'reject')).toBe(true);
  });
});

describe('tallyDecisions', () => {
  it('counts host-facing decisions over the changed set', () => {
    const model = buildReviewModel(changes, proposed, live);
    const t = tallyDecisions(model.changed, { pj1: 'accepted', pj2: 'merged', lj9: 'rejected' });
    expect(t).toEqual({ accepted: 1, merged: 1, rejected: 1, pending: 0, applyCount: 2 });
  });
});

describe('categoryMeta', () => {
  it('maps known types and falls back to General', () => {
    expect(categoryMeta('payment').label).toBe('Payment');
    expect(categoryMeta(null)).toEqual({ label: 'General', color: '#8A93A0' });
    expect(categoryMeta('scope_of_work').label).toBe('Scope');
  });
});
