import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';

import { ComplianceFindingService } from '../services/compliance-finding.service';
import {
  ComplianceFinding,
  ComplianceFindingStatus,
} from '../../../database/entities';
import { ComplianceFindingScopedRepository } from '../../scoped-repository/compliance-finding-scoped.repository';

/**
 * Option B — Chokepoint migration (compliance finale): SERVICE-LAYER wiring proof
 * for ComplianceFindingService.updateStatus.
 *
 * The real-PG ComplianceFinding repo spec proves the data-layer denial; THIS spec
 * proves updateStatus ROUTES its by-id finding load through
 * findingScoped.scopedFindByIdOrThrow (with the caller's orgId) BEFORE mutating,
 * that the bare repo is no longer consulted for the load, and that a scoped
 * cross-org denial PROPAGATES (no mutation).
 *
 * RED FORM (stated): pre-wire this called `repo.findOne({ where: { id } })` with
 * NO org filter; with the wall neutralised a cross-org finding would load + save.
 */
describe('ComplianceFindingService — Option B scoped wiring (finale)', () => {
  let service: ComplianceFindingService;

  const ORG = 'org-aaaa';
  const FINDING = 'finding-aaaa';
  const USER = 'user-aaaa';

  const repo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
  const findingScoped = { scopedFindByIdOrThrow: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplianceFindingService,
        { provide: getRepositoryToken(ComplianceFinding), useValue: repo },
        { provide: ComplianceFindingScopedRepository, useValue: findingScoped },
      ],
    }).compile();
    service = module.get(ComplianceFindingService);
  });

  it('routes the by-id finding load through findingScoped.scopedFindByIdOrThrow with the orgId, then saves', async () => {
    findingScoped.scopedFindByIdOrThrow.mockResolvedValue({ id: FINDING, status: ComplianceFindingStatus.OPEN });
    repo.save.mockImplementation(async (f: any) => f);

    const result = await service.updateStatus(
      FINDING,
      ComplianceFindingStatus.ACKNOWLEDGED,
      USER,
      ORG,
    );

    expect(findingScoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(FINDING, ORG);
    // The bare repo is NOT consulted for the by-id load.
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: ComplianceFindingStatus.ACKNOWLEDGED,
      acknowledged_by: USER,
    });
  });

  it('a scoped cross-org denial PROPAGATES (404) — no save', async () => {
    findingScoped.scopedFindByIdOrThrow.mockRejectedValue(
      new NotFoundException('Finding not found'),
    );

    await expect(
      service.updateStatus(FINDING, ComplianceFindingStatus.ACKNOWLEDGED, USER, ORG),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
