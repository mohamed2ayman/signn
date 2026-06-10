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
 * PRE-S2c HOTFIX — cross-tenant walls on the plain /obligations/:id surface
 * (routes G–J: GET, PUT, PUT /complete, DELETE).
 *
 * Pre-fix, `findById(id)` loaded the obligation by id with NO org anywhere,
 * and update/complete/delete all fed off it — so an org-A caller could read,
 * mutate, and DELETE an org-B obligation by id. The only pre-fix guard was
 * Phase 7.15 PERMISSION gating, which is not a tenancy boundary (bypass
 * roles skip it).
 *
 * Red-before/green-after: the service below is deliberately built as `any`
 * so this spec RUNS against the pre-fix signature instead of failing to
 * compile — the red run proved the cross-tenant DELETE genuinely executed
 * (repo.remove() was called on the foreign row), not merely a type error.
 *
 * The wall reuses the existing primitive only: after loading the obligation,
 * resolve its contract via ContractAccessService.findInOrg(
 * obligation.contract_id, orgId) — 404 (never 403) on miss, no existence
 * leak. update/complete/delete inherit the gate by flowing through the
 * now-scoped findById; none of them does a bare repo load of its own.
 * Option B S2c later subsumes this into the scoped chokepoint; the wall
 * stays as defense-in-depth.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';
const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
const OBLIGATION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const OBLIGATION_IN_A = {
  id: OBLIGATION_ID,
  contract_id: CONTRACT_IN_A,
  description: 'Submit performance bond',
  status: 'PENDING',
};

const OBLIGATION_IN_B = {
  ...OBLIGATION_IN_A,
  contract_id: CONTRACT_IN_B,
};

/**
 * Mimics the real findInOrg semantics: the only in-org pair is
 * (CONTRACT_IN_A, ORG_A); anything else throws 404.
 */
function buildContractAccess() {
  return {
    findInOrg: jest
      .fn()
      .mockImplementation(async (contractId: string, orgId: string) => {
        if (contractId === CONTRACT_IN_A && orgId === ORG_A) return {};
        throw new NotFoundException('Contract not found');
      }),
  };
}

