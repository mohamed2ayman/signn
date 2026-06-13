import { ExportService } from '../export.service';

/**
 * Option B — S2d: both per-contract RISK reads in ExportService route through
 * the RiskAnalysis scoped repository (`scopedFind({ contract_id }, orgId)`),
 * underneath the export controller's findInOrg wall (proven by
 * export.controller.access-wall.spec.ts) — two checks, two layers.
 *
 * Red-before/green-after: these probes FAILED against the pre-S2d service (the
 * risk read was a bare `riskAnalysisRepository.find({ contract_id })` with no
 * org anywhere; `scopedFind` was never called — and the service injected the
 * bare risk repo, not the scoped one). The real SQL org gate is proven
 * independently against real Postgres in
 * scoped-repository/tests/risk-scoped.s2d.repository.spec.ts; even if the wall
 * were bypassed, the scoped load returns only the caller-org's rows.
 *
 * generateRiskReport renders a PDF (no JSON path); its renderer is mocked here
 * so the test exercises the scoped read, not pdfmake (which is independently
 * known-broken — Critical Known Bug #6, out of S2d scope).
 */
describe('ExportService — S2d scoped risk reads', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const ORG_B = '00000000-0000-0000-0000-00000000000b';
  const CONTRACT_A = '11111111-1111-1111-1111-1111111111a1';

  let contractRepo: any;
  let obligationScoped: any;
  let riskScoped: any;
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
    obligationScoped = { scopedFind: jest.fn().mockResolvedValue([]) };
    riskScoped = {
      scopedFind: jest.fn().mockResolvedValue([
        { risk_level: 'HIGH', risk_category: 'X', description: 'd1', recommendation: 'r1' },
        { risk_level: 'LOW', risk_category: 'Y', description: 'd2', recommendation: null },
      ]),
    };
    // ctor order: (contractRepo, obligationScoped, riskScoped)
    service = new ExportService(contractRepo, obligationScoped, riskScoped);
  });

  describe('generateContractSummary (json path — no PDF render)', () => {
    it('routes the risk read through scopedFind with the CALLER org', async () => {
      const summary = (await service.generateContractSummary(
        CONTRACT_A,
        ORG_A,
        'json',
      )) as Record<string, any>;

      expect(riskScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_A },
        ORG_A,
      );
      expect(summary.statistics.total_risks).toBe(2);
      expect(summary.statistics.high_risks).toBe(1);
      expect(summary.statistics.low_risks).toBe(1);
    });

    it('DATA-LAYER scoping: a foreign caller org is passed through verbatim — repo excludes the rows', async () => {
      riskScoped.scopedFind.mockResolvedValue([]);

      const summary = (await service.generateContractSummary(
        CONTRACT_A,
        ORG_B,
        'json',
      )) as Record<string, any>;

      expect(riskScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_A },
        ORG_B,
      );
      expect(summary.statistics.total_risks).toBe(0);
    });
  });

  describe('generateRiskReport (renderer mocked)', () => {
    beforeEach(() => {
      jest
        .spyOn(service as any, 'createPdfBuffer')
        .mockResolvedValue(Buffer.from('%PDF-fake'));
    });

    it('routes the risk read through scopedFind with the CALLER org + created_at order', async () => {
      await service.generateRiskReport(CONTRACT_A, ORG_A);

      expect(riskScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_A },
        ORG_A,
        { order: { created_at: 'DESC' } },
      );
    });

    it('DATA-LAYER scoping: foreign caller org passed verbatim — repo excludes rows', async () => {
      riskScoped.scopedFind.mockResolvedValue([]);

      await service.generateRiskReport(CONTRACT_A, ORG_B);

      expect(riskScoped.scopedFind).toHaveBeenCalledWith(
        { contract_id: CONTRACT_A },
        ORG_B,
        { order: { created_at: 'DESC' } },
      );
    });
  });
});
