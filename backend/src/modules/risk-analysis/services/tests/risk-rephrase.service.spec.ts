import { BadRequestException, NotFoundException } from '@nestjs/common';

import { RiskRephraseService } from '../risk-rephrase.service';

/**
 * Risk-tab rework — STEP 3. Unit proof (mocked repos + mocked transaction) for
 * the AI clause re-phrase flow:
 *   - startRephrase dispatches the AI job with the clause text + recommendation
 *   - null-clause defense: a risk with no linked clause → 400 (never a crash)
 *   - cross-tenant risk → 404 via the findInOrg wall, BEFORE any work
 *   - applyRephrase with no pending proposal → 400
 *   - apply accept promotes via the parent chain (retire original, repoint live
 *     junction, consume proposed junction, clear the risk link)
 *   - apply reject discards the proposal and clears the link (recommendation
 *     stays in place — the CANCELLED state)
 *
 * The parent-chain PROMOTION semantics themselves (FK integrity, version
 * history) are proven against real Postgres for the guest apply path
 * (apply-proposed-version.real-pg.spec.ts) whose model this reuses.
 */
describe('RiskRephraseService — AI clause re-phrase (STEP 3)', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
  const USER = '00000000-0000-0000-0000-0000000000cc';
  const CONTRACT = '00000000-0000-0000-0000-0000000000dd';
  const RISK = '00000000-0000-0000-0000-0000000000ee';
  const ORIG_CC = '00000000-0000-0000-0000-0000000000f1';
  const PROP_CC = '00000000-0000-0000-0000-0000000000f2';
  const ORIG_CLAUSE = '00000000-0000-0000-0000-0000000000f3';
  const PROP_CLAUSE = '00000000-0000-0000-0000-0000000000f4';
  const noop = {} as any;

  const riskRow = (over: any = {}) => ({
    id: RISK,
    contract_id: CONTRACT,
    description: 'risky clause',
    recommendation: 'add a deadline',
    proposed_contract_clause_id: null,
    contract_clause: {
      id: ORIG_CC,
      section_number: '7',
      clause: {
        id: ORIG_CLAUSE,
        title: 'Payment',
        content: 'pay when able',
        version: 1,
        source_document_id: 'doc-general-conditions',
      },
    },
    ...over,
  });

  function build({ risk, findInOrgRejects = false }: { risk: any; findInOrgRejects?: boolean }) {
    const riskRepo = {
      findOne: jest.fn().mockResolvedValue(risk),
    };
    const contractAccess = {
      findInOrg: findInOrgRejects
        ? jest.fn().mockRejectedValue(new NotFoundException('Contract not found'))
        : jest.fn().mockResolvedValue({}),
    };
    const aiService = {
      triggerClauseRephrase: jest.fn().mockResolvedValue({ job_id: 'JOB1', status: 'queued' }),
      getJobStatus: jest.fn(),
    };

    // Transaction-bound repo mocks (accept/reject paths).
    const clauseTxn = { create: jest.fn((x) => x), save: jest.fn(async (x) => x), delete: jest.fn() };
    const ccTxn = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: PROP_CC })),
      update: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn().mockResolvedValue({
        id: PROP_CC,
        clause: { id: PROP_CLAUSE, title: 'Payment', content: 'pay within 28 days', version: 1 },
      }),
    };
    const riskTxn = { update: jest.fn() };
    const managerMock = {
      getRepository: jest.fn((entity: any) => {
        const name = entity?.name ?? entity;
        if (name === 'Clause') return clauseTxn;
        if (name === 'ContractClause') return ccTxn;
        if (name === 'RiskAnalysis') return riskTxn;
        return noop;
      }),
    };
    const ccRepo = {
      manager: { transaction: jest.fn(async (cb: any) => cb(managerMock)) },
      findOne: jest.fn().mockResolvedValue({
        id: PROP_CC,
        clause: { id: PROP_CLAUSE, title: 'Payment', content: 'pay within 28 days' },
      }),
    };
    // Top-level clause repo (used by editProposal — TASK 2).
    const clauseRepo = { save: jest.fn(async (x: any) => x) };

    const Ctor: any = RiskRephraseService;
    const svc: RiskRephraseService = new Ctor(
      riskRepo,
      clauseRepo,
      ccRepo,
      contractAccess,
      aiService,
    );
    return { svc, riskRepo, contractAccess, aiService, clauseRepo, ccRepo, clauseTxn, ccTxn, riskTxn };
  }

  it('startRephrase dispatches the AI job with the clause text + recommendation', async () => {
    const { svc, aiService } = build({ risk: riskRow() });
    const res = await svc.startRephrase(RISK, ORG);
    expect(res.job_id).toBe('JOB1');
    expect(aiService.triggerClauseRephrase).toHaveBeenCalledWith(
      expect.objectContaining({
        clause_text: 'pay when able',
        clause_title: 'Payment',
        risk_description: 'risky clause',
        recommendation: 'add a deadline',
      }),
    );
  });

  it('startRephrase 400s a risk with no linked clause (null-clause defense)', async () => {
    const { svc, aiService } = build({ risk: riskRow({ contract_clause: null }) });
    await expect(svc.startRephrase(RISK, ORG)).rejects.toBeInstanceOf(BadRequestException);
    expect(aiService.triggerClauseRephrase).not.toHaveBeenCalled();
  });

  it('startRephrase 404s a cross-tenant risk BEFORE dispatching', async () => {
    const { svc, aiService, contractAccess } = build({ risk: riskRow(), findInOrgRejects: true });
    await expect(svc.startRephrase(RISK, OTHER_ORG)).rejects.toBeInstanceOf(NotFoundException);
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT, OTHER_ORG);
    expect(aiService.triggerClauseRephrase).not.toHaveBeenCalled();
  });

  it('applyRephrase 400s when there is no pending proposal', async () => {
    const { svc } = build({ risk: riskRow({ proposed_contract_clause_id: null }) });
    await expect(svc.applyRephrase(RISK, 'accept', ORG, USER)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('apply accept promotes via the parent chain and clears the risk link', async () => {
    const { svc, clauseTxn, ccTxn, riskTxn } = build({
      risk: riskRow({ proposed_contract_clause_id: PROP_CC }),
    });
    const res = await svc.applyRephrase(RISK, 'accept', ORG, USER);
    expect(res).toEqual({ applied: true, action: 'accept' });
    // proposed clause promoted (saved) + original retired (saved) → 2 saves
    expect(clauseTxn.save).toHaveBeenCalledTimes(2);
    // live junction repointed at the new clause
    expect(ccTxn.update).toHaveBeenCalledWith({ id: ORIG_CC }, { clause_id: PROP_CLAUSE });
    // proposed junction consumed + risk link cleared + merged_at STAMPED (FIX 1)
    expect(ccTxn.delete).toHaveBeenCalledWith(PROP_CC);
    expect(riskTxn.update).toHaveBeenCalledWith(
      { id: RISK },
      expect.objectContaining({
        proposed_contract_clause_id: null,
        merged_at: expect.any(Date),
      }),
    );
  });

  it('apply reject discards the proposal and clears the link (recommendation stays in place), and does NOT set merged_at', async () => {
    const { svc, clauseTxn, ccTxn, riskTxn } = build({
      risk: riskRow({ proposed_contract_clause_id: PROP_CC }),
    });
    const res = await svc.applyRephrase(RISK, 'reject', ORG, USER);
    expect(res).toEqual({ applied: true, action: 'reject' });
    // discard: delete proposed junction + its clause; clear link; NO promotion save
    expect(ccTxn.delete).toHaveBeenCalledWith(PROP_CC);
    expect(clauseTxn.delete).toHaveBeenCalledWith(PROP_CLAUSE);
    expect(riskTxn.update).toHaveBeenCalledWith({ id: RISK }, { proposed_contract_clause_id: null });
    expect(clauseTxn.save).not.toHaveBeenCalled();
    // FIX 1 — reject must NOT stamp merged_at.
    const rejectUpdate = riskTxn.update.mock.calls[0][1];
    expect(rejectUpdate).not.toHaveProperty('merged_at');
  });

  it('ISOLATION (pre-merge) — pollRephrase creates the proposed clause with source_document_id=NULL + is_proposed=true (excluded from the guest document-scoped panel query)', async () => {
    const { svc, clauseTxn, ccTxn, aiService } = build({
      risk: riskRow({ proposed_contract_clause_id: null }),
    });
    aiService.getJobStatus.mockResolvedValue({
      status: 'completed',
      result: { result: { rewritten_title: 'Payment', rewritten_content: 'pay within 28 days' } },
    });
    const res = await svc.pollRephrase(RISK, 'JOB1', ORG);
    expect(res.status).toBe('completed');
    // Proposed clause: AI-drafted, NULL source doc, inactive until promotion.
    expect(clauseTxn.create).toHaveBeenCalledWith(
      expect.objectContaining({ source_document_id: null, is_active: false }),
    );
    // Junction: is_proposed=true → a `clause.source_document_id = :docId`
    // (guest panel) query can NEVER match it.
    expect(ccTxn.create).toHaveBeenCalledWith(
      expect.objectContaining({ is_proposed: true }),
    );
  });

  it('GROUPING FIX — the promoted clause inherits the original clause source_document_id (so it stays in its file section); the reused junction keeps section_number/order_index', async () => {
    const { svc, clauseTxn, ccTxn } = build({
      risk: riskRow({ proposed_contract_clause_id: PROP_CC }),
    });
    await svc.applyRephrase(RISK, 'accept', ORG, USER);
    // The promoted (proposed) clause was saved carrying the ORIGINAL's
    // source_document_id — NOT left NULL.
    expect(clauseTxn.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PROP_CLAUSE,
        parent_clause_id: ORIG_CLAUSE,
        source_document_id: 'doc-general-conditions',
      }),
    );
    // Position is preserved by REUSING the original junction (only clause_id is
    // repointed) — section_number/order_index on that junction are untouched.
    expect(ccTxn.update).toHaveBeenCalledWith({ id: ORIG_CC }, { clause_id: PROP_CLAUSE });
    expect(ccTxn.delete).toHaveBeenCalledWith(PROP_CC);
  });

  it('TASK 3 — accept with markHandled=true also resolves the risk (APPROVED + handled_by/at)', async () => {
    const { svc, riskTxn } = build({ risk: riskRow({ proposed_contract_clause_id: PROP_CC }) });
    await svc.applyRephrase(RISK, 'accept', ORG, USER, true);
    expect(riskTxn.update).toHaveBeenCalledWith(
      { id: RISK },
      expect.objectContaining({
        merged_at: expect.any(Date),
        status: 'APPROVED',
        handled_by: USER,
        handled_at: expect.any(Date),
      }),
    );
  });

  it('TASK 3 — accept with markHandled=false leaves the risk status untouched', async () => {
    const { svc, riskTxn } = build({ risk: riskRow({ proposed_contract_clause_id: PROP_CC }) });
    await svc.applyRephrase(RISK, 'accept', ORG, USER, false);
    const upd = riskTxn.update.mock.calls[0][1];
    expect(upd).toHaveProperty('merged_at');
    expect(upd).not.toHaveProperty('status');
    expect(upd).not.toHaveProperty('handled_by');
  });

  it('TASK 2 — editProposal persists the edited proposed-clause text (never the live clause)', async () => {
    const { svc, clauseRepo } = build({ risk: riskRow({ proposed_contract_clause_id: PROP_CC }) });
    const res = await svc.editProposal(RISK, { content: 'edited proposed text' }, ORG);
    // The PROPOSED clause was saved with the new content.
    expect(clauseRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: PROP_CLAUSE, content: 'edited proposed text' }),
    );
    expect(res.content).toBe('edited proposed text');
    expect(res.proposed_contract_clause_id).toBe(PROP_CC);
  });

  it('TASK 2 — editProposal 400s when there is no pending proposal', async () => {
    const { svc } = build({ risk: riskRow({ proposed_contract_clause_id: null }) });
    await expect(svc.editProposal(RISK, { content: 'x' }, ORG)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
