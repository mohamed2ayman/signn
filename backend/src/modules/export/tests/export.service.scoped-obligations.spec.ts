import { ExportService } from '../export.service';

/**
 * Option B — S2c-1 wire 3a: the generateContractSummary OBLIGATIONS read
 * routes through the Obligation scoped repository
 * (`scopedFind({ contract_id }, orgId)`), underneath the #60/Tier-2 route
 * wall (export.controller assertContractInCallerOrg), which STAYS — two
 * checks, two layers.
 *
 * Red-before/green-after: these probes FAILED against the pre-wire service
 * (the obligations read was a bare `obligationRepository.find({ contract_id })`
 * with no org anywhere; `scopedFind` was never called).
 *
 * NOTE on the cross-tenant red: the route wall fully short-circuits a
 * cross-tenant request at the controller (proven by
 * export.controller.access-wall.spec.ts), so a meaningful end-to-end red is
 * not constructible here. Per the S2c-1 method, this spec instead proves the
 * DATA-LAYER delegation — the obligations load always carries the CALLER's
 * org into the scoped repo, whose org predicate (the real SQL join) is proven
 * independently against real Postgres in
 * scoped-repository/tests/obligation-scoped.s2c1.repository.spec.ts. Even if
 * the wall were bypassed, the scoped load returns only the caller-org's rows.
 */
describe('ExportService.generateContractSummary — S2c-1 scoped obligations read', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const ORG_B = '00000000-0000-0000-0000-00000000000b';
  const CONTRACT_A = '11111111-1111-1111-1111-1111111111a1';

  let contractRepo: any;
  let riskRepo: any;
  let obligationScoped: any;
  let service: ExportService;

  beforeEach(() => {
    contractRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: CONTRACT_A,
        name: 'Contract A',
        contract_type: 'FIDIC_RED_BOOK',
        status: 'ACTIVE',
        created_at: new Date('2026-01-01'),
        project: { name: 'Project A' },
        creator: null,
        contract_clauses: [],
      }),
    };
    riskRepo = { find: jest.fn().mockResolvedValue([]) };
    obligationScoped = {
      scopedFind: jest.fn().mockResolvedValue([
        { id: 'ob-1', status: 'OVERDUE' },
        { id: 'ob-2', status: 'PENDING' },
      ]),
    };
    service = new ExportService(contractRepo, riskRepo, obligationScoped);
  });

  it('routes the obligations read through scopedFind with the CALLER org (json path)', async () => {
    const summary = (await service.generateContractSummary(
      CONTRACT_A,
      ORG_A,
      'json',
    )) as Record<string, any>;

    expect(obligationScoped.scopedFind).toHaveBeenCalledWith(
      { contract_id: CONTRACT_A },
      ORG_A,
    );
    expect(summary.statistics.total_obligations).toBe(2);
    expect(summary.statistics.overdue_obligations).toBe(1);
  });

  it('DATA-LAYER scoping: a different caller org is passed through verbatim — foreign rows excluded by the repo', async () => {
    // What the real scoped repo returns for a foreign-org caller (proven
    // against real Postgres in the S2c-1 repo spec): nothing.
    obligationScoped.scopedFind.mockResolvedValue([]);

    const summary = (await service.generateContractSummary(
      CONTRACT_A,
      ORG_B,
      'json',
    )) as Record<string, any>;

    expect(obligationScoped.scopedFind).toHaveBeenCalledWith(
      { contract_id: CONTRACT_A },
      ORG_B,
    );
    expect(summary.statistics.total_obligations).toBe(0);
    expect(summary.statistics.overdue_obligations).toBe(0);
  });
});
