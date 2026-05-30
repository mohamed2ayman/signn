import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PortfolioExportTokenService } from './portfolio-export-token.service';
import {
  PortfolioExportJob,
  PortfolioExportStatus,
} from '../entities/portfolio-export-job.entity';

/**
 * Phase 7.17 Prompt 2c — PortfolioExportTokenService unit tests.
 *
 * Coverage rationale (locked at plan review):
 *   - happy roundtrip
 *   - malformed (4 shapes)
 *   - tampered signature + tampered payload (HMAC mismatch)
 *   - expired (payload claim + DB-side re-check)
 *   - not_found (no row + wrong-user_id binding)
 *   - WRONG-SECRET rejection — the user-mandated test; proves the secret
 *     is genuinely the security floor, not a silent fallback / empty
 *     string. Also asserts no DB call (HMAC-before-DB ordering).
 *   - dedicated no-DB-on-HMAC-fail regression test — the explicit
 *     invariant the user named. Any verify() refactor that reorders
 *     the chain trips this test.
 */

// Both secrets at min(32) per Joi schema.
const SECRET_A = 'test-portfolio-export-secret-aaaaaaaa-32+chars-LEN';
const SECRET_B = 'test-portfolio-export-secret-bbbbbbbb-32+chars-LEN';

function makeJob(
  overrides: Partial<PortfolioExportJob> = {},
): PortfolioExportJob {
  const job = new PortfolioExportJob();
  job.id = '11111111-1111-1111-1111-111111111111';
  job.user_id = '22222222-2222-2222-2222-222222222222';
  job.org_id = '33333333-3333-3333-3333-333333333333';
  job.project_id = null;
  job.period = '90d';
  job.status = PortfolioExportStatus.COMPLETED;
  job.file_path = '/uploads/portfolio-exports/x.pdf';
  job.email = 'user@example.com';
  job.error = null;
  job.expires_at = new Date(Date.now() + 60 * 60 * 1000);
  job.created_at = new Date();
  job.completed_at = new Date();
  job.file_deleted = false;
  return Object.assign(job, overrides);
}

async function makeService(secret: string, findOne: jest.Mock) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      PortfolioExportTokenService,
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string) =>
            key === 'PORTFOLIO_EXPORT_DOWNLOAD_SECRET' ? secret : undefined,
          ),
        },
      },
      {
        provide: getRepositoryToken(PortfolioExportJob),
        useValue: { findOne },
      },
    ],
  }).compile();
  return moduleRef.get(PortfolioExportTokenService);
}

