import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { AiController } from '../ai.controller';
import { AiService } from '../ai.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Tenant-isolation Tier 1 — controller-level access-wall spec for the
 * contract-scoped AI dispatch endpoints. Same class as PR #42 / #45 —
 * a managing user in org A must NOT be able to forward an `body.contract_id`
 * belonging to org B into the AI backend (cross-tenant AI spend +
 * data-poisoning class).
 *
 * Pre-fix, every test below would FAIL the `not.toHaveBeenCalled()`
 * assertion: the AiService was called for the foreign contract because
 * no contract-access check existed. The red-before evidence is recorded
 * in docs/tenant-isolation-tier1.md.
 */
describe('AiController — cross-tenant access wall (Tier 1)', () => {
  let controller: AiController;
  let ai: jest.Mocked<AiService>;
  let contractAccess: jest.Mocked<ContractAccessService>;

  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';

  beforeEach(async () => {
    ai = {
      triggerRiskAnalysis: jest.fn(),
      triggerSummarize: jest.fn(),
      triggerExtractObligations: jest.fn(),
      triggerConflictDetection: jest.fn(),
      triggerChat: jest.fn(),
      triggerDiffAnalysis: jest.fn(),
      triggerResearch: jest.fn(),
      getJobStatus: jest.fn(),
      ingestEmbedding: jest.fn(),
      searchEmbeddings: jest.fn(),
    } as unknown as jest.Mocked<AiService>;

    contractAccess = {
      findInOrg: jest.fn(),
    } as unknown as jest.Mocked<ContractAccessService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: AiService, useValue: ai },
        { provide: ContractAccessService, useValue: contractAccess },
      ],
    }).compile();

    controller = module.get(AiController);
  });

  // ────────────────────────────────────────────────────────────────────
  // The four mandatory-contract_id endpoints share the same wall shape.
  // Use describe.each so the assertions are uniform across them.
  // ────────────────────────────────────────────────────────────────────
  describe.each([
    [
      'POST /ai/risk-analysis (triggerRiskAnalysis)',
      (c: AiController, body: any, orgId: string) =>
        c.triggerRiskAnalysis(body, orgId),
      'triggerRiskAnalysis' as const,
      {
        contract_id: CONTRACT_IN_B,
        clauses: [{ id: 'clause-1', text: 'attacker-supplied text' }],
      },
    ],
    [
      'POST /ai/summarize (triggerSummarize)',
      (c: AiController, body: any, orgId: string) =>
        c.triggerSummarize(body, orgId),
      'triggerSummarize' as const,
      { contract_id: CONTRACT_IN_B, full_text: 'attacker payload' },
    ],
    [
      'POST /ai/extract-obligations (triggerExtractObligations)',
      (c: AiController, body: any, orgId: string) =>
        c.triggerExtractObligations(body, orgId),
      'triggerExtractObligations' as const,
      {
        contract_id: CONTRACT_IN_B,
        clauses: [{ id: 'clause-1', text: 'foo' }],
      },
    ],
    [
      'POST /ai/detect-conflicts (triggerConflictDetection)',
      (c: AiController, body: any, orgId: string) =>
        c.triggerConflictDetection(body, orgId),
      'triggerConflictDetection' as const,
      {
        contract_id: CONTRACT_IN_B,
        clauses: [{ id: 'clause-1', text: 'foo' }],
      },
    ],
  ])('%s', (_label, invoke, aiMethodName, body) => {
    it('cross-tenant: 404 and AiService is NEVER called', async () => {
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(invoke(controller, body, ORG_A)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      // No AI spend on a cross-tenant probe.
      expect(ai[aiMethodName]).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller, AI dispatch fires', async () => {
      contractAccess.findInOrg.mockResolvedValue({} as any);
      (ai[aiMethodName] as jest.Mock).mockResolvedValue({
        job_id: 'job-1',
        status: 'queued',
      });

      const result = await invoke(
        controller,
        { ...body, contract_id: 'contract-in-a' },
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(ai[aiMethodName]).toHaveBeenCalled();
      expect(result).toEqual({ job_id: 'job-1', status: 'queued' });
    });

    it('no-org caller is denied with 404; findInOrg is never called', async () => {
      await expect(
        invoke(controller, body, '' as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(ai[aiMethodName]).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // POST /ai/chat — contract_id OPTIONAL. Wall only fires when present.
  // ────────────────────────────────────────────────────────────────────
  describe('POST /ai/chat (triggerChat) — conditional wall', () => {
    it('cross-tenant with contract_id: 404 and AiService NEVER called', async () => {
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(
        controller.triggerChat(
          { message: 'hi', contract_id: CONTRACT_IN_B },
          ORG_A,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(ai.triggerChat).not.toHaveBeenCalled();
    });

    it('no contract_id (unscoped chat): wall is skipped, AI dispatch fires', async () => {
      (ai.triggerChat as jest.Mock).mockResolvedValue({
        job_id: 'job-1',
        status: 'queued',
      });

      const result = await controller.triggerChat({ message: 'hi' }, ORG_A);

      // Unscoped chat must not gate behind contract-access (Tier 1
      // scope decision — surfaced in docs/tenant-isolation-tier1.md).
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(ai.triggerChat).toHaveBeenCalled();
      expect(result).toEqual({ job_id: 'job-1', status: 'queued' });
    });

    it('in-org contract_id: wall passes, AI dispatch fires', async () => {
      contractAccess.findInOrg.mockResolvedValue({} as any);
      (ai.triggerChat as jest.Mock).mockResolvedValue({
        job_id: 'job-1',
        status: 'queued',
      });

      await controller.triggerChat(
        { message: 'hi', contract_id: 'contract-in-a' },
        ORG_A,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(ai.triggerChat).toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // OUT-OF-SCOPE endpoints — confirm they do NOT call the wall. These
  // routes carry no contract_id (diff/research/embeddings) or take a
  // jobId (jobs/:jobId). Including them here documents the deliberate
  // exclusion from Tier 1.
  // ────────────────────────────────────────────────────────────────────
  describe('out-of-scope endpoints — wall is NOT called', () => {
    it('/ai/diff: no contract_id, no wall call', async () => {
      (ai.triggerDiffAnalysis as jest.Mock).mockResolvedValue({
        job_id: 'j',
        status: 'queued',
      });
      await controller.triggerDiffAnalysis({
        original_clauses: [],
        modified_clauses: [],
      });
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });

    it('/ai/research: no contract_id, no wall call', async () => {
      (ai.triggerResearch as jest.Mock).mockResolvedValue({
        job_id: 'j',
        status: 'queued',
      });
      await controller.triggerResearch({ keywords: ['fidic'] });
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });
  });
});
