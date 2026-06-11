import { NotFoundException } from '@nestjs/common';

import { ObligationsService } from '../obligations.service';

/**
 * Tenant-isolation Tier 2 — access-wall spec for the `?contract_id=`
 * conditional filter on `GET /obligations/dashboard`.
 *
 * The sibling route `GET /obligations/contract/:contractId` (Class-C
 * bypass-role leak) was interim-walled in S0 with the same findInOrg
 * pattern — see obligations.service.find-by-contract-wall.spec.ts and
 * docs/s0-pre-option-b-fixes.md. Option B will later absorb both via the
 * scoped repository chokepoint.
 */
describe('ObligationsService — Tier 2 dashboard access wall', () => {
  const ORG_A = '00000000-0000-0000-0000-00000000000a';
  const CONTRACT_IN_B = '11111111-1111-1111-1111-1111111111b1';
  const noop = {} as any;

  function build({
    obligationRepository,
    contractAccess,
  }: {
    obligationRepository?: any;
    contractAccess: any;
  }): ObligationsService {
    return new ObligationsService(obligationRepository ?? noop, contractAccess);
  }

  describe('getDashboard (with contract_id supplied)', () => {
    it('cross-tenant: 404 BEFORE the qb runs', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn(),
      };
      const obligationRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const contractAccess = {
        findInOrg: jest
          .fn()
          .mockRejectedValue(new NotFoundException('Contract not found')),
      };

      const svc = build({ obligationRepository, contractAccess });

      await expect(
        svc.getDashboard(ORG_A, CONTRACT_IN_B),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        CONTRACT_IN_B,
        ORG_A,
      );
      expect(obligationRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('happy path: in-org caller with contract_id, dashboard runs', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      const obligationRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const contractAccess = { findInOrg: jest.fn().mockResolvedValue({}) };

      const svc = build({ obligationRepository, contractAccess });

      const result = await svc.getDashboard(ORG_A, 'contract-in-a');
      expect(contractAccess.findInOrg).toHaveBeenCalledWith(
        'contract-in-a',
        ORG_A,
      );
      expect(result.total).toBe(0);
    });
  });

  describe('getDashboard (no contract_id — org-scoped path)', () => {
    // FLIPPED (post-#60 follow-up, Ayman ruling): this block previously
    // asserted the contract-less branch ran UNFILTERED
    // (`expect(qb.where).not.toHaveBeenCalled()`) — a green test encoding a
    // platform-wide leak: any authenticated caller's dashboard aggregated
    // EVERY tenant's obligation rows. The contract-less branch is a bug, not
    // an intended platform view. It must be org-scoped via the canonical
    // join (obligation.contract → contract.project AND
    // p.organization_id = :orgId) — same posture as getUpcoming/getOverdue
    // post-#60.
    it('is org-scoped via the canonical contract→project join; foreign-org rows excluded', async () => {
      // Simulated two-tenant store: getMany honours the org predicate the
      // way Postgres would. If the join + predicate were applied with the
      // caller's org, only org-A rows come back; otherwise the platform-wide
      // set (including the foreign-org row) leaks — which is exactly what
      // the pre-fix service did.
      const ROW_IN_A = { id: 'obl-in-a', status: 'PENDING', due_date: null };
      const ROW_FOREIGN = {
        id: 'obl-in-b-foreign',
        status: 'PENDING',
        due_date: null,
      };
      let orgPredicateApplied = false;
      let orgPredicateParam: string | undefined;
      const recordClause = (clause: string, params?: any) => {
        if (clause === 'p.organization_id = :orgId') {
          orgPredicateApplied = true;
          orgPredicateParam = params?.orgId;
        }
      };
      const qb: any = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn((clause: string, params?: any) => {
          recordClause(clause, params);
          return qb;
        }),
        andWhere: jest.fn((clause: string, params?: any) => {
          recordClause(clause, params);
          return qb;
        }),
        getMany: jest.fn(async () =>
          orgPredicateApplied && orgPredicateParam === ORG_A
            ? [ROW_IN_A]
            : [ROW_IN_A, ROW_FOREIGN],
        ),
      };
      const obligationRepository = {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      };
      const contractAccess = { findInOrg: jest.fn() };

      const svc = build({ obligationRepository, contractAccess });

      const result = await svc.getDashboard(ORG_A);

      // No contract to wall — findInOrg stays uncalled; the org gate lives
      // in the query predicate instead.
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
      // Canonical org join (mirrors getUpcoming/getOverdue).
      expect(qb.leftJoin).toHaveBeenCalledWith(
        'obligation.contract',
        'contract',
      );
      expect(qb.leftJoin).toHaveBeenCalledWith('contract.project', 'p');
      expect(orgPredicateApplied).toBe(true);
      expect(orgPredicateParam).toBe(ORG_A);
      // Cross-tenant probe: the foreign-org obligation is NOT counted.
      expect(result.total).toBe(1);
      expect(result.by_status).toEqual({ PENDING: 1 });
    });

    it('no-org caller → zeroed dashboard, repo NEVER queried', async () => {
      const obligationRepository = { createQueryBuilder: jest.fn() };
      const contractAccess = { findInOrg: jest.fn() };

      const svc = build({ obligationRepository, contractAccess });

      await expect(svc.getDashboard(undefined as any)).resolves.toEqual({
        total: 0,
        by_status: {},
        overdue_count: 0,
        upcoming_7_days: 0,
      });

      expect(obligationRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    });
  });
});
