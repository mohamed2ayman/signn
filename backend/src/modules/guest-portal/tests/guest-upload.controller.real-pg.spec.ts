import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  AccountType,
  Contract,
  GuestContractAccess,
  User,
  UserRole,
} from '../../../database/entities';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { DocumentProcessingService } from '../../document-processing/document-processing.service';
import { MeterKey } from '../../metering/enums/meter-key.enum';
import { NotificationDispatchService } from '../../notifications/notification-dispatch.service';
import { GuestUploadController } from '../controllers/guest-upload.controller';
import { GuestUploadService } from '../services/guest-upload.service';

/**
 * Feature #4 — Guest upload of a new contract version: REAL-Postgres proof.
 *
 * Runs against the live Postgres (sign-postgres) so the binding wall
 * (guest_contract_access → findForGuest) and the race-safe daily cap (the
 * advisory-lock count-and-create) are exercised for real — NOT mocked. CI is
 * unit-test ONLY (CLAUDE.md), so this skips LOUDLY when DATABASE_URL is unset.
 *
 * What is real here: the DataSource, ContractAccessService (binding wall +
 * host-org derivation), and GuestUploadService (the cap + advisory lock).
 * What is stubbed: the JWT guard (principal injected), the Throttler guard
 * (burst protection is orthogonal to the daily cap), the AI/storage/metering
 * pipeline behind `DocumentProcessingService.uploadAndProcess` (replaced with a
 * faithful stub that INSERTS a real `document_uploads` row — the artifact the
 * cap counts — and records its args so we can assert the GUEST meter + host-org
 * subject are wired), and NotificationDispatchService (spied).
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-upload] SKIPPING real-Postgres spec (guest-upload.controller.real-pg.spec.ts): ' +
      'DATABASE_URL unset — this MUST run against Postgres to prove the binding wall ' +
      '(404 on cross-contract) and the RACE-SAFE 5/day-per-contract cap (6 concurrent → ' +
      'exactly 5 succeed). CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

// A minimal valid-signature PDF buffer (magic-bytes %PDF…).
const VALID_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'utf8');
// A disguised payload — PE/EXE magic (MZ) renamed `.pdf` with a spoofed MIME.
const FAKE_EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describeReal('GuestUploadController / GuestUploadService (real Postgres)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let service: GuestUploadService;

  // Fixture refs.
  const orgId = randomUUID();
  const guestUserId = randomUUID();
  const ownerUserId = randomUUID(); // managing owner + OWNER_ADMIN of org
  const projectId = randomUUID();
  const contractBoundId = randomUUID(); // guest IS bound
  const contractUnboundId = randomUUID(); // guest is NOT bound
  const bindingId = randomUUID();
  const GUEST_EMAIL = `guest-up-${guestUserId.slice(0, 8)}@external.test`;
  const OWNER_EMAIL = `owner-up-${ownerUserId.slice(0, 8)}@managing.test`;

  // The principal the (stubbed) JwtAuthGuard injects. Mutated per-test.
  let injectedUser: any;

  // DocumentProcessingService stub — records args + inserts a real
  // document_uploads row (the artifact the cap counts) on its OWN connection
  // (dataSource.query, not the cap's outer transaction manager) — faithful to
  // production where uploadAndProcess persists via the global repository.
  const uploadAndProcessMock = jest.fn(
    async (
      contractId: string,
      _file: any,
      userId: string,
      orgArg: string,
      _opts: any,
    ) => {
      const id = randomUUID();
      await dataSource.query(
        `INSERT INTO document_uploads
           (id, contract_id, organization_id, file_url, file_name,
            processing_status, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, 'UPLOADED', $6)`,
        [id, contractId, orgArg, `http://x/${id}.pdf`, `${id}.pdf`, userId],
      );
      return {
        id,
        file_name: `${id}.pdf`,
        original_name: 'revised.pdf',
        processing_status: 'UPLOADED',
        created_at: new Date(),
      };
    },
  );

  const dispatchMock = jest.fn(async (_params: any) => undefined);

  const GUEST_PRINCIPAL = () => ({
    id: guestUserId,
    email: GUEST_EMAIL,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });

  const insertUser = async (
    id: string,
    email: string,
    role: string,
    accountType: string,
    org: string | null,
  ) => {
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       )
       VALUES ($1, $2, $3, 'Up', 'Test', $4, $5, $6,
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [
        id,
        email,
        '$2a$10$dummy.bcrypt.hash.placeholder.value.for.guest.up.test.x',
        role,
        accountType,
        org,
      ],
    );
  };

  const utcToday = () => new Date().toISOString().slice(0, 10);

  /** Count today's persisted GUEST upload artifacts on the bound contract. */
  const countGuestUploadsToday = async (): Promise<number> => {
    const utcDay = utcToday();
    const dayStart = new Date(`${utcDay}T00:00:00.000Z`).toISOString();
    const dayEnd = new Date(
      new Date(`${utcDay}T00:00:00.000Z`).getTime() + 86400000,
    ).toISOString();
    const rows = await dataSource.query(
      `SELECT count(*)::int AS c
         FROM document_uploads du JOIN users u ON u.id = du.uploaded_by
        WHERE du.contract_id = $1 AND u.account_type = 'GUEST'
          AND du.created_at >= $2 AND du.created_at < $3`,
      [contractBoundId, dayStart, dayEnd],
    );
    return Number(rows[0]?.c ?? 0);
  };

  /** Read the daily-cap counter row for the bound contract (today). */
  const readDailyCount = async (): Promise<number> => {
    const rows = await dataSource.query(
      `SELECT count FROM guest_upload_daily_counts
        WHERE contract_id = $1 AND day = $2`,
      [contractBoundId, utcToday()],
    );
    return rows.length ? Number(rows[0].count) : 0;
  };

  /** Seed the daily-cap counter row for the bound contract (today) to n. */
  const seedDailyCount = async (n: number): Promise<void> => {
    await dataSource.query(
      `INSERT INTO guest_upload_daily_counts (contract_id, day, count)
            VALUES ($1, $2, $3)
       ON CONFLICT (contract_id, day) DO UPDATE SET count = $3`,
      [contractBoundId, utcToday(), n],
    );
  };

  /** Clear the daily-cap counter rows for both fixture contracts. */
  const clearDailyCounts = async (): Promise<void> => {
    await dataSource.query(
      `DELETE FROM guest_upload_daily_counts WHERE contract_id = ANY($1)`,
      [[contractBoundId, contractUnboundId]],
    );
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    const guardStub = {
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        if (!req.headers.authorization?.includes('valid-token')) {
          throw new UnauthorizedException();
        }
        req.user = injectedUser;
        return true;
      },
    };

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        TypeOrmModule.forFeature([Contract, GuestContractAccess, User]),
      ],
      controllers: [GuestUploadController],
      providers: [
        GuestUploadService,
        ContractAccessService,
        { provide: DocumentProcessingService, useValue: { uploadAndProcess: uploadAndProcessMock } },
        { provide: NotificationDispatchService, useValue: { dispatch: dispatchMock } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardStub)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    dataSource = moduleRef.get(DataSource);
    service = moduleRef.get(GuestUploadService);
    app = moduleRef.createNestApplication();
    await app.init();

    // ─── Seed the fixture tree (raw SQL; deterministic ids for cleanup). ──
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
      orgId,
      `guest-up-org-${orgId.slice(0, 8)}`,
    ]);
    // Managing owner — also the org OWNER_ADMIN (host-notify recipient).
    await insertUser(ownerUserId, OWNER_EMAIL, 'OWNER_ADMIN', 'MANAGING', orgId);
    // Guest user — account_type=GUEST, no organization.
    await insertUser(guestUserId, GUEST_EMAIL, 'GUEST', 'GUEST', null);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, $3, $4)`,
      [projectId, orgId, 'guest-up-project', ownerUserId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, 'Bound Contract A', 'FIDIC_RED_BOOK', $3)`,
      [contractBoundId, projectId, ownerUserId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, 'Unbound Contract B', 'FIDIC_RED_BOOK', $3)`,
      [contractUnboundId, projectId, ownerUserId],
    );
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1, $2, $3, $4)`,
      [bindingId, guestUserId, contractBoundId, ownerUserId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM document_uploads WHERE contract_id = ANY($1)`,
        [[contractBoundId, contractUnboundId]],
      );
      await clearDailyCounts();
      await dataSource.query(`DELETE FROM guest_contract_access WHERE id = $1`, [bindingId]);
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [contractBoundId, contractUnboundId],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [guestUserId, ownerUserId],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await app?.close();
  });

  beforeEach(async () => {
    injectedUser = GUEST_PRINCIPAL();
    uploadAndProcessMock.mockClear();
    dispatchMock.mockClear();
    // Reset uploads + the daily-cap counter so each test starts known.
    await dataSource.query(
      `DELETE FROM document_uploads WHERE contract_id = ANY($1)`,
      [[contractBoundId, contractUnboundId]],
    );
    await clearDailyCounts();
  });

  // ─── GREEN: bound guest uploads a valid PDF to its own contract ────────
  it('GREEN — bound guest + valid PDF → 201, charges GUEST meter to host org, notifies managing party', async () => {
    const res = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/documents`)
      .set('Authorization', 'Bearer valid-token')
      .attach('file', VALID_PDF, { filename: 'revised.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.processing_status).toBe('UPLOADED');

    // The extraction pipeline was invoked exactly once, charged to the
    // SEPARATE guest meter, with SUBJECT = host org (NOT the guest's null org),
    // account_type GUEST.
    expect(uploadAndProcessMock).toHaveBeenCalledTimes(1);
    const [calledContractId, , calledUserId, calledOrgId, calledOpts] =
      uploadAndProcessMock.mock.calls[0];
    expect(calledContractId).toBe(contractBoundId);
    expect(calledUserId).toBe(guestUserId);
    expect(calledOrgId).toBe(orgId); // host org, derived from contract→project
    expect(calledOpts).toEqual(
      expect.objectContaining({
        account_type: 'GUEST',
        meterKey: MeterKey.GUEST_UPLOAD,
      }),
    );

    // Managing party (contract.creator = the owner) was notified — net-new.
    const titles = dispatchMock.mock.calls.map((c) => c[0].title);
    expect(titles).toContain('New contract version uploaded by guest');
    const ownerCall = dispatchMock.mock.calls.find((c) => c[0].userId === ownerUserId);
    expect(ownerCall).toBeDefined();
  });

  // ─── RED: cross-contract → 404 (NOT 403, no existence leak) ────────────
  it('RED — bound guest uploading to an UNBOUND contract → 404, no upload', async () => {
    const res = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractUnboundId}/documents`)
      .set('Authorization', 'Bearer valid-token')
      .attach('file', VALID_PDF, { filename: 'revised.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(404);
    expect(uploadAndProcessMock).not.toHaveBeenCalled();
  });

  // ─── RED: managing-user principal → 403 (Path B requires account_type=GUEST) ─
  it('RED — non-guest (MANAGING) principal → 403, no upload', async () => {
    injectedUser = {
      id: ownerUserId,
      email: OWNER_EMAIL,
      role: UserRole.OWNER_ADMIN,
      organization_id: orgId,
      account_type: AccountType.MANAGING,
    };
    const res = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/documents`)
      .set('Authorization', 'Bearer valid-token')
      .attach('file', VALID_PDF, { filename: 'revised.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
    expect(uploadAndProcessMock).not.toHaveBeenCalled();
  });

  // ─── RED: viewer-shaped principal (Path A) cannot upload → 403 ─────────
  it('RED — viewer principal (no account_type=GUEST) cannot upload → 403', async () => {
    injectedUser = {
      type: 'viewer',
      viewer: { contract_id: contractBoundId, invitation_id: randomUUID() },
    };
    const res = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/documents`)
      .set('Authorization', 'Bearer valid-token')
      .attach('file', VALID_PDF, { filename: 'revised.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(403);
    expect(uploadAndProcessMock).not.toHaveBeenCalled();
  });

  // ─── RED: no credential → 401 ──────────────────────────────────────────
  it('RED — no credential → 401', async () => {
    await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/documents`)
      .attach('file', VALID_PDF, { filename: 'revised.pdf', contentType: 'application/pdf' })
      .expect(401);
  });

  // ─── RED: magic-bytes — executable disguised as .pdf → 400 ─────────────
  it('RED — disguised payload (EXE renamed .pdf, spoofed MIME) → 400, no upload', async () => {
    const res = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/documents`)
      .set('Authorization', 'Bearer valid-token')
      .attach('file', FAKE_EXE, { filename: 'evil.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(uploadAndProcessMock).not.toHaveBeenCalled();
  });

  // ─── RED + NOTIFY: 6th upload in a UTC day → 429 + host notified ───────
  it('RED — at daily cap (6th in a day) → 429 quota error + host OWNER_ADMIN notified, NOT silent, NOT accepted', async () => {
    // The contract has already hit the cap today.
    await seedDailyCount(5);
    uploadAndProcessMock.mockClear();
    dispatchMock.mockClear();

    const res = await request(app.getHttpServer())
      .post(`/guest/contracts/${contractBoundId}/documents`)
      .set('Authorization', 'Bearer valid-token')
      .attach('file', VALID_PDF, { filename: 'revised.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('GUEST_UPLOAD_DAILY_LIMIT');
    // Not silent: the host OWNER_ADMIN was notified of the cap hit.
    const capTitles = dispatchMock.mock.calls.map((c) => c[0].title);
    expect(capTitles).toContain('Guest reached daily upload limit');
    expect(dispatchMock.mock.calls.some((c) => c[0].userId === ownerUserId)).toBe(true);
    // Not accepted: no new upload, counter unchanged at the cap.
    expect(uploadAndProcessMock).not.toHaveBeenCalled();
    expect(await readDailyCount()).toBe(5);
    expect(await countGuestUploadsToday()).toBe(0);
  });

  // ─── CONCURRENCY PROOF: 6 concurrent → EXACTLY 5 succeed ───────────────
  it('CONCURRENCY — 6 simultaneous guest uploads (same contract, same day) → EXACTLY 5 succeed, 6th capped (race-safe)', async () => {
    // Direct service calls bypass the network burst throttle so this isolates
    // the daily-cap advisory lock (the burst throttle would otherwise reject
    // the 6th as a throttle-429, masking the cap).
    const file = {
      fieldname: 'file',
      originalname: 'revised.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: VALID_PDF,
      size: VALID_PDF.length,
    };
    const guest = GUEST_PRINCIPAL();

    const attempts = Array.from({ length: 6 }, () =>
      service.guestUploadNewVersion({ contractId: contractBoundId, guest, file: file as any }),
    );
    const settled = await Promise.allSettled(attempts);

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter(
      (s): s is PromiseRejectedResult => s.status === 'rejected',
    );

    // The cap MUST close the TOCTOU hole: never 6 successes.
    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(1);
    // The single rejection is the daily-cap quota error (429), not a DB error.
    const status = rejected[0].reason?.getStatus?.();
    expect(status).toBe(429);
    expect(rejected[0].reason?.getResponse?.()?.error).toBe('GUEST_UPLOAD_DAILY_LIMIT');
    // The atomic conditional UPSERT-counter serialized the claims: exactly 5
    // slots claimed and exactly 5 upload artifacts persisted, never 6.
    expect(await readDailyCount()).toBe(5);
    expect(await countGuestUploadsToday()).toBe(5);
  });
});
