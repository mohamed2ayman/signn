import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InvitationTokenService } from '../services/invitation-token.service';
import {
  GuestInvitation,
  GuestInvitationStatus,
} from '../../../database/entities';

/**
 * Phase 7.18 bucket 1b-i — InvitationTokenService unit tests.
 *
 * Asserts the security invariants that the LIVE probe in 1b-i depends on:
 *  • Valid token + active invitation → ok
 *  • Expired payload → expired (no DB call past expiry — checked before
 *    the row load)
 *  • Revoked invitation → revoked (row status REVOKED OR revoked_at set)
 *  • Forged signature → invalid_signature AND no DB lookup is attempted
 *  • Malformed token shapes → malformed
 */

const SECRET_A = 'a-real-32-character-test-secret-1234567890ABC';
const SECRET_B = 'a-different-32-character-secret-zzzzzzzzzzzzzz';

const FIXED_INVITATION_ID = '11111111-1111-1111-1111-111111111111';

describe('InvitationTokenService', () => {
  let service: InvitationTokenService;
  let repo: jest.Mocked<Pick<Repository<GuestInvitation>, 'findOne'>>;
  const cfg = { get: jest.fn() };

  beforeEach(async () => {
    repo = { findOne: jest.fn() };
    cfg.get.mockReset();
    cfg.get.mockImplementation((k: string) =>
      k === 'GUEST_INVITE_SECRET' ? SECRET_A : undefined,
    );

    const m: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationTokenService,
        { provide: ConfigService, useValue: cfg },
        { provide: getRepositoryToken(GuestInvitation), useValue: repo },
      ],
    }).compile();
    service = m.get(InvitationTokenService);
  });

  // ─── valid path ─────────────────────────────────────────────────────────

  it('verify() returns ok=true for a freshly-issued valid token against a PENDING invitation', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const token = service.issue(FIXED_INVITATION_ID, expiresAt);

    repo.findOne.mockResolvedValue({
      id: FIXED_INVITATION_ID,
      status: GuestInvitationStatus.PENDING,
      revoked_at: null,
      expires_at: expiresAt,
    } as any);

    const res = await service.verify(token);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.invitation.id).toBe(FIXED_INVITATION_ID);
  });

  it('verify() accepts an ACCEPTED invitation (re-exchange within TTL mints a fresh viewer)', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const token = service.issue(FIXED_INVITATION_ID, expiresAt);

    repo.findOne.mockResolvedValue({
      id: FIXED_INVITATION_ID,
      status: GuestInvitationStatus.ACCEPTED,
      accepted_at: new Date(Date.now() - 30_000),
      revoked_at: null,
      expires_at: expiresAt,
    } as any);

    const res = await service.verify(token);
    expect(res.ok).toBe(true);
  });

  // ─── expired ────────────────────────────────────────────────────────────

  it('verify() rejects an expired payload before any DB call', async () => {
    const expiresAt = new Date(Date.now() - 60_000); // in the past
    const token = service.issue(FIXED_INVITATION_ID, expiresAt);

    const res = await service.verify(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('expired');
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('verify() rejects when the DB-side expires_at has lapsed even if payload claim is still future', async () => {
    // Issue with future payload expiry but DB row already expired.
    const futureClaim = new Date(Date.now() + 60_000);
    const token = service.issue(FIXED_INVITATION_ID, futureClaim);

    repo.findOne.mockResolvedValue({
      id: FIXED_INVITATION_ID,
      status: GuestInvitationStatus.PENDING,
      revoked_at: null,
      expires_at: new Date(Date.now() - 1_000),
    } as any);

    const res = await service.verify(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('expired');
  });

  // ─── revoked ────────────────────────────────────────────────────────────

  it('verify() rejects a revoked invitation (status REVOKED)', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const token = service.issue(FIXED_INVITATION_ID, expiresAt);

    repo.findOne.mockResolvedValue({
      id: FIXED_INVITATION_ID,
      status: GuestInvitationStatus.REVOKED,
      revoked_at: new Date(),
      expires_at: expiresAt,
    } as any);

    const res = await service.verify(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('revoked');
  });

  it('verify() rejects when revoked_at is set even if status was not flipped (defense in depth)', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const token = service.issue(FIXED_INVITATION_ID, expiresAt);

    repo.findOne.mockResolvedValue({
      id: FIXED_INVITATION_ID,
      status: GuestInvitationStatus.PENDING,
      revoked_at: new Date(), // set but status untouched — should still reject
      expires_at: expiresAt,
    } as any);

    const res = await service.verify(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('revoked');
  });

  // ─── forged signature ──────────────────────────────────────────────────

  it('verify() rejects a token signed with a different secret AND does NOT touch the DB', async () => {
    // Issue a token using SECRET_B, then try to verify with the service
    // bound to SECRET_A.
    const cfgB = new ConfigService();
    jest.spyOn(cfgB, 'get').mockImplementation((k: string) =>
      k === 'GUEST_INVITE_SECRET' ? SECRET_B : undefined,
    );
    const otherService = new InvitationTokenService(cfgB, repo as any);
    const expiresAt = new Date(Date.now() + 60_000);
    const tokenSignedByB = otherService.issue(FIXED_INVITATION_ID, expiresAt);

    const res = await service.verify(tokenSignedByB);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_signature');
    // Critical: NO DB lookup when the HMAC fails. This is the security floor.
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('verify() rejects a tampered payload (signature mismatch) and does NOT touch the DB', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const token = service.issue(FIXED_INVITATION_ID, expiresAt);
    // Tamper with one character in the payload portion.
    const [payload, sig] = token.split('.');
    const tampered = payload.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) + '.' + sig;

    const res = await service.verify(tampered);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('invalid_signature');
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  // ─── malformed ─────────────────────────────────────────────────────────

  it('verify() rejects an empty token as malformed', async () => {
    const res = await service.verify('');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('malformed');
  });

  it('verify() rejects a token with no dot as malformed', async () => {
    const res = await service.verify('justonelongstringnodot');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('malformed');
  });

  it('verify() rejects a token with empty signature as malformed', async () => {
    const res = await service.verify('header.');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('malformed');
  });

  // ─── not_found ─────────────────────────────────────────────────────────

  it('verify() returns not_found when the signature is valid but the invitation row was deleted', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const token = service.issue(FIXED_INVITATION_ID, expiresAt);

    repo.findOne.mockResolvedValue(null);
    const res = await service.verify(token);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not_found');
  });
});
