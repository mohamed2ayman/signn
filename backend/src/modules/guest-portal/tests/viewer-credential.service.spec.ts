import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { ViewerCredentialService } from '../services/viewer-credential.service';

const SECRET_A = 'a-real-32-character-viewer-secret-1234567890';
const SECRET_B = 'a-different-32-character-viewer-secret-zzzzzz';

const CONTRACT_ID = '11111111-1111-1111-1111-111111111111';
const INVITATION_ID = '22222222-2222-2222-2222-222222222222';

describe('ViewerCredentialService', () => {
  let service: ViewerCredentialService;
  const cfg = { get: jest.fn() };

  beforeEach(async () => {
    cfg.get.mockReset();
    cfg.get.mockImplementation((k: string, def?: any) => {
      if (k === 'GUEST_VIEWER_SECRET') return SECRET_A;
      if (k === 'GUEST_VIEWER_TTL_MINUTES') return 15;
      return def;
    });

    const m: TestingModule = await Test.createTestingModule({
      providers: [
        ViewerCredentialService,
        { provide: ConfigService, useValue: cfg },
      ],
    }).compile();
    service = m.get(ViewerCredentialService);
  });

  it('issue() produces a token that verify() accepts and decodes back to the same scope', () => {
    const { token, expires_at } = service.issue(CONTRACT_ID, INVITATION_ID);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(expires_at.getTime()).toBeGreaterThan(Date.now());

    const r = service.verify(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.contract_id).toBe(CONTRACT_ID);
      expect(r.payload.invitation_id).toBe(INVITATION_ID);
    }
  });

  it('verify() rejects a token signed with a different secret', () => {
    const cfgB = new ConfigService();
    jest.spyOn(cfgB, 'get').mockImplementation((k: string, def?: any) => {
      if (k === 'GUEST_VIEWER_SECRET') return SECRET_B;
      if (k === 'GUEST_VIEWER_TTL_MINUTES') return 15;
      return def;
    });
    const otherService = new ViewerCredentialService(cfgB);
    const { token } = otherService.issue(CONTRACT_ID, INVITATION_ID);

    const r = service.verify(token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_signature');
  });

  it('verify() rejects a tampered payload', () => {
    const { token } = service.issue(CONTRACT_ID, INVITATION_ID);
    const [payload, sig] = token.split('.');
    const tampered = payload.slice(0, -1) + (payload.slice(-1) === 'A' ? 'B' : 'A') + '.' + sig;
    const r = service.verify(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_signature');
  });

  it('verify() rejects an expired credential', () => {
    // Re-config with a 1-min TTL, issue, then move time forward.
    cfg.get.mockImplementation((k: string, def?: any) => {
      if (k === 'GUEST_VIEWER_SECRET') return SECRET_A;
      if (k === 'GUEST_VIEWER_TTL_MINUTES') return 1;
      return def;
    });
    const { token } = service.issue(CONTRACT_ID, INVITATION_ID);

    // Time-warp Date.now by 2 minutes.
    const realNow = Date.now;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 2 * 60 * 1000);
    try {
      const r = service.verify(token);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('expired');
    } finally {
      (Date.now as any).mockRestore();
    }
  });

  it('verify() rejects malformed shapes', () => {
    expect(service.verify('').ok).toBe(false);
    expect(service.verify('nodothere').ok).toBe(false);
    expect(service.verify('header.').ok).toBe(false);
  });
});
