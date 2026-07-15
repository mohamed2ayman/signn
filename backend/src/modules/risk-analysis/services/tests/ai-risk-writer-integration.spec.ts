/**
 * Phase 7.17 — Prompt 1, A.1 writer integration tests.
 *
 * Drives the new pollAndSaveRisks + saveAiRiskAsRow + recordUnknownCategory
 * methods on DocumentProcessingService. Mocks the AI job-status response
 * and the resolver, then asserts on the resulting riskAnalysisRepository
 * save calls and audit-log writes.
 *
 * Uses jest fake timers to skip past the 60×3s polling loop without
 * actually waiting 3 minutes per test.
 *
 * Note: this spec lives in risk-analysis/services/tests/ (not
 * document-processing/tests/) so it sits alongside the resolver spec
 * — the integration ultimately exercises the resolver + the writer
 * together, which is conceptually a risk-analysis concern.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';

import {
  AuditLog,
  Clause,
  Contract,
  ContractClause,
  DocumentUpload,
  RiskAnalysis,
  RiskCategory,
  RiskLevel,
  User,
} from '../../../../database/entities';
import { AiService } from '../../../ai/ai.service';
import { StorageService } from '../../../storage/storage.service';
import { DocumentProcessingService } from '../../../document-processing/document-processing.service';
import {
  RiskMethodologyResolverService,
  ResolveDefaultsResult,
} from '../risk-methodology-resolver.service';
import { RiskSourceType } from '../../enums/risk-source-type.enum';
// Tenant-isolation Tier 1 — DocumentProcessingService now injects
// ContractAccessService for uploadAndProcess/reprocess/finalizeReview.
// This integration spec exercises pollAndSaveRisks (background risk-write
// after finalizeReview), so the wall has already fired in the real call
// path; a no-op stub is sufficient here.
import { ContractAccessService } from '../../../contracts/services/contract-access.service';
// Phase 7.18 Part 3 — DocumentProcessingService injects MeteringService.
import { MeteringService } from '../../../metering/services/metering.service';
// Option B — S2f — DocumentProcessingService injects DocumentUploadScopedRepository.
import { DocumentUploadScopedRepository } from '../../../scoped-repository/document-upload-scoped.repository';

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

const ORG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTRACT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLAUSE_ID_1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const CLAUSE_ID_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
// contract_clauses junction ids (Bug-2: risks link by cc.id, NOT clauses.id).
const CONTRACT_CLAUSE_ID_1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
const CONTRACT_CLAUSE_ID_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddd02';
const JOB_ID = 'job-uuid-001';

// ─────────────────────────────────────────────────────────────────────────
// Repo + service mocks
// ─────────────────────────────────────────────────────────────────────────

// Each save() needs to round-trip the entity unchanged so the writer's
// .save() call resolves with the constructed row.
const mockRiskAnalysisRepo = {
  create: jest.fn((row: any) => row),
  save: jest.fn(async (row: any) => ({ ...row, id: 'risk-row-uuid' })),
  // Issue 5 — replace-not-append: pollAndSaveRisks clears prior non-human AI
  // rows before saving a new run.
  delete: jest.fn(async () => ({ affected: 3 })),
};

const mockAuditLogRepo = {
  insert: jest.fn(async () => ({ identifiers: [{ id: 'audit-row-uuid' }] })),
};

// Default: every category lookup returns a match (recognized category).
// Per-test overrides simulate "category not in taxonomy" by returning null.
const mockRiskCategoryRepo = {
  findOne: jest.fn(async (): Promise<any> => ({
    id: 'cat-uuid',
    name: 'Performance Bond',
    is_active: true,
  })),
};

// Bug-2: the writer maps clauses.id -> the contract_clauses junction id via
// findOne({ where: { contract_id, clause_id } }). This mock returns the junction
// for known clauses and null for anything else (the unresolvable-id path).
const CC_JUNCTION_BY_CLAUSE: Record<string, string> = {
  [CLAUSE_ID_1]: CONTRACT_CLAUSE_ID_1,
  [CLAUSE_ID_2]: CONTRACT_CLAUSE_ID_2,
};
const mockContractClauseRepo = {
  findOne: jest.fn(async ({ where }: any) => {
    const id = CC_JUNCTION_BY_CLAUSE[where?.clause_id];
    return id ? { id } : null;
  }),
};

// Stub out the other repos the constructor needs but which the writer
// doesn't touch.
const stubRepo = {} as any;

const mockAiService = {
  getJobStatus: jest.fn(),
  // The writer doesn't call these in tests, but the service constructor
  // expects an AiService — give it method stubs to avoid runtime crashes.
  triggerRiskAnalysis: jest.fn(),
  triggerExtractObligations: jest.fn(),
  triggerConflictDetection: jest.fn(),
} as unknown as AiService;

const mockStorageService = {} as unknown as StorageService;

// Default resolver behaviour: PLATFORM_DEFAULT for any category.
// `jest.fn<ResolveDefaultsResult, ...>` makes the mock's signature
// match the resolver's interface — so per-test overrides can omit
// optional fields like platform_default_ref_id and kb_reference_id
// without TypeScript inferring them as required.
const mockResolver = {
  resolveDefaults: jest.fn<Promise<ResolveDefaultsResult>, [any]>(),
};

// ─────────────────────────────────────────────────────────────────────────
// AI response helpers
// ─────────────────────────────────────────────────────────────────────────

function completedJob(risks: any[]) {
  return { status: 'completed', result: { risks } };
}

function failedJob(error = 'AI backend exploded') {
  return { status: 'failed', error };
}

function pendingJob() {
  return { status: 'pending' };
}

// ─────────────────────────────────────────────────────────────────────────
// Test setup
// ─────────────────────────────────────────────────────────────────────────

describe('AI risk writer — pollAndSaveRisks / saveAiRiskAsRow', () => {
  let service: DocumentProcessingService;
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Restore default resolver behaviour after any per-test override.
    mockResolver.resolveDefaults.mockImplementation(async () => ({
      likelihood: 3,
      impact: 3,
      likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
      impact_source: RiskSourceType.PLATFORM_DEFAULT,
      platform_default_ref_id: 'platform-default-uuid',
    }));
    // Default: category lookup succeeds (recognized category).
    mockRiskCategoryRepo.findOne.mockImplementation(async () => ({
      id: 'cat-uuid',
      name: 'Performance Bond',
      is_active: true,
    }));
    // Bug-2: default junction lookup maps known clause ids -> their cc.id.
    mockContractClauseRepo.findOne.mockImplementation(async ({ where }: any) => {
      const id = CC_JUNCTION_BY_CLAUSE[where?.clause_id];
      return id ? { id } : null;
    });

    // Fake timers — the writer's `await new Promise(setTimeout(...3000))`
    // becomes instant under jest.useFakeTimers + jest.advanceTimersByTime.
    jest.useFakeTimers();

    module = await Test.createTestingModule({
      providers: [
        DocumentProcessingService,
        { provide: getRepositoryToken(DocumentUpload), useValue: stubRepo },
        { provide: getRepositoryToken(Clause), useValue: stubRepo },
        { provide: getRepositoryToken(ContractClause), useValue: mockContractClauseRepo },
        { provide: getRepositoryToken(Contract), useValue: stubRepo },
        { provide: getRepositoryToken(RiskAnalysis), useValue: mockRiskAnalysisRepo },
        { provide: getRepositoryToken(AuditLog), useValue: mockAuditLogRepo },
        { provide: getRepositoryToken(RiskCategory), useValue: mockRiskCategoryRepo },
        { provide: StorageService, useValue: mockStorageService },
        { provide: AiService, useValue: mockAiService },
        { provide: RiskMethodologyResolverService, useValue: mockResolver },
        // Tenant-isolation Tier 1 — see import comment above.
        {
          provide: ContractAccessService,
          useValue: { findInOrg: jest.fn().mockResolvedValue({}) },
        },
        // Phase 7.18 Part 3 — DocumentProcessingService now injects
        // MeteringService. This spec exercises pollAndSaveRisks (which
        // does NOT touch metering), so a no-op stub is sufficient.
        {
          provide: MeteringService,
          useValue: {
            reserve: jest.fn(),
            commit: jest.fn(),
            release: jest.fn(),
          },
        },
        // Option B — S2f: DocumentUploadScopedRepository is now a REQUIRED dep.
        // pollAndSaveRisks does NOT load via the scoped chokepoint, so this stub
        // is never invoked — it only satisfies DI.
        {
          provide: DocumentUploadScopedRepository,
          useValue: { scopedFind: jest.fn(), scopedFindByIdOrThrow: jest.fn() },
        },
        // Guest extraction completion (Slice 1) — DocumentProcessingService now
        // injects the User repo to derive the uploader's account_type. These AI
        // risk-writer paths never reach it; returns MANAGING if ever called.
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn().mockResolvedValue({ account_type: 'MANAGING' }),
          },
        },
      ],
    }).compile();

    service = module.get(DocumentProcessingService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Helper: run pollAndSaveRisks past the polling loop. The writer
  // calls getJobStatus on each iteration after a 3s setTimeout — fake
  // timers let us advance instantly. We use Promise.resolve micro-tasks
  // to give the mock a chance to resolve before each timer tick.
  async function runPollAndSaveRisks() {
    // pollAndSaveRisks is private — invoke via index access.
    const promise = (service as any).pollAndSaveRisks(CONTRACT_ID, JOB_ID, ORG_ID);
    // Advance enough timer cycles to let the loop see the mocked status.
    // Each iteration: setTimeout(3000) → await getJobStatus → check status.
    // Run 105 cycles to safely cover both success-on-first-poll and the
    // 100-poll timeout case (Issue 5 raised the risk poller MAX_POLLS to 100).
    for (let i = 0; i < 105; i++) {
      await Promise.resolve();
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    }
    return promise;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 1 — Happy path: AI returns valid L,I + recognized category
  // ──────────────────────────────────────────────────────────────────────

  it('saves a row with AI L,I and resolver-attributed sources when AI returns valid L,I', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        {
          clause_id: CLAUSE_ID_1,
          risk_category: 'Performance Bond',
          likelihood: 4,
          impact: 5,
          severity: 'high',
          description: 'Performance bond inadequate',
          suggestion: 'Increase to 10% of contract value',
        },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockResolver.resolveDefaults).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      riskCategory: 'Performance Bond',
    });
    expect(mockRiskAnalysisRepo.save).toHaveBeenCalledTimes(1);
    const saved = mockRiskAnalysisRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      contract_id: CONTRACT_ID,
      contract_clause_id: CONTRACT_CLAUSE_ID_1,
      risk_category: 'Performance Bond',
      likelihood: 4,
      impact: 5,
      // Source attribution comes from the resolver, NOT from AI.
      likelihood_source: RiskSourceType.PLATFORM_DEFAULT,
      impact_source: RiskSourceType.PLATFORM_DEFAULT,
      platform_default_ref_id: 'platform-default-uuid',
      // Derived legacy enum from score (4*5=20 → HIGH band)
      risk_level: RiskLevel.HIGH,
      description: 'Performance bond inadequate',
      recommendation: 'Increase to 10% of contract value',
      status: 'OPEN',
    });
    expect(mockAuditLogRepo.insert).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Bug-2 — risk links by contract_clauses.id (FK-valid), not clauses.id
  // ──────────────────────────────────────────────────────────────────────

  it('maps the AI clause_id to the contract_clauses junction id so the FK is satisfied', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        {
          clause_id: CLAUSE_ID_1,
          risk_category: 'Performance Bond',
          likelihood: 3,
          impact: 3,
          description: 'x',
        },
      ]),
    );

    await runPollAndSaveRisks();

    // Looked the junction up by (contract_id, clauses.id) …
    expect(mockContractClauseRepo.findOne).toHaveBeenCalledWith({
      where: { contract_id: CONTRACT_ID, clause_id: CLAUSE_ID_1 },
    });
    const saved = mockRiskAnalysisRepo.save.mock.calls[0][0];
    // … and stored the JUNCTION id (a valid contract_clauses.id), NOT the raw
    // clauses.id that previously violated FK_risk_analyses_clause.
    expect(saved.contract_clause_id).toBe(CONTRACT_CLAUSE_ID_1);
    expect(saved.contract_clause_id).not.toBe(CLAUSE_ID_1);
  });

  it('stores a null contract_clause_id (never an FK crash) when the AI echoes an unresolvable clause id', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        {
          clause_id: 'ffffffff-ffff-4fff-8fff-ffffffffff99', // not a real clause
          risk_category: 'Performance Bond',
          likelihood: 3,
          impact: 3,
          description: 'x',
        },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save).toHaveBeenCalledTimes(1);
    expect(
      mockRiskAnalysisRepo.save.mock.calls[0][0].contract_clause_id,
    ).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 2 — AI returns severity only (no L,I) → severity-mapped + FALLBACK
  // ──────────────────────────────────────────────────────────────────────

  it('falls back to severity mapping with FALLBACK source when AI omits L,I', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        {
          clause_id: CLAUSE_ID_1,
          risk_category: 'Payment Terms',
          severity: 'high',
          description: 'Payment terms vague',
        },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save).toHaveBeenCalledTimes(1);
    const saved = mockRiskAnalysisRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      likelihood: 3, // severity 'high' → L=3
      impact: 5,     // severity 'high' → I=5
      likelihood_source: RiskSourceType.FALLBACK,
      impact_source: RiskSourceType.FALLBACK,
      risk_level: RiskLevel.HIGH, // score 15 → HIGH
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 3 — Unknown category → 'Uncategorized' + audit log
  // ──────────────────────────────────────────────────────────────────────

  it('writes Uncategorized placeholder + audit log when AI returns unknown category', async () => {
    // Category lookup returns null → unrecognized.
    mockRiskCategoryRepo.findOne.mockResolvedValueOnce(null as any);
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        {
          clause_id: CLAUSE_ID_1,
          risk_category: 'Some Made Up Category',
          likelihood: 3,
          impact: 3,
          severity: 'medium',
          description: 'Weird risk',
        },
      ]),
    );
    // Resolver returns FALLBACK for the unknown category.
    mockResolver.resolveDefaults.mockResolvedValueOnce({
      likelihood: 3,
      impact: 3,
      likelihood_source: RiskSourceType.FALLBACK,
      impact_source: RiskSourceType.FALLBACK,
    });

    await runPollAndSaveRisks();

    // Row was saved — finding is preserved per Decision 9.
    expect(mockRiskAnalysisRepo.save).toHaveBeenCalledTimes(1);
    const saved = mockRiskAnalysisRepo.save.mock.calls[0][0];
    // The unknown category becomes 'Uncategorized' for storage; the
    // resolver was still called with the unknown category value so the
    // chain falls through to FALLBACK.
    expect(saved.risk_category).toBe('Uncategorized');

    // Audit log was written with the ORIGINAL attempted category.
    expect(mockAuditLogRepo.insert).toHaveBeenCalledTimes(1);
    expect(mockAuditLogRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AI_RETURNED_UNKNOWN_RISK_CATEGORY',
        entity_type: 'contract',
        entity_id: CONTRACT_ID,
        organization_id: ORG_ID,
        new_values: expect.objectContaining({
          attempted_category: 'Some Made Up Category',
        }),
      }),
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 4 — Malformed AI risk (missing clause_id) → skipped
  // ──────────────────────────────────────────────────────────────────────

  it('skips a finding with no clause_id and logs a warning', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        {
          // no clause_id
          risk_category: 'Termination',
          likelihood: 3,
          impact: 3,
          description: 'No clause id',
        },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 5 — Out-of-range L,I → severity-mapping fallback
  // ──────────────────────────────────────────────────────────────────────

  it('falls back to severity mapping when AI returns out-of-range L (>5)', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        {
          clause_id: CLAUSE_ID_1,
          risk_category: 'Liability Cap',
          likelihood: 6,   // out of range
          impact: 5,
          severity: 'medium',  // fallback target
          description: 'Bad L value',
        },
      ]),
    );

    await runPollAndSaveRisks();

    const saved = mockRiskAnalysisRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      likelihood: 3, // severity 'medium' → L=3
      impact: 3,     // severity 'medium' → I=3
      likelihood_source: RiskSourceType.FALLBACK,
      impact_source: RiskSourceType.FALLBACK,
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 6 — Multi-finding: some valid, some malformed
  // ──────────────────────────────────────────────────────────────────────

  it('saves valid findings and skips malformed ones in the same batch', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        {
          clause_id: CLAUSE_ID_1,
          risk_category: 'Indemnification',
          likelihood: 2,
          impact: 4,
          severity: 'medium',
          description: 'Indemnity overbroad',
        },
        {
          // malformed — missing description
          clause_id: CLAUSE_ID_2,
          risk_category: 'Termination',
          likelihood: 3,
          impact: 3,
        },
      ]),
    );

    await runPollAndSaveRisks();

    // Exactly one row saved (the valid one).
    expect(mockRiskAnalysisRepo.save).toHaveBeenCalledTimes(1);
    expect(mockRiskAnalysisRepo.save.mock.calls[0][0]).toMatchObject({
      contract_clause_id: CONTRACT_CLAUSE_ID_1,
      likelihood: 2,
      impact: 4,
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 7 — Polling times out after 60 polls
  // ──────────────────────────────────────────────────────────────────────

  it('stops polling after MAX_POLLS without writing any rows', async () => {
    // Always pending — never completes.
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(pendingJob());

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save).not.toHaveBeenCalled();
    // Confirm we actually polled the configured 100 times (Issue 5 raised MAX_POLLS).
    expect((mockAiService.getJobStatus as jest.Mock).mock.calls.length).toBe(100);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 8 — Job status returns 'failed' → no writes, early return
  // ──────────────────────────────────────────────────────────────────────

  it('exits cleanly when the AI job reports failure', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      failedJob('Anthropic 503'),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save).not.toHaveBeenCalled();
    expect((mockAiService.getJobStatus as jest.Mock).mock.calls.length).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 9 — Empty risks array (AI ran but found nothing) → early return
  // ──────────────────────────────────────────────────────────────────────

  it('returns cleanly when AI completes with zero risks', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(completedJob([]));

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save).not.toHaveBeenCalled();
    expect((mockAiService.getJobStatus as jest.Mock).mock.calls.length).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Scenario 10 — Audit insert throws → row still saved, warning logged
  // ──────────────────────────────────────────────────────────────────────

  it('still saves the row when the audit-log insert throws', async () => {
    // Setup: AI returns unknown category → writer attempts audit-log →
    // audit insert throws. The writer must still save the risk row.
    mockRiskCategoryRepo.findOne.mockResolvedValueOnce(null as any);
    mockAuditLogRepo.insert.mockRejectedValueOnce(new Error('audit DB down'));
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        {
          clause_id: CLAUSE_ID_1,
          risk_category: 'Some Unknown Cat',
          likelihood: 3,
          impact: 3,
          description: 'Triggers an audit attempt that fails',
        },
      ]),
    );
    mockResolver.resolveDefaults.mockResolvedValueOnce({
      likelihood: 3,
      impact: 3,
      likelihood_source: RiskSourceType.FALLBACK,
      impact_source: RiskSourceType.FALLBACK,
    });

    await runPollAndSaveRisks();

    // The row was still saved despite the audit failure.
    expect(mockRiskAnalysisRepo.save).toHaveBeenCalledTimes(1);
    expect(mockAuditLogRepo.insert).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Issue 5 — REPLACE, not append
  // ──────────────────────────────────────────────────────────────────────

  it('clears previous NON-human AI risks before saving a new run (replace, not append)', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        { clause_id: CLAUSE_ID_1, risk_category: 'Performance Bond', likelihood: 3, impact: 3, description: 'x' },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.delete).toHaveBeenCalledTimes(1);
    expect(mockRiskAnalysisRepo.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        contract_id: CONTRACT_ID,
        is_edited_by_user: false,
        merged_at: IsNull(),
      }),
    );
    expect(mockRiskAnalysisRepo.save).toHaveBeenCalledTimes(1);
  });

  it('preserves human-edited + merged rows — the clear filter excludes them', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        { clause_id: CLAUSE_ID_1, risk_category: 'Performance Bond', likelihood: 3, impact: 3, description: 'x' },
      ]),
    );

    await runPollAndSaveRisks();

    // Human corrections (is_edited_by_user=true) and merges (merged_at set) are
    // OUT of the delete scope, so they survive the re-run.
    const where = (mockRiskAnalysisRepo.delete as jest.Mock).mock.calls[0][0];
    expect(where.is_edited_by_user).toBe(false);
    expect(where.merged_at).toEqual(IsNull());
  });

  it('does NOT clear when the run produced zero risks (degenerate run must not wipe coverage)', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(completedJob([]));

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.delete).not.toHaveBeenCalled();
    expect(mockRiskAnalysisRepo.save).not.toHaveBeenCalled();
  });

  it('clears exactly once per run (no more append-stacking) and saves all new rows', async () => {
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        { clause_id: CLAUSE_ID_1, risk_category: 'Performance Bond', likelihood: 3, impact: 3, description: 'a' },
        { clause_id: CLAUSE_ID_2, risk_category: 'Termination', likelihood: 2, impact: 2, description: 'b' },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.delete).toHaveBeenCalledTimes(1); // one clear
    expect(mockRiskAnalysisRepo.save).toHaveBeenCalledTimes(2); // two fresh rows
  });

  // ──────────────────────────────────────────────────────────────────────
  // Issue 5 — category alias resolver (AI vocab → the 8-row taxonomy)
  // ──────────────────────────────────────────────────────────────────────

  // Simulate the real taxonomy: findOne matches ONLY the 8 canonical rows
  // (case-insensitively), reading the ILike operator's value.
  function useTaxonomyMock() {
    const TAX = [
      'Contractual and Legal Risks',
      'Cost and Payment Risks',
      'Design and Scope Risks',
      'Dispute Resolution Risks',
      'Force Majeure Risks',
      'Performance and Quality Risks',
      'Subcontracting Risks',
      'Time and Delay Risks',
    ];
    mockRiskCategoryRepo.findOne.mockImplementation(async (opts?: any) => {
      const where = opts?.where;
      const name = String(where?.name?.value ?? where?.name ?? '');
      const hit = TAX.find((t) => t.toLowerCase() === name.toLowerCase());
      return hit ? { id: 'cat', name: hit, is_active: true } : null;
    });
  }

  it("aliases the AI's category onto the taxonomy (Payment Terms → Cost and Payment Risks)", async () => {
    useTaxonomyMock();
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        { clause_id: CLAUSE_ID_1, risk_category: 'Payment Terms', likelihood: 3, impact: 3, description: 'x' },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save.mock.calls[0][0].risk_category).toBe('Cost and Payment Risks');
    expect(mockAuditLogRepo.insert).not.toHaveBeenCalled(); // recognized → not audited
  });

  it('is case/space tolerant when aliasing ("  force   MAJEURE " → Force Majeure Risks)', async () => {
    useTaxonomyMock();
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        { clause_id: CLAUSE_ID_1, risk_category: '  force   MAJEURE ', likelihood: 3, impact: 3, description: 'x' },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save.mock.calls[0][0].risk_category).toBe('Force Majeure Risks');
  });

  it('matches an already-canonical taxonomy name directly (case-insensitive)', async () => {
    useTaxonomyMock();
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        { clause_id: CLAUSE_ID_1, risk_category: 'dispute resolution risks', likelihood: 3, impact: 3, description: 'x' },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save.mock.calls[0][0].risk_category).toBe('Dispute Resolution Risks');
  });

  // Issue 5 refinement — the broadened prompt vocabulary (Quality, Scope of
  // Work, Design, Compliance, Defects, Insurance, Subcontracting, Delay,
  // "Contractual") must each alias cleanly onto a taxonomy row so the AI stops
  // returning "Uncategorized" for these common risk kinds.
  it.each([
    ['Quality', 'Performance and Quality Risks'],
    ['Scope of Work', 'Design and Scope Risks'],
    ['Design', 'Design and Scope Risks'],
    ['Compliance', 'Contractual and Legal Risks'],
    ['Contractual', 'Contractual and Legal Risks'],
    ['Defects', 'Performance and Quality Risks'],
    ['Insurance', 'Performance and Quality Risks'],
    ['Subcontracting', 'Subcontracting Risks'],
    ['Delay', 'Time and Delay Risks'],
  ])('aliases broadened-prompt category "%s" → %s', async (aiCategory, expected) => {
    useTaxonomyMock();
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        { clause_id: CLAUSE_ID_1, risk_category: aiCategory, likelihood: 3, impact: 3, description: 'x' },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save.mock.calls[0][0].risk_category).toBe(expected);
    expect(mockAuditLogRepo.insert).not.toHaveBeenCalled(); // recognized → not audited
  });

  it('an unknown category still falls to Uncategorized + audit (safety net kept)', async () => {
    useTaxonomyMock();
    (mockAiService.getJobStatus as jest.Mock).mockResolvedValue(
      completedJob([
        { clause_id: CLAUSE_ID_1, risk_category: 'Totally Made Up', likelihood: 3, impact: 3, description: 'x' },
      ]),
    );

    await runPollAndSaveRisks();

    expect(mockRiskAnalysisRepo.save.mock.calls[0][0].risk_category).toBe('Uncategorized');
    expect(mockAuditLogRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AI_RETURNED_UNKNOWN_RISK_CATEGORY',
        new_values: expect.objectContaining({ attempted_category: 'Totally Made Up' }),
      }),
    );
  });
});
