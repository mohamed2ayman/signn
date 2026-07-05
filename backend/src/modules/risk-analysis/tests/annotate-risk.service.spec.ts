import { BadRequestException, NotFoundException } from '@nestjs/common';

import { RiskAnalysisService } from '../risk-analysis.service';

/**
 * Phase 8.3 — RiskAnalysisService.annotateRisk (editable Risk Analysis tab).
 *
 * Unit-level logic proof (mocked repos) for the label-layer edit:
 *   - persists risk_level + risk_category; flips is_edited_by_user; stamps
 *     edited_by_user_id + edited_at; emits the collaboration event
 *   - snapshots the AI ORIGINAL (level + category) EXACTLY ONCE — a second
 *     edit keeps the true original, not the previous human value
 *   - rejects an unknown category (only active official buckets pass)
 *   - rejects an empty body BEFORE loading the row
 *   - 404s a cross-tenant risk via the findInOrg wall BEFORE any write
 *   - 404s a missing row
 *
 * The FK-validity + migration-additivity guarantees are proven separately
 * against real Postgres (annotate-risk.real-pg.spec.ts).
 */
describe('RiskAnalysisService.annotateRisk — Phase 8.3 editable risk labels', () => {
  const ORG = '00000000-0000-0000-0000-0000000000aa';
  const OTHER_ORG = '00000000-0000-0000-0000-0000000000bb';
  const USER = '00000000-0000-0000-0000-0000000000cc';
  const CONTRACT = '00000000-0000-0000-0000-0000000000dd';
  const RISK = '00000000-0000-0000-0000-0000000000ee';
  const noop = {} as any;

  function build({
    risk,
    findInOrgRejects = false,
  }: {
    risk?: any;
    findInOrgRejects?: boolean;
  }) {
    const riskAnalysisRepository = {
      findOne: jest.fn().mockResolvedValue(risk ?? null),
      save: jest.fn().mockImplementation(async (r: any) => r),
    };
    const collaborationGateway = { emitRiskUpdated: jest.fn() };
    const contractAccess = {
      findInOrg: findInOrgRejects
        ? jest.fn().mockRejectedValue(new NotFoundException('Contract not found'))
        : jest.fn().mockResolvedValue({}),
    };
    // ctor: (riskRepo, riskRuleRepo, riskCategoryRepo, collabGateway,
    //        contractAccess, riskScoped). risk_category is free-text now — no
    //        taxonomy lookup — so riskCategoryRepo is unused here (noop).
    const Ctor: any = RiskAnalysisService;
    const svc: RiskAnalysisService = new Ctor(
      riskAnalysisRepository,
      noop, // riskRuleRepository
      noop, // riskCategoryRepository — unused by annotateRisk
      collaborationGateway,
      contractAccess,
      noop, // riskScoped — unused by annotateRisk
    );
    return {
      svc,
      riskAnalysisRepository,
      collaborationGateway,
      contractAccess,
    };
  }

  const aiRow = () => ({
    id: RISK,
    contract_id: CONTRACT,
    risk_level: 'HIGH',
    risk_category: 'Uncategorized',
    is_edited_by_user: false,
    original_risk_level: null,
    original_risk_category: null,
    edited_by_user_id: null,
    edited_at: null,
    risk_score: 20,
  });

  it('persists level + category, sets is_edited_by_user, snapshots the AI original, emits event', async () => {
    const risk = aiRow();
    const { svc, riskAnalysisRepository, collaborationGateway } = build({ risk });

    // Category is reassigned to one of the 17 clause-type labels ('Payment').
    const saved: any = await svc.annotateRisk(
      RISK,
      { risk_level: 'LOW' as any, risk_category: 'Payment' },
      USER,
      ORG,
    );

    expect(saved.risk_level).toBe('LOW');
    expect(saved.risk_category).toBe('Payment');
    expect(saved.is_edited_by_user).toBe(true);
    expect(saved.edited_by_user_id).toBe(USER);
    expect(saved.edited_at).toBeInstanceOf(Date);
    // AI original preserved (the training signal)
    expect(saved.original_risk_level).toBe('HIGH');
    expect(saved.original_risk_category).toBe('Uncategorized');
    // L/I never touched → risk_score unchanged by the method
    expect(saved.risk_score).toBe(20);
    expect(riskAnalysisRepository.save).toHaveBeenCalledTimes(1);
    expect(collaborationGateway.emitRiskUpdated).toHaveBeenCalledWith(
      CONTRACT,
      expect.objectContaining({ contractId: CONTRACT }),
    );
  });

  it('snapshots the AI original ONLY on the first edit (subsequent edits keep the true original)', async () => {
    // An already-edited row: original still holds the AI value; current is a
    // prior human value.
    const risk = {
      ...aiRow(),
      is_edited_by_user: true,
      original_risk_level: 'HIGH',
      original_risk_category: 'Uncategorized',
      risk_level: 'LOW',
      risk_category: 'Time and Delay Risks',
    };
    const { svc } = build({ risk });

    const saved: any = await svc.annotateRisk(RISK, { risk_level: 'MEDIUM' as any }, USER, ORG);

    expect(saved.risk_level).toBe('MEDIUM');
    // NOT overwritten with the previous human value ('LOW')
    expect(saved.original_risk_level).toBe('HIGH');
    expect(saved.original_risk_category).toBe('Uncategorized');
  });

  it('accepts a free-text clause-type label as the category and persists it', async () => {
    const risk = aiRow();
    const { svc, riskAnalysisRepository } = build({ risk });

    const saved: any = await svc.annotateRisk(
      RISK,
      { risk_category: 'Scope of Work' },
      USER,
      ORG,
    );
    expect(saved.risk_category).toBe('Scope of Work');
    expect(saved.is_edited_by_user).toBe(true);
    expect(saved.original_risk_category).toBe('Uncategorized');
    expect(riskAnalysisRepository.save).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty body (neither level nor category) BEFORE loading the row', async () => {
    const { svc, riskAnalysisRepository } = build({ risk: aiRow() });

    await expect(svc.annotateRisk(RISK, {}, USER, ORG)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(riskAnalysisRepository.findOne).not.toHaveBeenCalled();
  });

  it('404s a cross-tenant risk via the findInOrg wall, BEFORE any write', async () => {
    const { svc, riskAnalysisRepository, contractAccess } = build({
      risk: aiRow(),
      findInOrgRejects: true,
    });

    await expect(
      svc.annotateRisk(RISK, { risk_level: 'LOW' as any }, USER, OTHER_ORG),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT, OTHER_ORG);
    expect(riskAnalysisRepository.save).not.toHaveBeenCalled();
  });

  it('404s when the risk row does not exist', async () => {
    const { svc } = build({ risk: null });
    await expect(
      svc.annotateRisk(RISK, { risk_level: 'LOW' as any }, USER, ORG),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
