import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { ObligationsController } from '../obligations.controller';
import { ObligationsService } from '../obligations.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { PermissionLevelGuard } from '../../../common/guards/permission-level.guard';

/**
 * Standalone hotfix (pre-S2d) — cross-tenant WRITE wall on
 * `POST /obligations` → `ObligationsService.create()`.
 *
 * THE GAP (live on main @ 8f42e0e): create() inserted an obligation from a
 * body-supplied `contract_id` with NO contract-in-org check. The
 * `ResolveObligationProjectMiddleware` only reads `req.params` (the create
 * route carries contract_id in the BODY), so it never resolves a project_id;
 * `PermissionLevelGuard` then finds no projectId and falls through
 * (`return true`), and admins bypass it outright. Result: any authenticated
 * EDITOR+ caller could create an obligation against ANOTHER org's contract —
 * a live cross-tenant write.
 *
 * THE WALL: before the insert, resolve `dto.contract_id` via
 * `ContractAccessService.findInOrg(dto.contract_id, orgId)` — the same
 * primitive used by the #60 hotfix and the S2c-2 by-id mutation surface.
 * Cross-tenant → 404 (never 403, no existence leak). The caller's orgId is
 * threaded from the controller via `@OrganizationId()`.
 *
 * Red-before/green-after: against the pre-fix service the assertions below
 * failed (foreign-contract insert SUCCEEDED — save was called, no throw; the
 * controller called create() with a single arg). The `(svc as any).create`
 * cast keeps THIS EXACT spec compiling across the signature change so the
 * red→green flip is driven solely by the production code.
 *
 * Scope: create() ONLY. The by-id mutation surface (update/complete/delete)
 * is already walled via findById (S2c-2) and is untouched here.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
// Valid v4 UUIDs (version nibble 4, variant nibble a) — the controller POST
// body flows through `@IsUUID()` on CreateObligationDto.contract_id.
const CONTRACT_IN_A = '22222222-2222-4222-a222-2222222222a2';
const CONTRACT_IN_B = '11111111-1111-4111-a111-1111111111b1';

const noop = {} as any;

function build({
  obligationRepository,
  contractAccess,
}: {
  obligationRepository: any;
  contractAccess: any;
}): ObligationsService {
  // Ctor: (obligationRepository, contractAccess, obligationScoped). The
  // create() path under test never touches the scoped repo; a noop satisfies
  // the signature (same idiom as the sibling wall specs).
  const Ctor: any = ObligationsService;
  return new Ctor(obligationRepository, contractAccess, noop);
}

// ─────────────────────────────────────────────────────────────────────────────
// Service unit — the org wall on create()
// ─────────────────────────────────────────────────────────────────────────────

describe('ObligationsService.create — cross-tenant write wall', () => {
  beforeEach(jest.clearAllMocks);

  it('cross-tenant: findInOrg denies → 404, NOTHING inserted', async () => {
    const obligationRepository = {
      create: jest.fn((x) => x),
      save: jest.fn().mockResolvedValue({ id: 'should-never-exist' }),
    };
    const contractAccess = {
      findInOrg: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Contract not found')),
    };

    const svc = build({ obligationRepository, contractAccess });

    await expect(
      (svc as any).create(
        { contract_id: CONTRACT_IN_B, description: 'Foreign-org obligation' },
        ORG_A,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The wall runs BEFORE the insert, keyed on the body's contract_id.
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
    // Cross-tenant write blocked: neither the repo .create nor .save ran.
    expect(obligationRepository.create).not.toHaveBeenCalled();
    expect(obligationRepository.save).not.toHaveBeenCalled();
  });

  it('in-org: findInOrg passes → obligation inserted with PENDING status', async () => {
    const saved = { id: 'new-obl', status: 'PENDING' };
    const obligationRepository = {
      create: jest.fn((x) => x),
      save: jest.fn().mockResolvedValue(saved),
    };
    const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

    const svc = build({ obligationRepository, contractAccess });

    const result = await (svc as any).create(
      { contract_id: CONTRACT_IN_A, description: 'In-org obligation' },
      ORG_A,
    );

    // The wall is consulted with the in-org contract + caller org.
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    // …and the insert proceeds unchanged.
    expect(obligationRepository.save).toHaveBeenCalledTimes(1);
    expect(obligationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contract_id: CONTRACT_IN_A,
        status: 'PENDING',
      }),
    );
    expect(result).toBe(saved);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Controller HTTP — orgId threading on POST /obligations
// ─────────────────────────────────────────────────────────────────────────────

describe('ObligationsController — POST /obligations threads caller orgId', () => {
  const mockSvc = {
    create: jest.fn().mockResolvedValue({ id: 'new-obl' }),
  };

  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ObligationsController],
      providers: [{ provide: ObligationsService, useValue: mockSvc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = {
            id: 'user-uuid-1',
            role: 'OWNER_ADMIN',
            organization_id: ORG_A,
          };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionLevelGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(jest.clearAllMocks);

  it('passes @OrganizationId() as the second arg to create()', async () => {
    await request(app.getHttpServer())
      .post('/obligations')
      .send({ contract_id: CONTRACT_IN_A, description: 'Pay milestone 1' })
      .expect(201);

    expect(mockSvc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contract_id: CONTRACT_IN_A,
        description: 'Pay milestone 1',
      }),
      ORG_A,
    );
  });
});
