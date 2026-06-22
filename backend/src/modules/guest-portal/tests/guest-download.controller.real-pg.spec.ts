import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as zlib from 'zlib';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  AccountType,
  Contract,
  GuestContractAccess,
  UserRole,
} from '../../../database/entities';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { ExportService } from '../../export/export.service';
import { ObligationScopedRepository } from '../../scoped-repository/obligation-scoped.repository';
import { RiskScopedRepository } from '../../scoped-repository/risk-scoped.repository';
import { GuestDownloadController } from '../controllers/guest-download.controller';

/**
 * Feature #3 — Guest Watermarked Download: REAL-Postgres tenancy + render proof.
 *
 * Runs against the live Postgres (sign-postgres) so the binding wall
 * (guest_contract_access → findForGuest) and the pdfmake render are exercised
 * for real — NOT mocked. CI is unit-test ONLY (CLAUDE.md), so this skips LOUDLY
 * when DATABASE_URL is unset; a silent skip would read green without proving the
 * tenancy decision against real rows.
 *
 * The JWT signature check is the ONE thing stubbed (overrideGuard) — exactly as
 * compliance-obligations.cross-tenant-walls.spec does. We inject the principal
 * the guard would have produced; everything downstream (account_type gate,
 * binding query, contract load, render) is real.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-download] SKIPPING real-Postgres spec (guest-download.controller.real-pg.spec.ts): ' +
      'DATABASE_URL unset — this MUST run against Postgres to prove the binding wall ' +
      '(404 on cross-contract) and the real watermark render. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

/** superagent binary parser — collect the PDF response as a Buffer. */
function binaryParser(res: any, cb: any): void {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk: string) => {
    data += chunk;
  });
  res.on('end', () => cb(null, Buffer.from(data, 'binary')));
}

/** Byte-scan every `stream`…`endstream` body out of the PDF. */
function extractStreams(pdf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  const S = Buffer.from('stream');
  const E = Buffer.from('endstream');
  let i = 0;
  for (;;) {
    const s = pdf.indexOf(S, i);
    if (s < 0) break;
    let start = s + S.length;
    if (pdf[start] === 0x0d) start++;
    if (pdf[start] === 0x0a) start++;
    const e = pdf.indexOf(E, start);
    if (e < 0) break;
    let end = e;
    if (pdf[end - 1] === 0x0a) end--;
    if (pdf[end - 1] === 0x0d) end--;
    out.push(pdf.subarray(start, end));
    i = e + E.length;
  }
  return out;
}

/**
 * Search the drawn text of a PDF. pdfmake/pdfkit writes text as hex strings
 * inside TJ arrays (`[<5369676e> 0] TJ`), frequently kern-split — so a literal
 * substring search fails. This inflates every stream, decodes every `<hex>`
 * token, and concatenates, reconstructing the drawn text regardless of kerning.
 */
function pdfContainsText(pdf: Buffer, needle: string): boolean {
  let content = pdf.toString('latin1');
  for (const s of extractStreams(pdf)) {
    try {
      content += zlib.inflateSync(s).toString('latin1');
    } catch {
      // not a Flate stream — skip
    }
  }
  if (content.includes(needle)) return true;
  let decoded = '';
  const reHex = /<([0-9A-Fa-f\s]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = reHex.exec(content)) !== null) {
    const hex = m[1].replace(/\s+/g, '');
    if (hex.length >= 2 && hex.length % 2 === 0) {
      try {
        decoded += Buffer.from(hex, 'hex').toString('latin1');
      } catch {
        // skip non-decodable token
      }
    }
  }
  return decoded.includes(needle);
}

