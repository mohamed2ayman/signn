import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { ComplianceController } from '../compliance.controller';
import { ComplianceService } from '../../services/compliance.service';
import { ComplianceFindingService } from '../../services/compliance-finding.service';
import { ComplianceReportService } from '../../services/compliance-report.service';
import { ContractAccessService } from '../../../contracts/services/contract-access.service';
import {
  User,
  UserRole,
  AccountType,
  JobTitle,
  PermissionLevel,
} from '../../../../database/entities';
import { ComplianceFindingStatus } from '../../../../database/entities';

/**
 * STEP 2 — cross-tenant access wall spec.
 *
 * Same class as PR #42 / commit 54a3959 — a managing user from org A must
 * NOT be able to run / read / mutate compliance checks on a contract in
 * org B. Pre-fix, all seven endpoints on `contracts/:contractId/compliance-checks`
 * carried only JwtAuthGuard and the service layer loaded the contract by
 * id with NO org filter; cross-tenant access was permitted silently.
 *
 * This spec proves the wall fires by exercising the controller directly
 * with mocked services. For every endpoint:
 *   - Cross-tenant: ContractAccessService.findInOrg() throws NotFoundException;
 *     the controller surfaces 404 BEFORE the underlying service method runs
 *     (we assert the service mock was NOT called).
 *   - Happy path: ContractAccessService.findInOrg() resolves; the underlying
 *     service method runs as before.
 *
 * The cross-tenant assertion would FAIL against the pre-fix controller —
 * see the "red-before reasoning" section at the bottom of this file.
 */

