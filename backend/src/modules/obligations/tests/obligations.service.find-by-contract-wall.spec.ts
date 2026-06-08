import { NotFoundException } from '@nestjs/common';

import { ObligationsService } from '../obligations.service';

/**
 * S0 — INTERIM Class-C bypass-role wall on
 * `GET /obligations/contract/:contractId` → `ObligationsService.findByContract`.
 *
 * Pre-fix, `findByContract(contractId)` took NO orgId and never called
 * findInOrg — so the load was unscoped. Because PermissionLevelGuard lets
 * bypass-roles (OWNER_ADMIN/SYSTEM_ADMIN/OPERATIONS) through, a bypass-role
 * caller in org A could read org B's obligations (proven by the red-before
 * exploit in docs/s0-pre-option-b-fixes.md).
 *
 * The wall (findInOrg) is keyed on orgId ONLY — it takes no role — so it
 * applies regardless of the caller's role. That is exactly what closes the
 * bypass: clearing PLG no longer skips the org gate.
 *
 * Option B will absorb this via the scoped repository chokepoint; this
 * findInOrg is the interim stop-gap.
 */
describe('ObligationsService.findByContract — Class-C bypass-role wall (S0)', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const CONTRACT_IN_A = '22222222-2222-2222-2222-22222222222a';
  const noop = {} as any;

  const reject = () =>
    jest.fn().mockRejectedValue(new NotFoundException('Contract not found'));
  const resolve = (val: any = {}) => jest.fn().mockResolvedValue(val);

  function build(obligationRepository: any, contractAccess: any): ObligationsService {
    return new ObligationsService(obligationRepository ?? noop, contractAccess);
  }

  it('BYPASS-ROLE PROBE: an OWNER_ADMIN in org A reading org B\'s contract → 404, repo NEVER queried', async () => {
    // The caller is a PLG bypass-role (OWNER_ADMIN) who has already cleared
    // PermissionLevelGuard. The wall still fires because it is keyed on orgId,
    // not role — proving the role no longer bypasses the org gate.
    const obligationRepository = { find: jest.fn() };
    const contractAccess = { findInOrg: reject() };

    const svc = build(obligationRepository, contractAccess);

    await expect(
      svc.findByContract(CONTRACT_IN_B, ORG_A),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_B, ORG_A);
    // CRITICAL: no obligations were loaded on the cross-tenant path.
    expect(obligationRepository.find).not.toHaveBeenCalled();
  });

  it('no-org caller (organization_id null) → 404, findInOrg NEVER called', async () => {
    const obligationRepository = { find: jest.fn() };
    const contractAccess = { findInOrg: jest.fn() };

    const svc = build(obligationRepository, contractAccess);

    await expect(
      svc.findByContract(CONTRACT_IN_B, null as any),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    expect(obligationRepository.find).not.toHaveBeenCalled();
  });

  it('happy path: in-org caller → obligations returned', async () => {
    const rows = [{ id: 'obligation-in-a' }];
    const obligationRepository = { find: jest.fn().mockResolvedValue(rows) };
    const contractAccess = { findInOrg: resolve() };

    const svc = build(obligationRepository, contractAccess);

    const result = await svc.findByContract(CONTRACT_IN_A, ORG_A);

    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    expect(obligationRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contract_id: CONTRACT_IN_A } }),
    );
    expect(result).toEqual(rows);
  });
});
