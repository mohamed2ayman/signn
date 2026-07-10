import { NotFoundException } from '@nestjs/common';

import { GuestInvitationService } from '../services/guest-invitation.service';
import { GuestInvitationStatus } from '../../../database/entities';

/**
 * Option B — Chokepoint migration (guest-portal, 2 of 4): GuestInvitationService's
 * revoke BY-ID read goes through the scoped-repository tenancy chokepoint
 * (layer 2 — scopedFindByIdOrThrow), UNDER the inline ContractAccessService.findInOrg
 * wall (layer 1). Two checks, two layers — never a swap. The wall is KEPT inline
 * (not consolidated into the scoped load); the create path authorizes the same way.
 *
 * ORDER (scoped-first, then wall) is the S2f updateExtractedText / S2e Notice.findById
 * shape: the wall needs the loaded row's canonical contract_id, so the scoped load
 * runs FIRST and the wall runs on its `contract_id` as live defense-in-depth.
 *
 * RED FORM (wall-neutralized independent denial): pre-wire, revoke loaded via
 * `invitationRepo.findOne({ where: { id } })` — NO org filter. With the wall
 * neutralized (findInOrg made to pass — a wall bug / bypass), a cross-org invitation
 * id would load and be revoked (a cross-org write). Post-wire, scopedFindByIdOrThrow
 * denies cross-tenant on its own with the no-existence-leak 404 (test 2 below), and
 * the data-layer denial against real Postgres is proven in
 * guest-invitation-scoped.repository.spec.ts.
 *
 * The service is constructed through an `any`-cast so the spec RUNS even as the
 * constructor evolves — same device the negotiation / S2c-2 / S2e wiring specs used.
 */

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const CONTRACT_IN_A = '11111111-1111-1111-1111-1111111111a1';
const INVITE = '22222222-2222-4222-8222-222222222222';

function buildService(invitationRepo: any, contractAccess: any, scoped: any): any {
  const Ctor: any = GuestInvitationService;
  // (config, invitationRepo, contractAccess, tokenService, viewerService,
  //  dataSource, authService, invitationScoped, accountLockout)
  const noop = {} as any;
  return new Ctor(
    noop,
    invitationRepo,
    contractAccess,
    noop,
    noop,
    noop,
    noop,
    scoped,
    noop,
  );
}

describe('GuestInvitationService.revoke — scoped BY-ID load (layer 2 under the inline wall)', () => {
  beforeEach(jest.clearAllMocks);

  it('org-missing guard: no actor org → 404 BEFORE the scoped load (scoped not called, no write)', async () => {
    const invitationRepo = { save: jest.fn() };
    const scoped = { scopedFindByIdOrThrow: jest.fn() };
    const contractAccess = { findInOrg: jest.fn() };
    const svc = buildService(invitationRepo, contractAccess, scoped);

    await expect(
      svc.revoke(INVITE, { id: 'u1', organization_id: null }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(scoped.scopedFindByIdOrThrow).not.toHaveBeenCalled();
    expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    expect(invitationRepo.save).not.toHaveBeenCalled();
  });

  it('cross-tenant (scoped layer denies): 404 from the data layer; NO write; wall not reached', async () => {
    const invitationRepo = { save: jest.fn() };
    // layer 2 denies: the canonical join finds no row for this org → 404.
    const scoped = {
      scopedFindByIdOrThrow: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Invitation not found')),
    };
    const contractAccess = { findInOrg: jest.fn() };
    const svc = buildService(invitationRepo, contractAccess, scoped);

    await expect(
      svc.revoke(INVITE, { id: 'u1', organization_id: ORG_A }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(INVITE, ORG_A);
    // Scoped denial short-circuits before the wall and before any write.
    expect(contractAccess.findInOrg).not.toHaveBeenCalled();
    expect(invitationRepo.save).not.toHaveBeenCalled();
  });

  it('LIVE WALL-DENIAL: scoped resolves but the wall denies the canonical contract → 404; NO write', async () => {
    // Defense-in-depth dead-code check: even if the scoped layer returned a row,
    // the wall is an independent gate on the row's canonical contract. It must
    // stay live.
    const scopedRow = {
      id: INVITE,
      contract_id: CONTRACT_IN_A,
      status: GuestInvitationStatus.PENDING,
      revoked_at: null,
    };
    const invitationRepo = { save: jest.fn() };
    const scoped = {
      scopedFindByIdOrThrow: jest.fn().mockResolvedValue(scopedRow),
    };
    const contractAccess = {
      findInOrg: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Contract not found')),
    };
    const svc = buildService(invitationRepo, contractAccess, scoped);

    await expect(
      svc.revoke(INVITE, { id: 'u1', organization_id: ORG_A }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The wall walked the scoped row's canonical contract_id.
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    expect(invitationRepo.save).not.toHaveBeenCalled();
  });

  it('happy path: BOTH layers consulted — scoped resolves + wall passes → REVOKED + revoked_at set', async () => {
    const scopedRow: any = {
      id: INVITE,
      contract_id: CONTRACT_IN_A,
      status: GuestInvitationStatus.PENDING,
      revoked_at: null,
    };
    const invitationRepo = { save: jest.fn(async (e: any) => e) };
    const scoped = {
      scopedFindByIdOrThrow: jest.fn().mockResolvedValue(scopedRow),
    };
    const contractAccess = {
      findInOrg: jest.fn().mockResolvedValue({ id: CONTRACT_IN_A }),
    };
    const svc = buildService(invitationRepo, contractAccess, scoped);

    const result = await svc.revoke(INVITE, { id: 'u1', organization_id: ORG_A });

    expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(INVITE, ORG_A);
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    const savedRow = invitationRepo.save.mock.calls[0][0];
    expect(savedRow.status).toBe(GuestInvitationStatus.REVOKED);
    expect(savedRow.revoked_at).toBeInstanceOf(Date);
    expect(result.status).toBe(GuestInvitationStatus.REVOKED);
  });

  it('idempotent re-revoke: scoped resolves an already-REVOKED row → returned WITHOUT a write (wall still consulted)', async () => {
    const scopedRow: any = {
      id: INVITE,
      contract_id: CONTRACT_IN_A,
      status: GuestInvitationStatus.REVOKED,
      revoked_at: new Date('2026-01-01T00:00:00Z'),
    };
    const invitationRepo = { save: jest.fn() };
    const scoped = {
      scopedFindByIdOrThrow: jest.fn().mockResolvedValue(scopedRow),
    };
    const contractAccess = {
      findInOrg: jest.fn().mockResolvedValue({ id: CONTRACT_IN_A }),
    };
    const svc = buildService(invitationRepo, contractAccess, scoped);

    const result = await svc.revoke(INVITE, { id: 'u1', organization_id: ORG_A });

    // Both layers ran; the idempotent branch returns the row without re-saving.
    expect(scoped.scopedFindByIdOrThrow).toHaveBeenCalledWith(INVITE, ORG_A);
    expect(contractAccess.findInOrg).toHaveBeenCalledWith(CONTRACT_IN_A, ORG_A);
    expect(invitationRepo.save).not.toHaveBeenCalled();
    expect(result.status).toBe(GuestInvitationStatus.REVOKED);
  });
});
