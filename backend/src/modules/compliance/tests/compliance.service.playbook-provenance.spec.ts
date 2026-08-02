import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ComplianceService } from '../services/compliance.service';
import {
  ComplianceCheck,
  ComplianceFinding,
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
 * 7.22 Item 4 — playbook_position_id provenance + validation in persistFindings.
 *
 * The echoed id is kept ONLY when it exists (filterExistingIds); an invented id
 * is nulled before insert so the FK never dangles. layer === 'PLAYBOOK' stays
 * the is-playbook signal (Item 3 intact).
 */
describe('ComplianceService — playbook_position_id provenance (persistFindings)', () => {
  let service: ComplianceService;
  let findingRepo: { insert: jest.Mock };
  let checkRepo: { save: jest.Mock };
  let resolver: { filterExistingIds: jest.Mock };

  const SENT = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    findingRepo = { insert: jest.fn().mockResolvedValue(undefined) };
    checkRepo = { save: jest.fn().mockImplementation(async (c) => c) };
    resolver = {
      filterExistingIds: jest.fn().mockResolvedValue(new Set([SENT])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceService,
        { provide: getRepositoryToken(ComplianceCheck), useValue: checkRepo },
        { provide: getRepositoryToken(ComplianceFinding), useValue: findingRepo },
        { provide: getRepositoryToken(Project), useValue: {} },
        { provide: getRepositoryToken(ContractClause), useValue: {} },
        { provide: getRepositoryToken(KnowledgeAssetUsage), useValue: {} },
        { provide: AiService, useValue: {} },
        { provide: ComplianceKnowledgeService, useValue: {} },
        { provide: ComplianceObligationService, useValue: {} },
        { provide: MeteringService, useValue: {} },
        { provide: ContractScopedRepository, useValue: {} },
        { provide: ComplianceCheckScopedRepository, useValue: {} },
        { provide: PlaybookResolverService, useValue: resolver },
      ],
    }).compile();
    service = module.get(ComplianceService);
  });

  const persist = (aiResult: any) =>
    (service as any).persistFindings(
      { id: 'chk', findings_summary: null, overall_status: 'PENDING' },
      aiResult,
    );
  const insertedRows = () => findingRepo.insert.mock.calls[0][0];

  it('2/5. a valid echoed playbook_position_id (in the sent set) persists; layer PLAYBOOK intact', async () => {
    await persist({
      findings: [
        {
          layer: 'PLAYBOOK',
          finding_type: 'PLAYBOOK_DEVIATION',
          severity: 'MEDIUM',
          requirement: 'payment terms 28–45 days',
          playbook_position_id: SENT,
        },
      ],
    });
    const rows = insertedRows();
    expect(rows[0].playbook_position_id).toBe(SENT);
    expect(rows[0].layer).toBe('PLAYBOOK'); // Item 3 signal intact
    expect(resolver.filterExistingIds).toHaveBeenCalledWith([SENT]);
  });

  it('3. an INVENTED playbook_position_id (not in the sent set) is nulled', async () => {
    resolver.filterExistingIds.mockResolvedValue(new Set()); // none valid
    await persist({
      findings: [
        {
          layer: 'PLAYBOOK',
          finding_type: 'PLAYBOOK_DEVIATION',
          severity: 'MEDIUM',
          requirement: 'x',
          playbook_position_id: 'deadbeef-0000-0000-0000-000000000000',
        },
      ],
    });
    expect(insertedRows()[0].playbook_position_id).toBeNull();
  });

  it('4. a finding with NO echoed id → null, findings still persist, resolver not called', async () => {
    await persist({
      findings: [
        {
          layer: 'STANDARD',
          finding_type: 'DEVIATION',
          severity: 'HIGH',
          requirement: 'x',
        },
      ],
    });
    const rows = insertedRows();
    expect(rows[0].playbook_position_id).toBeNull();
    expect(rows[0].layer).toBe('STANDARD');
    expect(resolver.filterExistingIds).not.toHaveBeenCalled();
  });
});