describe('PortfolioExportTokenService', () => {
  describe('issue + verify happy roundtrip', () => {
    it('verifies a freshly-issued token and returns the matching job row', async () => {
      const job = makeJob();
      const findOne = jest.fn().mockResolvedValue(job);
      const svc = await makeService(SECRET_A, findOne);

      const token = svc.issue(job.id, job.user_id!, job.expires_at!);
      const result = await svc.verify(token);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.job).toBe(job);
      expect(findOne).toHaveBeenCalledTimes(1);
      expect(findOne).toHaveBeenCalledWith({
        where: {
          id: job.id,
          user_id: job.user_id,
          status: PortfolioExportStatus.COMPLETED,
        },
      });
    });
  });

  describe('malformed tokens', () => {
    it('rejects empty string', async () => {
      const findOne = jest.fn();
      const svc = await makeService(SECRET_A, findOne);
      const r = await svc.verify('');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('malformed');
      expect(findOne).not.toHaveBeenCalled();
    });

    it('rejects token with no separator', async () => {
      const findOne = jest.fn();
      const svc = await makeService(SECRET_A, findOne);
      const r = await svc.verify('nodotinthistoken');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('malformed');
      expect(findOne).not.toHaveBeenCalled();
    });

    it('rejects token with leading dot', async () => {
      const findOne = jest.fn();
      const svc = await makeService(SECRET_A, findOne);
      const r = await svc.verify('.somesignature');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('malformed');
      expect(findOne).not.toHaveBeenCalled();
    });

    it('rejects token with trailing dot', async () => {
      const findOne = jest.fn();
      const svc = await makeService(SECRET_A, findOne);
      const r = await svc.verify('somepayload.');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('malformed');
      expect(findOne).not.toHaveBeenCalled();
    });
  });

  describe('tampered signature / tampered payload', () => {
    it('rejects a token whose signature has been modified (first signature byte flipped)', async () => {
      const job = makeJob();
      const findOne = jest.fn().mockResolvedValue(job);
      const svc = await makeService(SECRET_A, findOne);

      const token = svc.issue(job.id, job.user_id!, job.expires_at!);
      const dotIdx = token.indexOf('.');
      const sigStart = dotIdx + 1;
      // Tamper the FIRST byte of the signature, NOT the last. The last
      // base64url char of a 43-char HMAC-SHA256 sig has only 4 data
      // bits + 2 padding bits; flipping a single char there can leave
      // the decoded buffer unchanged ~6% of the time and falsely
      // verify. The first signature char carries 6 data bits (no
      // padding) so any flip cleanly changes the decoded buffer.
      const firstSigChar = token[sigStart];
      const flipped = firstSigChar === 'A' ? 'B' : 'A';
      const tampered = token.slice(0, sigStart) + flipped + token.slice(sigStart + 1);

      const r = await svc.verify(tampered);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_signature');
      // CRITICAL: no DB call when HMAC fails.
      expect(findOne).not.toHaveBeenCalled();
    });

    it('rejects a token whose payload has been swapped (signature no longer covers it)', async () => {
      const job = makeJob();
      const findOne = jest.fn().mockResolvedValue(job);
      const svc = await makeService(SECRET_A, findOne);

      const token = svc.issue(job.id, job.user_id!, job.expires_at!);
      const sig = token.slice(token.indexOf('.') + 1);

      const forgedPayload = Buffer.from(
        JSON.stringify({
          job_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          user_id: job.user_id,
          expires_at: Math.floor(job.expires_at!.getTime() / 1000),
        }),
        'utf-8',
      ).toString('base64url');

      const r = await svc.verify(`${forgedPayload}.${sig}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_signature');
      expect(findOne).not.toHaveBeenCalled();
    });
  });

  describe('expired token', () => {
    it('rejects when payload expires_at is in the past — short-circuits before DB', async () => {
      const past = new Date(Date.now() - 60_000);
      const findOne = jest.fn();
      const svc = await makeService(SECRET_A, findOne);

      const token = svc.issue(
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        past,
      );

      const r = await svc.verify(token);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('expired');
      // Payload-side expiry short-circuits the DB lookup (efficiency).
      expect(findOne).not.toHaveBeenCalled();
    });

    it('rejects when DB-side expires_at is past, even if payload claims valid — defense in depth', async () => {
      const futureToken = new Date(Date.now() + 60 * 60 * 1000);
      const job = makeJob({ expires_at: new Date(Date.now() - 60_000) });
      const findOne = jest.fn().mockResolvedValue(job);
      const svc = await makeService(SECRET_A, findOne);

      const token = svc.issue(job.id, job.user_id!, futureToken);
      const r = await svc.verify(token);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('expired');
    });
  });

  describe('not_found', () => {
    it('returns not_found when no job row matches', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const svc = await makeService(SECRET_A, findOne);

      const token = svc.issue(
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        new Date(Date.now() + 60 * 60 * 1000),
      );
      const r = await svc.verify(token);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not_found');
      expect(findOne).toHaveBeenCalledTimes(1);
    });

    it('returns not_found when the payload user_id does not match the row user_id (DB filter)', async () => {
      // The DB query filters on user_id from the payload. A token signed for
      // one user cannot pull another user's row even if attacker knows job_id.
      const findOne = jest.fn().mockResolvedValue(null);
      const svc = await makeService(SECRET_A, findOne);

      const token = svc.issue(
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        new Date(Date.now() + 60 * 60 * 1000),
      );
      const r = await svc.verify(token);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not_found');
      expect(findOne).toHaveBeenCalledWith({
        where: {
          id: '11111111-1111-1111-1111-111111111111',
          user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          status: PortfolioExportStatus.COMPLETED,
        },
      });
    });
  });

  describe('wrong-secret rejection (the user-mandated security-floor test)', () => {
    it('rejects a token signed with secret A when verified by a service using secret B', async () => {
      const job = makeJob();
      const findOneA = jest.fn().mockResolvedValue(job);
      const findOneB = jest.fn().mockResolvedValue(job);

      const svcA = await makeService(SECRET_A, findOneA);
      const svcB = await makeService(SECRET_B, findOneB);

      const token = svcA.issue(job.id, job.user_id!, job.expires_at!);
      const r = await svcB.verify(token);

      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_signature');
      // Proves PORTFOLIO_EXPORT_DOWNLOAD_SECRET is the ENTIRE security floor:
      // change the secret and tokens stop validating. No DB call either —
      // Postgres is off the unauthenticated attack surface (Phase 7.17
      // Prompt 2c §3 #11 finding).
      expect(findOneB).not.toHaveBeenCalled();
    });
  });

  describe('no-DB-on-HMAC-fail regression test (HMAC-before-DB ordering invariant)', () => {
    it('does not call jobRepo.findOne when the signature is invalid', async () => {
      // Dedicated regression test for the ordering invariant the user named
      // at plan review. Any refactor that moves the DB lookup ahead of the
      // HMAC check trips this test rather than silently regressing the
      // security floor.
      const job = makeJob();
      const findOne = jest.fn().mockResolvedValue(job);
      const svc = await makeService(SECRET_A, findOne);

      const token = svc.issue(job.id, job.user_id!, job.expires_at!);
      const payloadB64 = token.slice(0, token.indexOf('.'));
      // Replace the signature with garbage of the right base64url shape
      // (43 chars = 32-byte HMAC encoded). Length matches so we exercise
      // the timingSafeEqual path, not the length-mismatch early return.
      const garbageSig = 'a'.repeat(43);

      const r = await svc.verify(`${payloadB64}.${garbageSig}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_signature');
      expect(findOne).not.toHaveBeenCalled();
    });
  });
});
