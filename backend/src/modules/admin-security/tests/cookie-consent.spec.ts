import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { validate } from 'class-validator';

import { ProfileController } from '../controllers/profile.controller';
import { SessionService } from '../services/session.service';
import { PasswordPolicyService } from '../services/password-policy.service';
import { SecurityEventService } from '../services/security-event.service';
import { GdprExportService } from '../services/gdpr-export.service';
import { UpdateCookieConsentDto } from '../dto/admin-security.dto';
import { User } from '../../../database/entities';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';

// Minimal user fixture
const MOCK_USER: Partial<User> = {
  id: 'user-cookie-consent-abc',
  email: 'cookie@sign.com',
  cookie_consent_given_at: null,
  cookie_consent_version: null,
  marketing_email_opt_in: false,
  email_digest_opt_out: false,
  ai_training_opt_in: false,
};

describe('ProfileController — cookie consent', () => {
  let controller: ProfileController;
  let userRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn().mockResolvedValue({ ...MOCK_USER }),
      update: jest.fn().mockResolvedValue({}),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: SessionService, useValue: {} },
        { provide: PasswordPolicyService, useValue: {} },
        { provide: SecurityEventService, useValue: { record: jest.fn() } },
        { provide: GdprExportService, useValue: {} },
      ],
    }).compile();

    controller = moduleRef.get<ProfileController>(ProfileController);
  });

  // TEST 4 — endpoint requires authentication (guard wired at controller level)
  it('the /me controller is protected by JwtAuthGuard', () => {
    const guards = Reflect.getMetadata('__guards__', ProfileController) as unknown[] | undefined;
    expect(guards).toBeDefined();
    expect(guards!.some((g) => g === JwtAuthGuard)).toBe(true);
  });

  // TEST 5 — PATCH updates preferences and returns shape
  it('updateCookieConsent persists timestamp + version and returns the new preferences', async () => {
    const dto: UpdateCookieConsentDto = {
      functional: true,
      analytics: false,
      marketing: false,
    };

    const result = await controller.updateCookieConsent(MOCK_USER as User, dto);

    expect(userRepo.update).toHaveBeenCalledTimes(1);
    const [updateId, patch] = userRepo.update.mock.calls[0];
    expect(updateId).toBe(MOCK_USER.id);
    expect(patch.cookie_consent_given_at).toBeInstanceOf(Date);
    expect(patch.cookie_consent_version).toBe('1.0');
    expect(patch.marketing_email_opt_in).toBe(false);

    expect(result).toMatchObject({
      cookie_consent_version: '1.0',
      functional: true,
      analytics: false,
      marketing: false,
    });
    expect(result.cookie_consent_given_at).toBeInstanceOf(Date);
  });

  it('updateCookieConsent mirrors marketing into marketing_email_opt_in when true', async () => {
    const dto: UpdateCookieConsentDto = {
      functional: true,
      analytics: true,
      marketing: true,
    };

    await controller.updateCookieConsent(MOCK_USER as User, dto);

    const [, patch] = userRepo.update.mock.calls[0];
    expect(patch.marketing_email_opt_in).toBe(true);
  });

  // TEST 6 — body validation: missing required fields fails
  it('UpdateCookieConsentDto rejects bodies that omit required boolean fields', async () => {
    const dto = new UpdateCookieConsentDto();
    // No fields set — every field is required (no @IsOptional)
    const errors = await validate(dto);
    const properties = errors.map((e) => e.property).sort();
    expect(properties).toEqual(['analytics', 'functional', 'marketing']);
  });

  it('UpdateCookieConsentDto rejects non-boolean values', async () => {
    const dto = Object.assign(new UpdateCookieConsentDto(), {
      functional: 'yes',
      analytics: 1,
      marketing: null,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  // TEST GET — returns the current consent shape
  it('getCookieConsent returns the consent fields from the user row', async () => {
    userRepo.findOne.mockResolvedValue({
      ...MOCK_USER,
      cookie_consent_given_at: new Date('2026-05-01T00:00:00Z'),
      cookie_consent_version: '1.0',
      marketing_email_opt_in: true,
    });

    const result = await controller.getCookieConsent(MOCK_USER as User);
    expect(result).toEqual({
      cookie_consent_given_at: new Date('2026-05-01T00:00:00Z'),
      cookie_consent_version: '1.0',
      marketing_email_opt_in: true,
    });
  });
});
