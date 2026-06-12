import { NotFoundException } from '@nestjs/common';

import { ComplianceObligationService } from '../services/compliance-obligation.service';

/**
 * Option B — S2c-2: assignUser / unassignUser / updateEvidence load the
 * obligation through the scoped-repository tenancy chokepoint (layer 2)
 * BEFORE mutating. The #60 controller wall (assertContractInCallerOrg +
 * obligation-in-contract pin) STAYS above as layer 1 — two checks, two
 * layers.
 *
 * RED FORM (wall-bypassed independent denial): these service methods are only
 * reachable through the #60-walled controller routes, so a cross-tenant HTTP
 * probe is denied by the wall and never reaches the service. The red here
 * calls the SERVICE directly — equivalent to the wall being bypassed or
 * buggy — and demands the data layer deny alone. Pre-wire, the red run
 * proved the breach was real:
 *   - assignUser / unassignUser performed NO obligation load at all — the
 *     assignee write executed against a foreign org's obligation id;
 *   - updateEvidence loaded via a bare findOne (no org anywhere) and saved
 *     the foreign row.
 * Post-wire, the scoped by-id load 404s first and no mutation runs.
 *
 * The service is constructed through an `any`-cast so the spec RUNS against
 * the pre-wire 4-arg constructor (true runtime red) instead of failing to
 * compile — same device obligations.service.id-walls.spec.ts documented.
 */

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONTRACT_IN_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OBLIGATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ASSIGNEE_USER_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ASSIGNER_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVIDENCE_URL = 'https://storage.sign.com/evidence.pdf';

const OBLIGATION_IN_A = {
  id: OBLIGATION_ID,
  contract_id: CONTRACT_IN_A,
  description: 'Submit insurance certificate',
  status: 'PENDING',
};

