import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

import { AuthService } from '../auth.service';
import {
  User,
  UserRole,
  Organization,
  SubscriptionPlan,
  OrganizationSubscription,
} from '../../../database/entities';
import { EmailService } from '../../notifications/email.service';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { SessionService } from '../../admin-security/services/session.service';
import { KnownDeviceService } from '../../admin-security/services/known-device.service';
import { SuspiciousLoginService } from '../../admin-security/services/suspicious-login.service';
import { GeoLookupService } from '../../admin-security/services/geo-lookup.service';
import { UserAgentService } from '../../admin-security/services/user-agent.service';
import { SecurityEventService } from '../../admin-security/services/security-event.service';
import { TokenBlacklistService } from '../../../common/services/token-blacklist.service';
import { SECURITY_EVENT_TYPES } from '../../../common/enums/security-event-types';

/**
 * Phase 4.2 — JWT & refresh token hardening tests.
 *
 * Architecture: unit-level (no real DB, no real Redis). Sessions live in
 * an in-memory array maintained by the SessionService mock; the token
 * blacklist is a Set inside the TokenBlacklistService mock. JwtService
 * is mocked to return predictable token strings and verify them by
 * reading from an in-memory payload map.
 */

interface FakeSession {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  parent_token_hash: string | null;
  jti: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_active_at: Date;
}

