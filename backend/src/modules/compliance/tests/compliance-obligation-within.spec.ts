import { ComplianceObligationService } from '../services/compliance-obligation.service';

// Phase 7.17 Prompt 2a — regression coverage for the new `within` param on
// getPortfolio(). Asserts that omitting `within` reproduces the exact prior
// behaviour (no due_date clauses), and that `within` translates to from/to.

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeQbSpy() {
  const andWhereCalls: Array<{ clause: string; params: any }> = [];
  const qb: any = {
    leftJoinAndSelect: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn((clause: string, params: any) => {
      andWhereCalls.push({ clause, params });
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    getMany: jest.fn(async () => []),
  };
  return { qb, andWhereCalls };
}

function serviceWith(qb: any) {
  const obligationRepo: any = { createQueryBuilder: jest.fn(() => qb) };
  // Only obligationRepo is used by getPortfolio; the other repos and the
  // S2c-2 scoped repo are never touched on this path.
  return new ComplianceObligationService(
    obligationRepo,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

const dueClauses = (calls: Array<{ clause: string }>) =>
  calls.filter((c) => c.clause.includes('due_date'));

describe('ComplianceObligationService.getPortfolio — `within` param', () => {
  it('no `within`, no from/to → NO due_date clauses (identical to pre-2a behaviour)', async () => {
    const { qb, andWhereCalls } = makeQbSpy();
    await serviceWith(qb).getPortfolio(ORG, {});
    expect(dueClauses(andWhereCalls)).toHaveLength(0);
  });

  it('existing from/to still applied exactly when `within` is absent', async () => {
    const { qb, andWhereCalls } = makeQbSpy();
    await serviceWith(qb).getPortfolio(ORG, { from: '2026-03-01', to: '2026-03-31' });
    const from = andWhereCalls.find((c) => c.clause.includes('due_date >='));
    const to = andWhereCalls.find((c) => c.clause.includes('due_date <='));
    expect(from?.params.from).toBe('2026-03-01');
    expect(to?.params.to).toBe('2026-03-31');
  });

  it('`within=14` → adds today..today+14 due_date clauses', async () => {
    const { qb, andWhereCalls } = makeQbSpy();
    await serviceWith(qb).getPortfolio(ORG, { within: 14 });
    const from = andWhereCalls.find((c) => c.clause.includes('due_date >='));
    const to = andWhereCalls.find((c) => c.clause.includes('due_date <='));
    expect(from).toBeDefined();
    expect(to).toBeDefined();
    const diffDays = Math.round(
      (new Date(to!.params.to).getTime() - new Date(from!.params.from).getTime()) /
        86_400_000,
    );
    expect(diffDays).toBe(14);
  });

  it('explicit from/to win over `within` (within ignored when either is present)', async () => {
    const { qb, andWhereCalls } = makeQbSpy();
    await serviceWith(qb).getPortfolio(ORG, {
      within: 14,
      from: '2026-01-01',
      to: '2026-01-31',
    });
    const from = andWhereCalls.find((c) => c.clause.includes('due_date >='));
    const to = andWhereCalls.find((c) => c.clause.includes('due_date <='));
    expect(from?.params.from).toBe('2026-01-01');
    expect(to?.params.to).toBe('2026-01-31');
  });
});