describe('ComplianceController — cross-tenant access wall (PR #42 class)', () => {
  let controller: ComplianceController;
  let compliance: jest.Mocked<ComplianceService>;
  let findings: jest.Mocked<ComplianceFindingService>;
  let reports: jest.Mocked<ComplianceReportService>;
  let contractAccess: jest.Mocked<ContractAccessService>;

  // ─── Test fixtures ────────────────────────────────────────────────────
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const ORG_B = '00000000-0000-0000-0000-00000000000b';
  const CONTRACT_OWNED_BY_B = '11111111-1111-1111-1111-1111111111b1';
  const CHECK_ON_B_CONTRACT = '22222222-2222-2222-2222-2222222222b2';
  const FINDING_ON_B_CHECK = '33333333-3333-3333-3333-3333333333b3';

  const userInOrgA: User = {
    id: 'user-in-org-a',
    organization_id: ORG_A,
    email: 'usera@example.com',
    role: UserRole.OWNER_ADMIN,
    account_type: AccountType.MANAGING,
    job_title: JobTitle.CONTRACTS_MANAGER,
    permission_level: PermissionLevel.EDITOR,
    is_active: true,
  } as unknown as User;

  beforeEach(async () => {
    compliance = {
      runCheck: jest.fn(),
      listForContract: jest.fn(),
      refreshFromAi: jest.fn(),
      getDetail: jest.fn(),
      getContractIdForCheck: jest.fn(),
    } as unknown as jest.Mocked<ComplianceService>;

    findings = {
      updateStatus: jest.fn(),
      getContractIdForFinding: jest.fn(),
    } as unknown as jest.Mocked<ComplianceFindingService>;

    reports = {
      request: jest.fn(),
    } as unknown as jest.Mocked<ComplianceReportService>;

    contractAccess = {
      findInOrg: jest.fn(),
    } as unknown as jest.Mocked<ContractAccessService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ComplianceController],
      providers: [
        { provide: ComplianceService, useValue: compliance },
        { provide: ComplianceFindingService, useValue: findings },
        { provide: ComplianceReportService, useValue: reports },
        { provide: ContractAccessService, useValue: contractAccess },
      ],
    }).compile();

    controller = module.get(ComplianceController);
  });

  // ────────────────────────────────────────────────────────────────────
  // POST / — runCheck. URL-keyed by :contractId.
  // ────────────────────────────────────────────────────────────────────
  describe('POST /contracts/:contractId/compliance-checks (runCheck)', () => {
    it('cross-tenant: user in org A POSTing org B\'s contract gets 404 and service is NEVER called', async () => {
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(
        controller.runCheck(CONTRACT_OWNED_BY_B, userInOrgA),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_OWNED_BY_B,
        ORG_A,
      );
      // CRITICAL: the underlying service must NOT run for a cross-tenant POST.
      expect(compliance.runCheck).not.toHaveBeenCalled();
    });

    it('happy path: in-org user proceeds and runCheck runs', async () => {
      contractAccess.findInOrg.mockResolvedValue({} as any);
      compliance.runCheck.mockResolvedValue({ id: 'check-1' } as any);

      const result = await controller.runCheck(
        'contract-in-a',
        userInOrgA,
      );

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(compliance.runCheck).toHaveBeenCalledWith({
        contractId: 'contract-in-a',
        userId: userInOrgA.id,
        orgId: ORG_A,
        // Phase 7.18 Part 2 — accountType is now threaded through so
        // MeteringResolver can do its defense-in-depth JWT cross-check.
        accountType: AccountType.MANAGING,
      });
      expect(result).toEqual({ id: 'check-1' });
    });

    it('no-org caller (organization_id IS NULL) is denied with 404', async () => {
      const orphanUser = { ...userInOrgA, organization_id: null };

      await expect(
        controller.runCheck(CONTRACT_OWNED_BY_B, orphanUser as any),
      ).rejects.toBeInstanceOf(NotFoundException);

      // findInOrg should NOT have been called — the no-org branch short-circuits.
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(compliance.runCheck).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET / — list. URL-keyed by :contractId.
  // ────────────────────────────────────────────────────────────────────
  describe('GET /contracts/:contractId/compliance-checks (list)', () => {
    it('cross-tenant: 404 and listForContract is NEVER called', async () => {
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(
        controller.list(CONTRACT_OWNED_BY_B, userInOrgA),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(compliance.listForContract).not.toHaveBeenCalled();
    });

    it('happy path: in-org list returns the rows', async () => {
      contractAccess.findInOrg.mockResolvedValue({} as any);
      compliance.listForContract.mockResolvedValue([
        { id: 'check-1' } as any,
      ]);

      const result = await controller.list('contract-in-a', userInOrgA);
      expect(result).toEqual([{ id: 'check-1' }]);
      // Option B chokepoint (compliance finale): the org is threaded so the
      // scoped LIST read inside listForContract re-gates by it (layer 2).
      expect(compliance.listForContract).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /:checkId — getOne. URL-keyed by :checkId.
  // The check's TRUE contract_id is the wall key, NOT the URL :contractId.
  // ────────────────────────────────────────────────────────────────────
  describe('GET /contracts/:contractId/compliance-checks/:checkId (getOne)', () => {
    it("cross-tenant: 404 and refreshFromAi+getDetail are NEVER called (no AI spend on read-leak)", async () => {
      // Even though the caller crafted the URL with their own contract id,
      // the check belongs to org B's contract. The wall walks check →
      // contract_id and catches it.
      compliance.getContractIdForCheck.mockResolvedValue(CONTRACT_OWNED_BY_B);
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(
        controller.getOne(CHECK_ON_B_CONTRACT, userInOrgA),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_OWNED_BY_B,
        ORG_A,
      );
      // CRITICAL: refreshFromAi is the AI-spend hook. It MUST NOT fire for
      // a cross-tenant probe.
      expect(compliance.refreshFromAi).not.toHaveBeenCalled();
      expect(compliance.getDetail).not.toHaveBeenCalled();
    });

    it('happy path: in-org getOne refreshes and returns', async () => {
      compliance.getContractIdForCheck.mockResolvedValue('contract-in-a');
      contractAccess.findInOrg.mockResolvedValue({} as any);
      compliance.refreshFromAi.mockResolvedValue({} as any);
      compliance.getDetail.mockResolvedValue({
        id: 'check-1',
        findings: [],
      } as any);

      const result = await controller.getOne('check-1', userInOrgA);
      expect(compliance.refreshFromAi).toHaveBeenCalledWith('check-1');
      expect(result).toEqual({ id: 'check-1', findings: [] });
    });

    it('missing check: 404 surfaces from getContractIdForCheck', async () => {
      compliance.getContractIdForCheck.mockRejectedValue(
        new NotFoundException('Compliance check not found'),
      );

      await expect(
        controller.getOne('does-not-exist', userInOrgA),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      expect(compliance.refreshFromAi).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // POST /:checkId/report (and conflict-report, obligations-report).
  // ────────────────────────────────────────────────────────────────────
  describe.each([
    [
      'requestSummaryReport',
      (c: ComplianceController, id: string, u: User) =>
        c.requestSummaryReport(id, u),
    ],
    [
      'requestConflictReport',
      (c: ComplianceController, id: string, u: User) =>
        c.requestConflictReport(id, u),
    ],
    [
      'requestObligationsReport',
      (c: ComplianceController, id: string, u: User) =>
        c.requestObligationsReport(id, u),
    ],
  ])(
    'POST /contracts/:contractId/compliance-checks/:checkId/<%s>',
    (name, invoke) => {
      it(`cross-tenant: 404 and reports.request is NEVER called (no PDF queued)`, async () => {
        compliance.getContractIdForCheck.mockResolvedValue(
          CONTRACT_OWNED_BY_B,
        );
        contractAccess.findInOrg.mockRejectedValue(
          new NotFoundException('Contract not found'),
        );

        await expect(
          invoke(controller, CHECK_ON_B_CONTRACT, userInOrgA),
        ).rejects.toBeInstanceOf(NotFoundException);

        expect(reports.request).not.toHaveBeenCalled();
      });

      it(`happy path: in-org report queued`, async () => {
        compliance.getContractIdForCheck.mockResolvedValue('contract-in-a');
        contractAccess.findInOrg.mockResolvedValue({} as any);
        reports.request.mockResolvedValue({ id: 'job-1' } as any);

        const result = await invoke(controller, 'check-1', userInOrgA);
        expect(result).toMatchObject({ job_id: 'job-1' });
        expect(reports.request).toHaveBeenCalled();
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /:checkId/findings/:findingId — updateFinding. URL-keyed by :findingId.
  // Wall walks finding → check → contract_id.
  // ────────────────────────────────────────────────────────────────────
  describe('PATCH /contracts/:contractId/compliance-checks/:checkId/findings/:findingId', () => {
    it('cross-tenant: 404 and updateStatus is NEVER called (no mutation)', async () => {
      findings.getContractIdForFinding.mockResolvedValue(CONTRACT_OWNED_BY_B);
      contractAccess.findInOrg.mockRejectedValue(
        new NotFoundException('Contract not found'),
      );

      await expect(
        controller.updateFinding(
          FINDING_ON_B_CHECK,
          { status: ComplianceFindingStatus.ACKNOWLEDGED },
          userInOrgA,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(findings.updateStatus).not.toHaveBeenCalled();
    });

    it('happy path: in-org updateFinding runs', async () => {
      findings.getContractIdForFinding.mockResolvedValue('contract-in-a');
      contractAccess.findInOrg.mockResolvedValue({} as any);
      findings.updateStatus.mockResolvedValue({
        id: 'finding-1',
        status: ComplianceFindingStatus.ACKNOWLEDGED,
      } as any);

      const result = await controller.updateFinding(
        'finding-1',
        { status: ComplianceFindingStatus.ACKNOWLEDGED },
        userInOrgA,
      );

      // Option B chokepoint (compliance finale): the org is threaded so the
      // scoped by-id finding load inside updateStatus re-gates by it (layer 2).
      expect(findings.updateStatus).toHaveBeenCalledWith(
        'finding-1',
        ComplianceFindingStatus.ACKNOWLEDGED,
        userInOrgA.id,
        ORG_A,
      );
      expect(result).toMatchObject({ id: 'finding-1' });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // RED-BEFORE REASONING (cannot run against the pre-fix code in the same
  // tree without checking out a different branch, so reasoning is recorded
  // here and confirmed via a quick wall-removal probe documented in
  // docs/compliance-access-wall-fix.md):
  //
  // Against the PRE-FIX controller (commit before this PR), the
  // `cross-tenant: ... is NEVER called` assertions in EVERY test above
  // would FAIL — the pre-fix controller had no `assertContractInCallerOrg`
  // method, no `contractAccess` dependency, and called the underlying
  // service directly. Specifically:
  //
  //   - `controller.runCheck(CONTRACT_OWNED_BY_B, userInOrgA)` would call
  //     `compliance.runCheck({ contractId: CONTRACT_OWNED_BY_B, ... })`
  //     directly. `expect(compliance.runCheck).not.toHaveBeenCalled()`
  //     would fail.
  //   - `controller.list(CONTRACT_OWNED_BY_B, userInOrgA)` (which would
  //     not have accepted the User param at all pre-fix) would call
  //     `compliance.listForContract(CONTRACT_OWNED_BY_B)`.
  //     `expect(compliance.listForContract).not.toHaveBeenCalled()` would
  //     fail.
  //   - `controller.getOne(CHECK_ON_B_CONTRACT, ...)` would call
  //     `refreshFromAi` then `getDetail` on the foreign check.
  //   - report and updateFinding paths similarly bypass the wall.
  //
  // The wall is what makes every `not.toHaveBeenCalled()` assertion in
  // this file pass. Removing the wall makes every one of them fail —
  // proven empirically by the wall-removal probe (results pasted in the
  // PR description doc).
  // ─────────────────────────────────────────────────────────────────────
});