describe('AuthService — Phase 4.2 token security', () => {
  let service: AuthService;
  let sessions: FakeSession[] = [];
  const blacklist = new Set<string>();
  const refreshPayloads = new Map<string, any>();
  const accessPayloads = new Map<string, any>();

  const MOCK_USER: Partial<User> = {
    id: 'user-id-token-security',
    email: 'sec@sign.com',
    password_hash: 'stored-bcrypt-hash',
    is_active: true,
    locked_until: null as unknown as Date,
    failed_login_attempts: 0,
    mfa_enabled: false,
    mfa_method: null as unknown as string,
    organization_id: null as unknown as string,
    first_name: 'Sec',
    last_name: 'Tester',
    role: UserRole.OWNER_ADMIN,
    mfa_secret: null as unknown as string,
    mfa_totp_secret: null as unknown as string,
    mfa_recovery_codes: null as unknown as string[],
    invitation_token: null as unknown as string,
    invitation_expires_at: null as unknown as Date,
  };

  // ── Mocks ─────────────────────────────────────────────────────────────

  const mockUserRepository = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockSessionService = {
    create: jest.fn(async (input: any) => {
      const row: FakeSession = {
        id: randomUUID(),
        user_id: input.user_id,
        token_hash: hashRaw(input.rawJwt),
        family_id: input.family_id ?? randomUUID(),
        parent_token_hash: input.parent_token_hash ?? null,
        jti: input.jti ?? null,
        expires_at: input.expires_at,
        revoked_at: null,
        last_active_at: new Date(),
      };
      sessions.push(row);
      return row;
    }),
    findAnyByRawToken: jest.fn(async (rawJwt: string) => {
      const h = hashRaw(rawJwt);
      return sessions.find((s) => s.token_hash === h) ?? null;
    }),
    findByTokenHash: jest.fn(async (rawJwt: string) => {
      const h = hashRaw(rawJwt);
      return sessions.find((s) => s.token_hash === h && !s.revoked_at) ?? null;
    }),
    findActiveByJti: jest.fn(async (jti: string) => {
      return sessions.find((s) => s.jti === jti && !s.revoked_at) ?? null;
    }),
    revokeByToken: jest.fn(async (rawJwt: string) => {
      const h = hashRaw(rawJwt);
      sessions.forEach((s) => {
        if (s.token_hash === h && !s.revoked_at) s.revoked_at = new Date();
      });
    }),
    revokeAllForUser: jest.fn(async (userId: string) => {
      let n = 0;
      sessions.forEach((s) => {
        if (s.user_id === userId && !s.revoked_at) {
          s.revoked_at = new Date();
          n++;
        }
      });
      return n;
    }),
    revokeFamily: jest.fn(async (familyId: string) => {
      let n = 0;
      sessions.forEach((s) => {
        if (s.family_id === familyId && !s.revoked_at) {
          s.revoked_at = new Date();
          n++;
        }
      });
      return n;
    }),
    // Phase 4.2 fix: listByFamily returns ALL sessions in a family so the
    // caller can blacklist their JTIs before revoking the DB rows.
    listByFamily: jest.fn(async (familyId: string) => {
      return sessions.filter((s) => s.family_id === familyId);
    }),
  };

  const mockTokenBlacklist = {
    blacklistToken: jest.fn(async (jti: string, _ttl: number) => {
      blacklist.add(jti);
    }),
    isBlacklisted: jest.fn(async (jti: string) => blacklist.has(jti)),
  };

  const mockJwtService = {
    signAsync: jest.fn(async (payload: any, opts: any) => {
      const token = `tok_${randomUUID()}`;
      // Refresh tokens carry family_id; access tokens carry jti.
      if ('family_id' in payload) {
        refreshPayloads.set(token, payload);
      } else {
        accessPayloads.set(token, payload);
      }
      return token;
    }),
    verify: jest.fn((token: string, _opts: any) => {
      if (refreshPayloads.has(token)) return refreshPayloads.get(token);
      if (accessPayloads.has(token)) return accessPayloads.get(token);
      throw new Error('invalid token');
    }),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        JWT_SECRET: 'access-secret-key-minimum-16-chars',
        JWT_REFRESH_SECRET: 'refresh-secret-key-minimum-32-chars-test-value',
        JWT_ACCESS_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return map[key];
    }),
  };

  const mockSecurityEventService = {
    record: jest.fn().mockResolvedValue(undefined),
    recordAtomic: jest.fn().mockResolvedValue(undefined),
  };

  // Standard noise mocks
  const mockEmailService = {
    sendMfaOtp: jest.fn(),
    sendMfaRecoveryCodes: jest.fn(),
    sendPasswordReset: jest.fn(),
    sendContractApprovalRequest: jest.fn(),
  };
  const mockDispatch = { enqueueEmail: jest.fn() };
  const mockKnownDevice = { upsert: jest.fn().mockResolvedValue({ isNew: false }) };
  const mockSuspicious = {
    evaluate: jest.fn().mockResolvedValue({ is_suspicious: false, reason: null }),
  };
  const mockGeo = {
    lookup: jest.fn().mockReturnValue({ country_code: 'EG', pretty: 'Cairo, Egypt' }),
  };
  const mockUa = {
    parse: jest
      .fn()
      .mockReturnValue({ browser: 'Chrome', os: 'Windows', device_type: 'Desktop' }),
  };

  function hashRaw(raw: string): string {
    return require('crypto').createHash('sha256').update(raw).digest('hex');
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    sessions = [];
    blacklist.clear();
    refreshPayloads.clear();
    accessPayloads.clear();

    mockUserRepository.findOne.mockResolvedValue(MOCK_USER);
    mockUserRepository.update.mockResolvedValue({});
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));
    jest.spyOn(bcrypt, 'hash').mockImplementation(() => Promise.resolve('mock-bcrypt-hash'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User),                     useValue: mockUserRepository },
        { provide: getRepositoryToken(Organization),             useValue: { create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(SubscriptionPlan),         useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(OrganizationSubscription), useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: JwtService,                                   useValue: mockJwtService },
        { provide: ConfigService,                                useValue: mockConfigService },
        { provide: EmailService,                                 useValue: mockEmailService },
        { provide: NotificationDispatchService,                  useValue: mockDispatch },
        { provide: SessionService,                               useValue: mockSessionService },
        { provide: KnownDeviceService,                           useValue: mockKnownDevice },
        { provide: SuspiciousLoginService,                       useValue: mockSuspicious },
        { provide: GeoLookupService,                             useValue: mockGeo },
        { provide: UserAgentService,                             useValue: mockUa },
        { provide: SecurityEventService,                         useValue: mockSecurityEventService },
        { provide: TokenBlacklistService,                        useValue: mockTokenBlacklist },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 1 — Reuse attack triggers family invalidation
  // ─────────────────────────────────────────────────────────────────────
  it('reuse of a rotated refresh token revokes the entire family and logs REFRESH_TOKEN_REUSE_DETECTED', async () => {
    // Login → A
    const first = (await service.login({ email: MOCK_USER.email!, password: 'pw' })) as any;
    const refreshA: string = first.refresh_token;

    // Rotate A → B (this revokes A's session row)
    const second = await service.refreshToken(refreshA);
    // refreshB unused but kept for clarity of test intent
    void second.refresh_token;

    // Sanity: two session rows exist, family_id matches
    expect(sessions).toHaveLength(2);
    expect(sessions[0].family_id).toBe(sessions[1].family_id);
    expect(sessions[0].revoked_at).not.toBeNull(); // A revoked
    expect(sessions[1].revoked_at).toBeNull();      // B active

    // Attacker replays A
    await expect(service.refreshToken(refreshA)).rejects.toThrow(UnauthorizedException);

    // Family invalidated — both rows now revoked
    expect(sessions[0].revoked_at).not.toBeNull();
    expect(sessions[1].revoked_at).not.toBeNull();
    expect(mockSessionService.revokeFamily).toHaveBeenCalledWith(sessions[0].family_id);

    // Security event recorded
    const reuseCall = mockSecurityEventService.record.mock.calls.find(
      (call) => call[0]?.type === SECURITY_EVENT_TYPES.REFRESH_TOKEN_REUSE_DETECTED,
    );
    expect(reuseCall).toBeDefined();
    expect(reuseCall[0].metadata).toMatchObject({
      family_id: sessions[0].family_id,
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 2 — Logout blacklists the access token jti in Redis
  // ─────────────────────────────────────────────────────────────────────
  it('logout adds the access token jti to the blacklist', async () => {
    const login = (await service.login({ email: MOCK_USER.email!, password: 'pw' })) as any;
    const accessPayload = accessPayloads.get(login.access_token);
    expect(accessPayload?.jti).toBeDefined();
    expect(typeof accessPayload.jti).toBe('string');

    const exp = Math.floor(Date.now() / 1000) + 15 * 60; // 15 min from now
    await service.logout(MOCK_USER.id!, {
      refreshToken: login.refresh_token as string,
      accessJti: accessPayload.jti,
      accessExp: exp,
    });

    expect(blacklist.has(accessPayload.jti)).toBe(true);
    expect(mockTokenBlacklist.blacklistToken).toHaveBeenCalledWith(
      accessPayload.jti,
      expect.any(Number),
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 3 — Refresh token cannot be reused after logout
  // ─────────────────────────────────────────────────────────────────────
  it('refresh token from before logout cannot be reused', async () => {
    const login = (await service.login({ email: MOCK_USER.email!, password: 'pw' })) as any;
    const accessPayload = accessPayloads.get(login.access_token);

    await service.logout(MOCK_USER.id!, {
      refreshToken: login.refresh_token as string,
      accessJti: accessPayload.jti,
      accessExp: Math.floor(Date.now() / 1000) + 900,
    });

    // The session is revoked. Attempting refresh hits the reuse-detection path.
    await expect(service.refreshToken(login.refresh_token as string)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 4 — acceptInvitation creates a UserSession row
  // ─────────────────────────────────────────────────────────────────────
  it('acceptInvitation creates an active session row and logs LOGIN_SUCCESS', async () => {
    const invitedUser: Partial<User> = {
      ...MOCK_USER,
      id: 'invited-user-id',
      invitation_token: 'invite-tok',
      invitation_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
    mockUserRepository.findOne.mockResolvedValueOnce(invitedUser);
    mockUserRepository.findOne.mockResolvedValueOnce({ ...invitedUser, invitation_token: null });

    const result = await service.acceptInvitation({
      token: 'invite-tok',
      password: 'NewPassword@1',
      first_name: 'Inv',
      last_name: 'Ited',
    } as any);

    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].user_id).toBe('invited-user-id');
    expect(sessions[0].revoked_at).toBeNull();

    const successCall = mockSecurityEventService.record.mock.calls.find(
      (call) => call[0]?.type === SECURITY_EVENT_TYPES.LOGIN_SUCCESS,
    );
    expect(successCall).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────
  // TEST 5 — Every access token carries a distinct UUID jti
  // ─────────────────────────────────────────────────────────────────────
  it('every access token carries a distinct UUID jti claim', async () => {
    const a = (await service.login({ email: MOCK_USER.email!, password: 'pw' })) as any;
    const b = (await service.login({ email: MOCK_USER.email!, password: 'pw' })) as any;

    const aPayload = accessPayloads.get(a.access_token);
    const bPayload = accessPayloads.get(b.access_token);

    expect(aPayload?.jti).toBeDefined();
    expect(bPayload?.jti).toBeDefined();
    expect(typeof aPayload.jti).toBe('string');
    expect(typeof bPayload.jti).toBe('string');

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(aPayload.jti).toMatch(uuidRegex);
    expect(bPayload.jti).toMatch(uuidRegex);

    expect(aPayload.jti).not.toBe(bPayload.jti);
  });
});
