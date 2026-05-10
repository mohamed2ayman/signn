import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import {
  User,
  UserRole,
  Organization,
  SubscriptionPlan,
  OrganizationSubscription,
} from '../../database/entities';
import { EmailService } from '../notifications/email.service';
import { NotificationDispatchService } from '../notifications/notification-dispatch.service';
import { SessionService } from '../admin-security/services/session.service';
import { KnownDeviceService } from '../admin-security/services/known-device.service';
import { SuspiciousLoginService } from '../admin-security/services/suspicious-login.service';
import { GeoLookupService } from '../admin-security/services/geo-lookup.service';
import { UserAgentService } from '../admin-security/services/user-agent.service';
import { SecurityEventService } from '../admin-security/services/security-event.service';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture — a normal active user, no MFA, no org (skips plan-MFA check)
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_USER: Partial<User> = {
  id: 'user-id-abc123',
  email: 'engineer@sign.com',
  password_hash: 'stored-bcrypt-hash',   // bcrypt.compare is mocked
  is_active: true,
  locked_until: null as unknown as Date,
  failed_login_attempts: 0,
  mfa_enabled: false,
  mfa_method: null as unknown as string,
  organization_id: null as unknown as string, // falsy → skips checkPlanRequiresMfa
  first_name: 'Ali',
  last_name: 'Hassan',
  role: UserRole.OWNER_ADMIN,
  // Fields stripped by sanitizeUser — present to satisfy the spread in sanitizeUser
  mfa_secret: null as unknown as string,
  mfa_totp_secret: null as unknown as string,
  mfa_recovery_codes: null as unknown as string[],
  refresh_token_hash: null as unknown as string,
};

// ─────────────────────────────────────────────────────────────────────────────
// Repository mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockUserRepository = {
  findOne: jest.fn(),
  update: jest.fn().mockResolvedValue({}),
  create: jest.fn(),
  save: jest.fn(),
};

const mockOrganizationRepository = {
  create: jest.fn(),
  save: jest.fn(),
};

const mockSubscriptionPlanRepository = {
  findOne: jest.fn().mockResolvedValue(null),
};

