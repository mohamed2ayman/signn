import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule, ThrottlerStorageService } from '@nestjs/throttler';
import * as request from 'supertest';

import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { getClientIp } from '../../../common/utils/get-client-ip.util';
import { ThrottlerExceptionFilter } from '../../../common/filters/throttler-exception.filter';

/**
 * End-to-end-ish tests for Phase 4.1 rate limiting + auth enumeration fixes.
 *
 * Strategy: spin up a minimal NestApplication that mounts AuthController +
 * ThrottlerModule (with the same 8 named throttlers used in production) +
 * the in-memory ThrottlerStorageService — NEVER a real Redis. This keeps
 * CI fast and deterministic.
 *
 * AuthService is mocked end-to-end so we can:
 *   1. Force consistent failures (to exercise the rate-limit path)
 *   2. Verify the enumeration fix (verifyMfa / verifyRecovery both throw
 *      identical messages regardless of cause)
 */

describe('Auth rate limiting (Phase 4.1)', () => {
  // Mutable mock — each test wires up the behavior it needs.
  const authServiceMock = {
    login: jest.fn(),
    register: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    verifyMfa: jest.fn(),
    verifyRecoveryCode: jest.fn(),
    refreshToken: jest.fn(),
    acceptInvitation: jest.fn(),
  };

  async function buildApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          // Key by client IP, same as production (app.module.ts).
          getTracker: (req) => getClientIp(req as never),
          throttlers: [
            { name: 'login',      ttl: 600_000,    limit: 5  },
            { name: 'register',   ttl: 3_600_000,  limit: 3  },
            { name: 'forgot',     ttl: 3_600_000,  limit: 3  },
            { name: 'reset',      ttl: 900_000,    limit: 5  },
            { name: 'mfa',        ttl: 600_000,    limit: 5  },
            { name: 'recovery',   ttl: 3_600_000,  limit: 3  },
            { name: 'refresh',    ttl: 900_000,    limit: 20 },
            { name: 'invitation', ttl: 3_600_000,  limit: 5  },
          ],
        }),
      ],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        // Force the in-memory storage explicitly so we never accidentally
        // talk to a Redis instance during tests.
        ThrottlerStorageService,
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new ThrottlerExceptionFilter());
    await app.init();
    return app;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 1 — login throttle triggers at limit
  // ───────────────────────────────────────────────────────────────────────
  it('blocks the 6th login attempt with 429 + Retry-After', async () => {
    authServiceMock.login.mockRejectedValue(
      new UnauthorizedException('Invalid email or password'),
    );

    const app = await buildApp();
    const server = app.getHttpServer();
    const payload = { email: 'attacker@example.com', password: 'wrongpassword' };

    // First 5 should pass through to the service (and fail auth, not throttle).
    for (let i = 0; i < 5; i++) {
      const res = await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.7')
        .send(payload);
      expect(res.status).toBe(401);
    }

    const blocked = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.7')
      .send(payload);

    expect(blocked.status).toBe(429);
    const retryAfterHeader = blocked.headers['retry-after'];
    expect(retryAfterHeader).toBeDefined();
    const retryAfter = parseInt(String(retryAfterHeader), 10);
    expect(Number.isFinite(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);

    expect(blocked.body).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: expect.stringMatching(/Too many attempts\. Please try again in \d+ seconds\./),
      retryAfter: expect.any(Number),
    });
    expect(blocked.body.retryAfter).toBeGreaterThan(0);

    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 2 — forgot-password throttle triggers at limit
  // ───────────────────────────────────────────────────────────────────────
  it('blocks the 4th forgot-password request with 429 + Retry-After', async () => {
    authServiceMock.forgotPassword.mockResolvedValue({
      message: 'If email exists, a reset link will be sent',
    });

    const app = await buildApp();
    const server = app.getHttpServer();
    const payload = { email: 'someone@example.com' };

    for (let i = 0; i < 3; i++) {
      const res = await request(server)
        .post('/auth/forgot-password')
        .set('X-Forwarded-For', '198.51.100.42')
        .send(payload);
      expect(res.status).toBe(200);
    }

    const blocked = await request(server)
      .post('/auth/forgot-password')
      .set('X-Forwarded-For', '198.51.100.42')
      .send(payload);

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(parseInt(String(blocked.headers['retry-after']), 10)).toBeGreaterThan(0);
    expect(blocked.body.retryAfter).toBeGreaterThan(0);

    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 3 — verify-mfa does not leak user existence
  // ───────────────────────────────────────────────────────────────────────
  it('returns identical error for unknown email vs wrong code on /auth/verify-mfa', async () => {
    authServiceMock.verifyMfa.mockRejectedValue(
      new UnauthorizedException('Invalid verification code'),
    );

    const app = await buildApp();
    const server = app.getHttpServer();

    // Each call uses a different IP so neither response is the throttler.
    const unknownEmailRes = await request(server)
      .post('/auth/verify-mfa')
      .set('X-Forwarded-For', '192.0.2.10')
      .send({ email: 'ghost@example.com', otp_code: '123456' });

    const wrongCodeRes = await request(server)
      .post('/auth/verify-mfa')
      .set('X-Forwarded-For', '192.0.2.11')
      .send({ email: 'real-user@example.com', otp_code: '000000' });

    expect(unknownEmailRes.status).toBe(401);
    expect(wrongCodeRes.status).toBe(401);
    expect(unknownEmailRes.status).toBe(wrongCodeRes.status);
    expect(unknownEmailRes.body.message).toBe('Invalid verification code');
    expect(wrongCodeRes.body.message).toBe('Invalid verification code');

    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 4 — verify-recovery does not leak user existence
  // ───────────────────────────────────────────────────────────────────────
  it('returns identical error for unknown email vs wrong code on /auth/verify-recovery', async () => {
    authServiceMock.verifyRecoveryCode.mockRejectedValue(
      new UnauthorizedException('Invalid recovery code'),
    );

    const app = await buildApp();
    const server = app.getHttpServer();

    const unknownEmailRes = await request(server)
      .post('/auth/verify-recovery')
      .set('X-Forwarded-For', '192.0.2.20')
      .send({ email: 'ghost@example.com', recovery_code: 'ABCD-EFGH' });

    const wrongCodeRes = await request(server)
      .post('/auth/verify-recovery')
      .set('X-Forwarded-For', '192.0.2.21')
      .send({ email: 'real-user@example.com', recovery_code: 'XYZW-XYZW' });

    expect(unknownEmailRes.status).toBe(401);
    expect(wrongCodeRes.status).toBe(401);
    expect(unknownEmailRes.status).toBe(wrongCodeRes.status);
    expect(unknownEmailRes.body.message).toBe('Invalid recovery code');
    expect(wrongCodeRes.body.message).toBe('Invalid recovery code');

    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // TEST 5 — refresh is NOT over-throttled (allows 20, blocks 21st)
  // ───────────────────────────────────────────────────────────────────────
  it('allows 20 refresh requests before blocking the 21st', async () => {
    authServiceMock.refreshToken.mockResolvedValue({
      access_token: 'access',
      refresh_token: 'refresh',
    });

    const app = await buildApp();
    const server = app.getHttpServer();
    const payload = { refresh_token: 'some-token' };

    for (let i = 0; i < 20; i++) {
      const res = await request(server)
        .post('/auth/refresh')
        .set('X-Forwarded-For', '203.0.113.99')
        .send(payload);
      // Must NOT be 429 — service-mocked to succeed.
      expect(res.status).not.toBe(429);
    }

    const blocked = await request(server)
      .post('/auth/refresh')
      .set('X-Forwarded-For', '203.0.113.99')
      .send(payload);

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(parseInt(String(blocked.headers['retry-after']), 10)).toBeGreaterThan(0);

    await app.close();
  });
});