describeReal('GuestDownloadController (real Postgres — binding wall + watermark)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;

  // Fixture refs.
  const orgId = randomUUID();
  const guestUserId = randomUUID();
  const projectId = randomUUID();
  const contractBoundId = randomUUID(); // guest IS bound to this one
  const contractUnboundId = randomUUID(); // guest is NOT bound
  const clauseId = randomUUID();
  const contractClauseId = randomUUID();
  const bindingId = randomUUID();
  const GUEST_EMAIL = `guest-dl-${guestUserId.slice(0, 8)}@external.test`;

  // The principal the (stubbed) JwtAuthGuard injects. Mutated per-test.
  let injectedUser: any;

  const GUEST_PRINCIPAL = () => ({
    id: guestUserId,
    email: GUEST_EMAIL,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });

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
        TypeOrmModule.forFeature([Contract, GuestContractAccess]),
      ],
      controllers: [GuestDownloadController],
      providers: [
        ContractAccessService,
        ExportService,
        // ExportService injects these two scoped repos but generateContractPdf
        // never touches them — stubs keep the DI graph satisfied.
        { provide: ObligationScopedRepository, useValue: {} },
        { provide: RiskScopedRepository, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(guardStub)
      .compile();

    dataSource = moduleRef.get(DataSource);
    app = moduleRef.createNestApplication();
    await app.init();

    // ─── Seed the fixture tree (raw SQL; deterministic ids for cleanup). ──
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
      orgId,
      `guest-dl-org-${orgId.slice(0, 8)}`,
    ]);
    // Guest user — account_type=GUEST, no organization (organization_id NULL).
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         is_active, is_email_verified, mfa_enabled, preferred_language,
         failed_login_attempts, onboarding_completed, onboarding_level,
         email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in
       )
       VALUES ($1, $2, $3, 'Guest', 'Party', 'GUEST', 'GUEST',
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [
        guestUserId,
        GUEST_EMAIL,
        '$2a$10$dummy.bcrypt.hash.placeholder.value.for.guest.dl.test.xx',
      ],
    );
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1, $2, $3, $4)`,
      [projectId, orgId, 'guest-dl-project', guestUserId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, 'Bound Contract A', 'FIDIC_RED_BOOK', $3)`,
      [contractBoundId, projectId, guestUserId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1, $2, 'Unbound Contract B', 'FIDIC_RED_BOOK', $3)`,
      [contractUnboundId, projectId, guestUserId],
    );
    await dataSource.query(
      `INSERT INTO clauses (id, title, content) VALUES ($1, $2, $3)`,
      [clauseId, 'Payment Terms', 'The Contractor shall be paid within 28 days.'],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number, order_index)
       VALUES ($1, $2, $3, '1', 0)`,
      [contractClauseId, contractBoundId, clauseId],
    );
    // The binding — guest is bound to contract A ONLY.
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1, $2, $3, $4)`,
      [bindingId, guestUserId, contractBoundId, guestUserId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM guest_contract_access WHERE id = $1`, [bindingId]);
      await dataSource.query(`DELETE FROM contract_clauses WHERE id = $1`, [contractClauseId]);
      await dataSource.query(`DELETE FROM clauses WHERE id = $1`, [clauseId]);
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [contractBoundId, contractUnboundId],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [guestUserId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    }
    await app?.close();
  });

  beforeEach(() => {
    injectedUser = GUEST_PRINCIPAL();
  });

  // ─── GREEN: bound guest downloads its own contract ─────────────────────
  it('GREEN — bound guest → 200 application/pdf carrying the watermark email', async () => {
    injectedUser = GUEST_PRINCIPAL();

    const res = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/pdf`)
      .set('Authorization', 'Bearer valid-token')
      .buffer()
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    // The stamp is REALLY drawn — the authenticated guest email is in the PDF.
    expect(pdfContainsText(pdf, GUEST_EMAIL)).toBe(true);
  });

  // ─── RED: cross-contract → 404 (NOT 403, no existence leak) ────────────
  it('RED — bound guest requesting an UNBOUND contract → 404', async () => {
    injectedUser = GUEST_PRINCIPAL();

    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractUnboundId}/pdf`)
      .set('Authorization', 'Bearer valid-token')
      .expect(404);
  });

  // ─── RED: managing-user principal → 403 ────────────────────────────────
  it('RED — non-guest (MANAGING) principal → 403', async () => {
    injectedUser = {
      id: guestUserId,
      email: 'manager@managing.test',
      role: UserRole.OWNER_ADMIN,
      organization_id: orgId,
      account_type: AccountType.MANAGING,
    };

    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/pdf`)
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });

  // ─── RED: viewer-shaped principal (Path A, no established identity) → 403 ─
  it('RED — viewer principal (no account_type=GUEST) cannot download → 403', async () => {
    // The real /viewer/* path never produces account_type=GUEST. Even if such a
    // sparse principal reached this route, the account_type gate rejects it.
    injectedUser = {
      type: 'viewer',
      viewer: { contract_id: contractBoundId, invitation_id: randomUUID() },
    };

    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/pdf`)
      .set('Authorization', 'Bearer valid-token')
      .expect(403);
  });

  // ─── RED: no auth → 401 ────────────────────────────────────────────────
  it('RED — no credential → 401', async () => {
    await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/pdf`)
      .expect(401);
  });

  // ─── Identity is SERVER-SIDE: a client-supplied email is ignored ───────
  it('IDENTITY — a client-supplied ?email= is ignored; stamp uses the principal email', async () => {
    injectedUser = GUEST_PRINCIPAL();
    const attacker = 'attacker@evil.test';

    const res = await request(app.getHttpServer())
      .get(`/guest/contracts/${contractBoundId}/pdf?email=${encodeURIComponent(attacker)}`)
      .set('Authorization', 'Bearer valid-token')
      .buffer()
      .parse(binaryParser);

    expect(res.status).toBe(200);
    const pdf = res.body as Buffer;
    expect(pdfContainsText(pdf, GUEST_EMAIL)).toBe(true);
    expect(pdfContainsText(pdf, attacker)).toBe(false);
  });
});