function buildObligationRepo(row: any) {
  return {
    findOne: jest.fn().mockResolvedValue(row ? { ...row } : null),
    save: jest.fn().mockImplementation(async (o: any) => o),
    insert: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function buildAssigneeRepo() {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((row: any) => row),
    save: jest.fn().mockImplementation(async (o: any) => o),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

/**
 * Scoped-repo mock with the REAL deny semantics: resolves only when the
 * obligation is in the caller's org; otherwise throws the no-existence-leak
 * 404 (what ObligationScopedRepository.scopedFindByIdOrThrow does against
 * Postgres — obligation-scoped.s2c1.repository.spec.ts).
 */
function buildScoped(inOrgRow: any | null) {
  return {
    scopedFindByIdOrThrow: jest
      .fn()
      .mockImplementation(async (id: string, orgId: string) => {
        if (inOrgRow && id === inOrgRow.id && orgId === ORG_A) {
          return { ...inOrgRow };
        }
        throw new NotFoundException('Obligation not found');
      }),
  };
}

/** `any`-cast so the spec RUNS (red) against the pre-wire 4-arg constructor. */
function buildService(
  obligationRepo: any,
  assigneeRepo: any,
  scoped: any,
): any {
  const Ctor: any = ComplianceObligationService;
  // (obligationRepo, contractRepo, assigneeRepo, reminderLogRepo, scoped)
  return new Ctor(obligationRepo, {} as any, assigneeRepo, {} as any, scoped);
}

describe('ComplianceObligationService — S2c-2 scoped by-id loads before assignee/evidence mutations', () => {
  beforeEach(jest.clearAllMocks);

  // ── assignUser ────────────────────────────────────────────────────────────

  describe('assignUser()', () => {
    it('WALL-BYPASSED CROSS-TENANT ASSIGN: scoped load denies → 404, NO assignee row written', async () => {
      // Pre-wire RED: no obligation load existed here at all — the assignee
      // row was created against the foreign obligation id.
      const obligationRepo = buildObligationRepo(null);
      const assigneeRepo = buildAssigneeRepo();
      const scoped = buildScoped(null); // obligation NOT in org A
      const svc = buildService(obligationRepo, assigneeRepo, scoped);

      await expect(
        svc.assignUser(OBLIGATION_ID, ASSIGNEE_USER_ID, ASSIGNER_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ORG_A,
      );
      expect(assigneeRepo.create).not.toHaveBeenCalled();
      expect(assigneeRepo.save).not.toHaveBeenCalled();
    });

    it('happy path: scoped load resolves → assignee row created as before', async () => {
      const obligationRepo = buildObligationRepo(OBLIGATION_IN_A);
      const assigneeRepo = buildAssigneeRepo();
      const scoped = buildScoped(OBLIGATION_IN_A);
      const svc = buildService(obligationRepo, assigneeRepo, scoped);

      const result = await svc.assignUser(
        OBLIGATION_ID,
        ASSIGNEE_USER_ID,
        ASSIGNER_ID,
        ORG_A,
      );

      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ORG_A,
      );
      expect(assigneeRepo.create).toHaveBeenCalledWith({
        obligation_id: OBLIGATION_ID,
        user_id: ASSIGNEE_USER_ID,
        assigned_by: ASSIGNER_ID,
      });
      expect(result).toMatchObject({ obligation_id: OBLIGATION_ID });
    });
  });

  // ── unassignUser ──────────────────────────────────────────────────────────

  describe('unassignUser()', () => {
    it('WALL-BYPASSED CROSS-TENANT UNASSIGN: scoped load denies → 404, delete NEVER runs', async () => {
      // Pre-wire RED: no obligation load existed here — the assignee delete
      // executed against the foreign obligation id.
      const obligationRepo = buildObligationRepo(null);
      const assigneeRepo = buildAssigneeRepo();
      const scoped = buildScoped(null);
      const svc = buildService(obligationRepo, assigneeRepo, scoped);

      await expect(
        svc.unassignUser(OBLIGATION_ID, ASSIGNEE_USER_ID, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(assigneeRepo.delete).not.toHaveBeenCalled();
    });

    it('happy path: scoped load resolves → assignee row deleted as before', async () => {
      const obligationRepo = buildObligationRepo(OBLIGATION_IN_A);
      const assigneeRepo = buildAssigneeRepo();
      const scoped = buildScoped(OBLIGATION_IN_A);
      const svc = buildService(obligationRepo, assigneeRepo, scoped);

      await expect(
        svc.unassignUser(OBLIGATION_ID, ASSIGNEE_USER_ID, ORG_A),
      ).resolves.toBeUndefined();

      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ORG_A,
      );
      expect(assigneeRepo.delete).toHaveBeenCalledWith({
        obligation_id: OBLIGATION_ID,
        user_id: ASSIGNEE_USER_ID,
      });
    });
  });

  // ── updateEvidence ────────────────────────────────────────────────────────

  describe('updateEvidence()', () => {
    it('WALL-BYPASSED CROSS-TENANT EVIDENCE WRITE: scoped load denies → 404, nothing saved, bare load GONE', async () => {
      // Pre-wire RED: the bare findOne loaded the foreign row and save()
      // executed on it.
      const obligationRepo = buildObligationRepo(OBLIGATION_IN_A);
      const assigneeRepo = buildAssigneeRepo();
      const scoped = buildScoped(null);
      const svc = buildService(obligationRepo, assigneeRepo, scoped);

      await expect(
        svc.updateEvidence(OBLIGATION_ID, EVIDENCE_URL, ORG_A),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(obligationRepo.save).not.toHaveBeenCalled();
      // The bare unscoped findOne is gone from this path entirely.
      expect(obligationRepo.findOne).not.toHaveBeenCalled();
    });

    it('happy path: evidence saved on the SCOPED-loaded row; bare findOne gone', async () => {
      const obligationRepo = buildObligationRepo(null);
      const assigneeRepo = buildAssigneeRepo();
      const scoped = buildScoped(OBLIGATION_IN_A);
      const svc = buildService(obligationRepo, assigneeRepo, scoped);

      const result = await svc.updateEvidence(
        OBLIGATION_ID,
        EVIDENCE_URL,
        ORG_A,
      );

      expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(
        OBLIGATION_ID,
        ORG_A,
      );
      expect(obligationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ evidence_url: EVIDENCE_URL }),
      );
      expect(obligationRepo.findOne).not.toHaveBeenCalled();
      expect(result.evidence_url).toBe(EVIDENCE_URL);
    });
  });
});