const mockOrgSubscriptionRepository = {
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn(),
  save: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Service mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockJwtService = {
  signAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
  verify: jest.fn().mockReturnValue({ sub: 'user-id-abc123', email: 'engineer@sign.com' }),
};

const mockConfigService = {
  // ConfigService.get() is called in generateTokens for JWT_SECRET / JWT_REFRESH_SECRET
  get: jest.fn().mockReturnValue('test-secret-key-minimum-16-chars'),
};

const mockEmailService = {
  sendMfaOtp: jest.fn().mockResolvedValue(undefined),
  sendMfaRecoveryCodes: jest.fn().mockResolvedValue(undefined),
  sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  sendContractApprovalRequest: jest.fn().mockResolvedValue(undefined),
};

const mockNotificationDispatchService = {
  enqueueEmail: jest.fn().mockResolvedValue(undefined),
};

// Phase 3.3 services — all used inside _finalizeLogin()

const mockSessionService = {
  create: jest.fn().mockResolvedValue({ id: 'session-id-xyz' }),
  revokeByToken: jest.fn().mockResolvedValue(undefined),
  revokeAllForUser: jest.fn().mockResolvedValue(undefined),
};

const mockKnownDeviceService = {
  // isNew: false → no new-device email, keeps _finalizeLogin path simple
  upsert: jest.fn().mockResolvedValue({ isNew: false }),
};

const mockSuspiciousLoginService = {
  // evaluate() is async
  evaluate: jest.fn().mockResolvedValue({ is_suspicious: false, reason: null }),
};

const mockGeoLookupService = {
  // lookup() is synchronous — note: no mockResolvedValue
  lookup: jest.fn().mockReturnValue({ country_code: 'EG', pretty: 'Cairo, Egypt' }),
};

const mockUserAgentService = {
  // parse() is synchronous
  parse: jest.fn().mockReturnValue({ browser: 'Chrome', os: 'Windows', device_type: 'Desktop' }),
};

const mockSecurityEventService = {
  record: jest.fn().mockResolvedValue(undefined),
  recordAtomic: jest.fn().mockResolvedValue(undefined),
};

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: user exists and is active
    mockUserRepository.findOne.mockResolvedValue(MOCK_USER);
    mockUserRepository.update.mockResolvedValue({});

    // Default: bcrypt compare succeeds (correct password), hash returns a mock hash.
    // mockImplementation avoids TypeScript overload-resolution issues on spied bcrypt functions.
    jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(true));
    jest.spyOn(bcrypt, 'hash').mockImplementation(() => Promise.resolve('mock-bcrypt-hash'));

    // Re-assert Phase 3.3 service return values after clearAllMocks
    mockSessionService.create.mockResolvedValue({ id: 'session-id-xyz' });
    mockKnownDeviceService.upsert.mockResolvedValue({ isNew: false });
    mockSuspiciousLoginService.evaluate.mockResolvedValue({ is_suspicious: false, reason: null });
    mockGeoLookupService.lookup.mockReturnValue({ country_code: 'EG', pretty: 'Cairo, Egypt' });
    mockUserAgentService.parse.mockReturnValue({ browser: 'Chrome', os: 'Windows', device_type: 'Desktop' });
    mockSecurityEventService.record.mockResolvedValue(undefined);
    mockJwtService.signAsync.mockResolvedValue('mock-jwt-token');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User),                 useValue: mockUserRepository },
        { provide: getRepositoryToken(Organization),         useValue: mockOrganizationRepository },
        { provide: getRepositoryToken(SubscriptionPlan),     useValue: mockSubscriptionPlanRepository },
        { provide: getRepositoryToken(OrganizationSubscription), useValue: mockOrgSubscriptionRepository },
        { provide: JwtService,                              useValue: mockJwtService },
        { provide: ConfigService,                           useValue: mockConfigService },
        { provide: EmailService,                            useValue: mockEmailService },
        { provide: NotificationDispatchService,             useValue: mockNotificationDispatchService },
        { provide: SessionService,                          useValue: mockSessionService },
        { provide: KnownDeviceService,                      useValue: mockKnownDeviceService },
        { provide: SuspiciousLoginService,                  useValue: mockSuspiciousLoginService },
        { provide: GeoLookupService,                        useValue: mockGeoLookupService },
        { provide: UserAgentService,                        useValue: mockUserAgentService },
        { provide: SecurityEventService,                    useValue: mockSecurityEventService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── login() ─────────────────────────────────────────────────────────────

  describe('login()', () => {
    const validDto = { email: 'engineer@sign.com', password: 'Correct@Pass1' };

    // ── Success path ────────────────────────────────────────────────────────

    it('returns an object containing access_token on successful login', async () => {
      const result = await service.login(validDto);
      expect(result).toHaveProperty('access_token');
      expect(result.access_token).toBe('mock-jwt-token');
    });

    it('returns an object containing refresh_token on successful login', async () => {
      const result = await service.login(validDto);
      expect(result).toHaveProperty('refresh_token');
    });

    // ── _finalizeLogin indirect verification ────────────────────────────────

    it('calls SessionService.create() exactly once after a successful login (verifies _finalizeLogin ran)', async () => {
      await service.login(validDto);
      expect(mockSessionService.create).toHaveBeenCalledTimes(1);
    });

    // ── Wrong password ──────────────────────────────────────────────────────

    it('throws UnauthorizedException when the password is wrong', async () => {
      jest.spyOn(bcrypt, 'compare').mockImplementation(() => Promise.resolve(false));
      await expect(service.login({ email: 'engineer@sign.com', password: 'WrongPass' }))
        .rejects.toThrow(UnauthorizedException);
    });

    // ── Unknown email ───────────────────────────────────────────────────────

    it('throws UnauthorizedException when the email does not exist', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.login({ email: 'ghost@sign.com', password: 'AnyPass1' }))
        .rejects.toThrow(UnauthorizedException);
    });

    // ── Deactivated account ─────────────────────────────────────────────────

    it('throws ForbiddenException when the account is deactivated', async () => {
      mockUserRepository.findOne.mockResolvedValue({ ...MOCK_USER, is_active: false });
      await expect(service.login(validDto))
        .rejects.toThrow(ForbiddenException);
    });

    // ── Locked account ──────────────────────────────────────────────────────

    it('throws ForbiddenException when the account is locked', async () => {
      const lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // locked for 30 more minutes
      mockUserRepository.findOne.mockResolvedValue({ ...MOCK_USER, locked_until: lockedUntil });
      await expect(service.login(validDto))
        .rejects.toThrow(ForbiddenException);
    });
  });
});
