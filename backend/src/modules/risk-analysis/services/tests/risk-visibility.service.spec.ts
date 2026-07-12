import { BadRequestException, NotFoundException } from '@nestjs/common';

import { RiskVisibilityService } from '../risk-visibility.service';

/**
 * Unit proof (mocked repos) for the visible-set authority:
 *   - completeness counts ONLY the visible top-2 per clause (hidden never
 *     required); a swap override changes which risks must be verified
 *   - setVisibility validates exactly-2 distinct LIVE ids of the clause, walls
 *     the contract, and persists
 */
describe('RiskVisibilityService', () => {
  const ORG = 'org-1';
  const USER = 'user-1';
  const CONTRACT = 'contract-1';
  const CLAUSE = 'clause-1';

  const risk = (id: string, level: string, edited: boolean, over: any = {}) => ({
    id,
    contract_id: CONTRACT,
    contract_clause_id: CLAUSE,
    risk_level: level,
    description: id,
    is_deleted: false,
    is_edited_by_user: edited,
    ...over,
  });

  function build(opts: {
    scoped?: any[];
    overrides?: any[];
    clauseRisks?: any[];
    findInOrgRejects?: boolean;
  }) {
    const visRepo = {
      find: jest.fn().mockResolvedValue(opts.overrides ?? []),
      upsert: jest.fn().mockResolvedValue(undefined),
      findOneOrFail: jest.fn().mockResolvedValue({ contract_clause_id: CLAUSE, visible_risk_ids: [] }),
    };
    const riskRepo = { find: jest.fn().mockResolvedValue(opts.clauseRisks ?? []) };
    const riskScoped = { scopedFind: jest.fn().mockResolvedValue(opts.scoped ?? []) };
    const contractAccess = {
      findInOrg: opts.findInOrgRejects
        ? jest.fn().mockRejectedValue(new NotFoundException('Contract not found'))
        : jest.fn().mockResolvedValue({}),
    };
    const Ctor: any = RiskVisibilityService;
    const svc: RiskVisibilityService = new Ctor(visRepo, riskRepo, riskScoped, contractAccess);
    return { svc, visRepo, riskRepo, riskScoped, contractAccess };
  }

  it('getCompleteness counts ONLY the visible top-2 (2 HIGH visible, 1 MEDIUM hidden); one visible unverified → incomplete', async () => {
    const { svc } = build({
      scoped: [
        risk('h1', 'HIGH', true), // visible + verified
        risk('h2', 'HIGH', false), // visible + NOT verified
        risk('m1', 'MEDIUM', false), // hidden (not counted)
      ],
    });
    const res = await svc.getCompleteness(CONTRACT, ORG);
    expect(res.visible_total).toBe(2);
    expect(res.visible_verified).toBe(1);
    expect(res.visible_unverified).toBe(1);
    expect(res.hidden_total).toBe(1);
    expect(res.complete).toBe(false);
    expect(res.incomplete_clause_ids).toEqual([CLAUSE]);
  });

  it('soft-deleted risks are excluded from completeness entirely', async () => {
    const { svc } = build({
      scoped: [
        risk('h1', 'HIGH', true),
        risk('h2', 'HIGH', true),
        risk('x', 'MEDIUM', false, { is_deleted: true }), // ignored
      ],
    });
    const res = await svc.getCompleteness(CONTRACT, ORG);
    expect(res.visible_total).toBe(2);
    expect(res.hidden_total).toBe(0);
    expect(res.complete).toBe(true);
  });

  it('a swap override changes which risks are visible (the swapped-in must be verified)', async () => {
    const { svc } = build({
      scoped: [
        risk('h1', 'HIGH', true),
        risk('h2', 'HIGH', true),
        risk('m1', 'MEDIUM', false), // normally hidden…
      ],
      overrides: [{ contract_clause_id: CLAUSE, visible_risk_ids: ['h1', 'm1'] }], // …but swapped IN
    });
    const res = await svc.getCompleteness(CONTRACT, ORG);
    // Visible now = {h1(verified), m1(unverified)} → incomplete; h2 becomes hidden.
    expect(res.visible_total).toBe(2);
    expect(res.visible_verified).toBe(1);
    expect(res.hidden_total).toBe(1);
    expect(res.complete).toBe(false);
  });

  it('setVisibility rejects a non-2 or duplicate id set', async () => {
    const { svc } = build({ clauseRisks: [risk('a', 'HIGH', false), risk('b', 'HIGH', false)] });
    await expect(svc.setVisibility(CLAUSE, ['a'], ORG, USER)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.setVisibility(CLAUSE, ['a', 'a'], ORG, USER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setVisibility rejects an id that is not a live risk of the clause', async () => {
    const { svc } = build({ clauseRisks: [risk('a', 'HIGH', false), risk('b', 'HIGH', false)] });
    await expect(svc.setVisibility(CLAUSE, ['a', 'zzz'], ORG, USER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setVisibility 404s a cross-tenant clause BEFORE persisting', async () => {
    const { svc, visRepo } = build({
      clauseRisks: [risk('a', 'HIGH', false), risk('b', 'HIGH', false)],
      findInOrgRejects: true,
    });
    await expect(svc.setVisibility(CLAUSE, ['a', 'b'], ORG, USER)).rejects.toBeInstanceOf(NotFoundException);
    expect(visRepo.upsert).not.toHaveBeenCalled();
  });

  it('setVisibility persists a valid 2-id swap', async () => {
    const { svc, visRepo } = build({ clauseRisks: [risk('a', 'HIGH', false), risk('b', 'MEDIUM', false)] });
    await svc.setVisibility(CLAUSE, ['a', 'b'], ORG, USER);
    expect(visRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ contract_clause_id: CLAUSE, visible_risk_ids: ['a', 'b'], updated_by: USER }),
      ['contract_clause_id'],
    );
  });
});