function buildRepo(row: any) {
  return {
    findOne: jest.fn().mockResolvedValue(row ? { ...row } : null),
    save: jest.fn().mockImplementation(async (o: any) => o),
    remove: jest.fn().mockResolvedValue(undefined),
    create: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

/** Built as `any` so the spec runs (red) against the pre-fix signatures. */
function buildService(repo: any, contractAccess: any): any {
  return new ObligationsService(repo, contractAccess);
}

// ─────────────────────────────────────────────────────────────────────────────
// Service unit — the org wall on findById and its three write inheritors
// ─────────────────────────────────────────────────────────────────────────────

describe('ObligationsService — PRE-S2c walls on the /:id surface (G–J)', () => {
  beforeEach(jest.clearAllMocks);

  // ── G. findById ──────────────────────────────────────────────────────────

  describe('findById()', () => {
    it('CROSS-TENANT READ: org-A caller, org-B obligation → 404, foreign row never returned', async () => {
      const repo = buildRepo(OBLIGATION_IN_B);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      await expect(
        svc.findById(OBLIGATION_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
    });

    it('nonexistent obligation → 404, findInOrg never called', async () => {
      const repo = buildRepo(null);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      await expect(
        svc.findById(OBLIGATION_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });

    it('no-org caller → 404, repo NEVER queried, findInOrg never called', async () => {
      const repo = buildRepo(OBLIGATION_IN_B);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      await expect(
        svc.findById(OBLIGATION_ID, undefined),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repo.findOne).not.toHaveBeenCalled();
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });

    it('happy path: in-org obligation returned, wall consulted', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      const result = await svc.findById(OBLIGATION_ID, ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(result).toMatchObject({ id: OBLIGATION_ID });
    });
  });

  // ── H. update ────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('CROSS-TENANT WRITE: org-A caller, org-B obligation → 404, nothing saved', async () => {
      const repo = buildRepo(OBLIGATION_IN_B);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      await expect(
        svc.update(OBLIGATION_ID, { description: 'hijacked' }, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('happy path: in-org update saves through the gate', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      await svc.update(OBLIGATION_ID, { description: 'amended' }, ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'amended' }),
      );
    });
  });

  // ── I. complete ──────────────────────────────────────────────────────────

  describe('complete()', () => {
    it('CROSS-TENANT WRITE: org-A caller completing org-B obligation → 404, nothing saved', async () => {
      const repo = buildRepo(OBLIGATION_IN_B);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      await expect(
        svc.complete(OBLIGATION_ID, USER_ID, ORG_A, 'https://x.com/e.pdf'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repo.save).not.toHaveBeenCalled();
    });

    it('happy path: in-org completion saves through the gate', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      await svc.complete(OBLIGATION_ID, USER_ID, ORG_A);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'COMPLETED',
          completed_by: USER_ID,
        }),
      );
    });
  });

  // ── J. delete — DESTRUCTIVE ──────────────────────────────────────────────

  describe('delete()', () => {
    it('CROSS-TENANT DELETE: org-A caller deleting org-B obligation → 404, remove NEVER called', async () => {
      const repo = buildRepo(OBLIGATION_IN_B);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      await expect(
        svc.delete(OBLIGATION_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      // The destructive op must never reach the foreign row.
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('happy path: in-org delete removes through the gate', async () => {
      const repo = buildRepo(OBLIGATION_IN_A);
      const contractAccess = buildContractAccess();
      const svc = buildService(repo, contractAccess);

      await svc.delete(OBLIGATION_ID, ORG_A);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_A,
        ORG_A,
      );
      expect(repo.remove).toHaveBeenCalledWith(
        expect.objectContaining({ id: OBLIGATION_ID }),
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Controller HTTP — the orgId threading for the /:id routes
// ─────────────────────────────────────────────────────────────────────────────

describe('ObligationsController — PRE-S2c orgId threading for the /:id routes', () => {
  const mockSvc = {
    findById: jest.fn().mockResolvedValue({ id: OBLIGATION_ID }),
    update: jest.fn().mockResolvedValue({ id: OBLIGATION_ID }),
    complete: jest.fn().mockResolvedValue({ id: OBLIGATION_ID }),
    delete: jest.fn().mockResolvedValue(undefined),
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
            id: USER_ID,
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

  it('GET /obligations/:id threads the caller orgId', async () => {
    await request(app.getHttpServer())
      .get(`/obligations/${OBLIGATION_ID}`)
      .expect(200);

    expect(mockSvc.findById).toHaveBeenCalledWith(OBLIGATION_ID, ORG_A);
  });

  it('PUT /obligations/:id threads the caller orgId', async () => {
    await request(app.getHttpServer())
      .put(`/obligations/${OBLIGATION_ID}`)
      .send({ description: 'Updated' })
      .expect(200);

    expect(mockSvc.update).toHaveBeenCalledWith(
      OBLIGATION_ID,
      expect.objectContaining({ description: 'Updated' }),
      ORG_A,
    );
  });

  it('PUT /obligations/:id/complete threads the caller orgId', async () => {
    await request(app.getHttpServer())
      .put(`/obligations/${OBLIGATION_ID}/complete`)
      .send({ evidence_url: 'https://x.com/e.pdf' })
      .expect(200);

    expect(mockSvc.complete).toHaveBeenCalledWith(
      OBLIGATION_ID,
      USER_ID,
      ORG_A,
      'https://x.com/e.pdf',
    );
  });

  it('DELETE /obligations/:id threads the caller orgId', async () => {
    await request(app.getHttpServer())
      .delete(`/obligations/${OBLIGATION_ID}`)
      .expect(200);

    expect(mockSvc.delete).toHaveBeenCalledWith(OBLIGATION_ID, ORG_A);
  });
});
