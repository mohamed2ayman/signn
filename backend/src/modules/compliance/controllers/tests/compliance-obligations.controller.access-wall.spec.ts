import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ComplianceObligationsController } from '../compliance-obligations.controller';
import { IcalExportService } from '../../services/ical-export.service';
import { ComplianceObligationService } from '../../services/compliance-obligation.service';
import { ContractAccessService } from '../../../contracts/services/contract-access.service';
import { ObligationScopedRepository } from '../../../scoped-repository/obligation-scoped.repository';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { PermissionLevelGuard } from '../../../../common/guards/permission-level.guard';
import {
  Obligation,
  User,
  UserRole,
  AccountType,
  JobTitle,
  PermissionLevel,
} from '../../../../database/entities';

/**
 * S0 — INTERIM Class-C bypass-role wall on
 * `GET /contracts/:contractId/obligations` (ComplianceObligationsController.
 * listForContract).
 *
 * Pre-fix, the endpoint built an unscoped query
 * (`o.contract_id = :contractId`) with no org check. Because
 * PermissionLevelGuard lets bypass-roles (OWNER_ADMIN/SYSTEM_ADMIN/OPERATIONS)
 * through, a bypass-role caller in org A could list org B's obligations.
 *
 * The wall (assertContractInCallerOrg → findInOrg) is keyed on the caller's
 * org, not role, so it fires regardless of role. Option B will absorb this
 * via the scoped repository chokepoint.
 */
describe('ComplianceObligationsController.listForContract — Class-C wall (S0)', () => {
  let controller: ComplianceObligationsController;
  let contractAccess: jest.Mocked<ContractAccessService>;
  let qb: any;
  let obligationRepo: any;

  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_OWNED_BY_B = '11111111-1111-1111-1111-1111111111b1';
  const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';

  // Bypass-role caller (OWNER_ADMIN) — has already cleared PermissionLevelGuard.
  const ownerAdminInOrgA: User = {
    id: 'owner-admin-a',
    organization_id: ORG_A,
    email: 'owner@a.com',
    role: UserRole.OWNER_ADMIN,
    account_type: AccountType.MANAGING,
    job_title: JobTitle.CONTRACTS_MANAGER,
    permission_level: PermissionLevel.EDITOR,
    is_active: true,
  } as unknown as User;

  beforeEach(async () => {
    qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'ob-1' }]),
    };
    obligationRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };

    contractAccess = {
      findInOrg: jest.fn(),
    } as unknown as jest.Mocked<ContractAccessService>;

    // The controller carries class-level @UseGuards — override them so the
    // TestingModule doesn't try to resolve their repo deps. Guards are not
    // exercised in these direct controller-method unit tests anyway.
    const passGuard = { canActivate: () => true };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ComplianceObligationsController],
      providers: [
        { provide: getRepositoryToken(Obligation), useValue: obligationRepo },
        { provide: IcalExportService, useValue: {} },
        { provide: ComplianceObligationService, useValue: {} },
        { provide: ContractAccessService, useValue: contractAccess },
        // S2c-1 — new controller dep (ical scoped load); not exercised here.
        { provide: ObligationScopedRepository, useValue: { scopedFind: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(passGuard)
      .overrideGuard(RolesGuard)
      .useValue(passGuard)
      .overrideGuard(PermissionLevelGuard)
      .useValue(passGuard)
      .compile();

    controller = module.get(ComplianceObligationsController);
  });

  it('BYPASS-ROLE PROBE: OWNER_ADMIN in org A listing org B\'s contract → 404, NO query built', async () => {
    contractAccess.findInOrg.mockRejectedValue(
      new NotFoundException('Contract not found'),
    );

    await expect(
      controller.listForContract(CONTRACT_OWNED_BY_B, {} as any, ownerAdminInOrgA),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(contractAccess.findInOrg).toHaveBeenCalledWith(
      CONTRACT_OWNED_BY_B,
      ORG_A,
    );
    // CRITICAL: no obligation query was built on the cross-tenant path.
    expect(obligationRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('no-org caller (organization_id null) → 404, findInOrg NEVER called', async () => {
    const orphan = { ...ownerAdminInOrgA, organization_id: null };

    await expect(
      controller.listForContract(CONTRACT_OWNED_BY_B, {} as any, orphan as any),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    expect(obligationRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('happy path: in-org caller → obligations listed', async () => {
    contractAccess.findInOrg.mockResolvedValue({} as any);

    const result = await controller.listForContract(
      CONTRACT_IN_A,
      {} as any,
      ownerAdminInOrgA,
    );

    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    expect(obligationRepo.createQueryBuilder).toHaveBeenCalled();
    expect(qb.where).toHaveBeenCalledWith('o.contract_id = :contractId', {
      contractId: CONTRACT_IN_A,
    });
    expect(result).toEqual([{ id: 'ob-1' }]);
  });
});
