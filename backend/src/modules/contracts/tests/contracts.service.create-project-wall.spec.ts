import { NotFoundException } from '@nestjs/common';

import { ContractsService } from '../contracts.service';
import { ContractType } from '../../../database/entities';

/**
 * S0 — POST /contracts project→org ownership wall.
 *
 * Pre-fix, `ContractsService.create()` trusted `dto.project_id` and never
 * verified the project belonged to the caller's org — so a user in org A
 * could create a contract under org B's project (proven by the red-before
 * exploit in docs/s0-pre-option-b-fixes.md). The fix loads the project
 * scoped to the caller's org BEFORE insert; cross-tenant → 404 (no existence
 * leak, matching the findInOrg convention).
 *
 * Manual-construction harness, mirroring contracts.service.access-wall.spec.ts.
 */
describe('ContractsService.create — project→org ownership wall (S0)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const PROJECT_OWNED_BY_B = '11111111-1111-1111-1111-1111111111b1';
  const PROJECT_IN_A = '22222222-2222-2222-2222-22222222222a';
  const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const noop = {} as any;

  function build(opts: {
    projectRepository: any;
    contractRepository?: any;
    contractAccess?: any;
  }): ContractsService {
    return new ContractsService(
      opts.contractRepository ?? noop, // contractRepository
      noop, // contractClauseRepository
      noop, // contractVersionRepository
      noop, // contractCommentRepository
      noop, // contractorResponseRepository
      opts.projectRepository, // projectRepository (S0)
      noop, // userRepository
      noop, // contractApproverRepository
      noop, // collaborationGateway
      { instantiateTemplate: jest.fn() } as any, // contractTemplatesService
      noop, // emailService
      opts.contractAccess ?? { findInOrg: jest.fn() }, // contractAccess
      noop, // contractScoped (Option B — unused by create())
    );
  }

  const dtoFor = (projectId: string) =>
    ({
      project_id: projectId,
      name: 'A contract',
      contract_type: ContractType.ADHOC, // non-standard → skips license/template
    }) as any;

  it("cross-tenant: creating under another org's project → 404 BEFORE any insert", async () => {
    // project lookup scoped to org A finds nothing for org B's project.
    const projectRepository = { findOne: jest.fn().mockResolvedValue(null) };
    const contractRepository = { create: jest.fn(), save: jest.fn() };

    const svc = build({ projectRepository, contractRepository });

    await expect(
      svc.create(dtoFor(PROJECT_OWNED_BY_B), USER_ID, ORG_A),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(projectRepository.findOne).toHaveBeenCalledWith({
      where: { id: PROJECT_OWNED_BY_B, organization_id: ORG_A },
      select: ['id'],
    });
    // CRITICAL: the wall fired before any contract row was built or saved.
    expect(contractRepository.create).not.toHaveBeenCalled();
    expect(contractRepository.save).not.toHaveBeenCalled();
  });

  it('happy path: in-org project → contract is created', async () => {
    const projectRepository = {
      findOne: jest.fn().mockResolvedValue({ id: PROJECT_IN_A }),
    };
    const contractRepository = {
      create: jest.fn((x: any) => x),
      save: jest.fn(async (x: any) => ({ ...x, id: 'new-contract' })),
    };
    const contractAccess = {
      findInOrg: jest.fn().mockResolvedValue({ id: 'new-contract' }),
    };

    const svc = build({ projectRepository, contractRepository, contractAccess });
    // createVersionSnapshot makes extra repo calls — spy it out.
    (svc as any).createVersionSnapshot = jest.fn().mockResolvedValue(undefined);

    const result = await svc.create(dtoFor(PROJECT_IN_A), USER_ID, ORG_A);

    expect(projectRepository.findOne).toHaveBeenCalledWith({
      where: { id: PROJECT_IN_A, organization_id: ORG_A },
      select: ['id'],
    });
    expect(contractRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: PROJECT_IN_A }),
    );
    expect(contractRepository.save).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
