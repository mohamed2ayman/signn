import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ComplianceService } from '../services/compliance.service';
import {
  ComplianceCheck,
  ComplianceFinding,
  ComplianceFindingLayer,
  ComplianceFindingSeverity,
  ContractClause,
  KnowledgeAssetUsage,
  Project,
} from '../../../database/entities';
import { AiService } from '../../ai/ai.service';
import { MeteringService } from '../../metering/services/metering.service';
import { ComplianceKnowledgeService } from '../services/compliance-knowledge.service';
import { ComplianceObligationService } from '../services/compliance-obligation.service';
import { ContractScopedRepository } from '../../scoped-repository/contract-scoped.repository';
import { ComplianceCheckScopedRepository } from '../../scoped-repository/compliance-check-scoped.repository';
import { PlaybookResolverService } from '../../playbook/playbook-resolver.service';

/**
 * Item 3 — layer-aware overall_status + separate playbook_status axis, the
 * NestJS fallback path (deriveOverall + derivePlaybookStatus).
 *
 * This is the summary-LESS fallback used when the agent omits a summary. It
 * MUST compute identically to the agent's _recompute_summary — the six cases
 * below mirror test_playbook_layer_status.py exactly (no Python/TS drift).
 */
describe('ComplianceService — layer-aware overall_status + playbook_status (fallback)', () => {
  let service: ComplianceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: getRepositoryToken(ComplianceCheck), useValue: {} },
        { provide: getRepositoryToken(ComplianceFinding), useValue: {} },
        { provide: getRepositoryToken(Project), useValue: {} },
        { provide: getRepositoryToken(ContractClause), useValue: {} },
        { provide: getRepositoryToken(KnowledgeAssetUsage), useValue: {} },
        { provide: AiService, useValue: {} },
        { provide: ComplianceKnowledgeService, useValue: {} },
        { provide: ComplianceObligationService, useValue: {} },
        { provide: MeteringService, useValue: {} },
        { provide: ContractScopedRepository, useValue: {} },
        { provide: ComplianceCheckScopedRepository, useValue: {} },
        { provide: PlaybookResolverService, useValue: {} },
      ],
    }).compile();
    service = module.get(ComplianceService);
  });

  const L = ComplianceFindingLayer;
  const S = ComplianceFindingSeverity;
  const overall = (f: any[]) => (service as any).deriveOverall(f);
  const playbook = (f: any[]) => (service as any).derivePlaybookStatus(f);

  it('7. only a CRITICAL PLAYBOOK finding → overall COMPLIANT, playbook MAJOR_DEVIATIONS', () => {
    const f = [{ layer: L.PLAYBOOK, severity: S.CRITICAL }];
    expect(overall(f)).toBe('COMPLIANT');
    expect(playbook(f)).toBe('MAJOR_DEVIATIONS');
  });

  it('8. only LOW/MEDIUM PLAYBOOK findings → COMPLIANT, MINOR_DEVIATIONS', () => {
    const f = [
      { layer: L.PLAYBOOK, severity: S.LOW },
      { layer: L.PLAYBOOK, severity: S.MEDIUM },
    ];
    expect(overall(f)).toBe('COMPLIANT');
    expect(playbook(f)).toBe('MINOR_DEVIATIONS');
  });

  it('9. INFO-only PLAYBOOK finding → COMPLIANT, MINOR_DEVIATIONS (the locked edge)', () => {
    const f = [{ layer: L.PLAYBOOK, severity: S.INFO }];
    expect(overall(f)).toBe('COMPLIANT');
    expect(playbook(f)).toBe('MINOR_DEVIATIONS');
  });

  it('10. legal HIGH, no PLAYBOOK → PARTIALLY_COMPLIANT, ON_STANDARD', () => {
    const f = [{ layer: L.JURISDICTION, severity: S.HIGH }];
    expect(overall(f)).toBe('PARTIALLY_COMPLIANT');
    expect(playbook(f)).toBe('ON_STANDARD');
  });

  it('11. legal CRITICAL → NON_COMPLIANT (guard: legal detection NOT weakened)', () => {
    const f = [{ layer: L.STANDARD, severity: S.CRITICAL }];
    expect(overall(f)).toBe('NON_COMPLIANT');
    expect(playbook(f)).toBe('ON_STANDARD');
  });

  it('12. mixed legal CRITICAL + PLAYBOOK MEDIUM → NON_COMPLIANT, playbook independent MINOR_DEVIATIONS', () => {
    const f = [
      { layer: L.CONFLICT, severity: S.CRITICAL },
      { layer: L.PLAYBOOK, severity: S.MEDIUM },
    ];
    expect(overall(f)).toBe('NON_COMPLIANT');
    expect(playbook(f)).toBe('MINOR_DEVIATIONS');
  });

  it('summarize() carries playbook_status in the fallback summary object', () => {
    const f = [{ layer: L.PLAYBOOK, severity: S.HIGH }];
    const summary = (service as any).summarize(f);
    expect(summary.playbook_status).toBe('MAJOR_DEVIATIONS');
    expect(summary).toHaveProperty('by_layer');
    expect(summary).toHaveProperty('by_severity');
  });
});
