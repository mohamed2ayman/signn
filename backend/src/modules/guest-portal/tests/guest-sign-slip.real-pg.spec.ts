import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  AuditLog,
  Clause,
  Contract,
  ContractClause,
  ContractVersion,
  GuestContractAccess,
  GuestSignSlip,
  User,
} from '../../../database/entities';
import { ContractsService } from '../../contracts/contracts.service';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { ContractPinningService } from '../../contracts/services/contract-pinning.service';
import { GuestSignSlipService } from '../../contracts/services/guest-sign-slip.service';
import { GuestSignController } from '../controllers/guest-sign.controller';

/**
 * ⭐ Guest Signing v1 — the SLIP door (real Postgres).
 *
 * Proves the locked invariants:
 *
 *   1. LEAK-SAFETY (the required test) — no-binding vs binding-but-no-slip
 *      → INDISTINGUISHABLE uniform 404 (equal status AND deep-equal body)
 *      for BOTH the slip-status GET and the accept POST. A bare binding
 *      NEVER implies signing (default-deny).
 *   1b. ORPHAN SLIP (Ayman's regression) — LIVE slip + REVOKED binding →
 *      uniform 404 on GET and accept, IDENTICAL to the no-binding and
 *      binding-no-slip 404s; nothing pinned, slip never advances. Guards the
 *      !hasBinding term (the sole cross-org grant) WITH a live slip present —
 *      a live slip alone must never authorize.
 *   2. ORG-ID-INERT — the grantee is seeded with a NON-NULL foreign
 *      organization_id and the door works purely on binding + slip: the
 *      caller's org is never read, never required, never a grant.
 *   3. LIFECYCLE — PENDING → ACCEPTED → EXECUTED: the contract is pinned via
 *      the EXISTING pinExecutedContract (door 'GUEST_SIGN'), version + hash
 *      captured onto the slip, signature_status FULLY_EXECUTED, audit row
 *      'guest_contract_signed' emitted.
 *   4. DOUBLE-ACCEPT IDEMPOTENCY — second click → already-pinned no-op, no
 *      error, acceptance still recorded, no duplicate audit.
 *   5. ALREADY-PINNED-FIRST — host pins manually while the slip is PENDING,
 *      THEN the guest accepts → acceptance recorded against the EXISTING
 *      pin (version + hash captured), no error.
 *   6. HOST VOID — void before execute kills the slip (uniform 404 for the
 *      guest, nothing pinned); void after execute → 400.
 *   7. ISSUANCE GUARDS — grantee without a binding is REJECTED (no dead
 *      slips); non-signable status rejected; duplicate active slip 409;
 *      cross-org issuance 404.
 *
 * CI is unit-test ONLY (CLAUDE.md) — skips LOUDLY when DATABASE_URL is unset.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-sign-slip] SKIPPING guest-sign-slip.real-pg.spec.ts: DATABASE_URL ' +
      'unset — the leak-safety + lifecycle + idempotency invariants MUST be ' +
      'proven against real Postgres.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(120_000);

const tag = randomUUID().slice(0, 8);

describeReal('⭐ Guest Signing v1 — slip door (real Postgres)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;
  let contractsService: ContractsService;
  let contractAccess: ContractAccessService;
  let pinning: ContractPinningService;
  let slipService: GuestSignSlipService;

  // ─── Fixture ids ─────────────────────────────────────────────────────────
  const hostOrgId = randomUUID(); // the HOST org — owns every contract here
  const guestOrgId = randomUUID(); // the counterparty's OWN org (org-id-inert)
  const foreignOrgId = randomUUID(); // an unrelated org (cross-org issuance)

  const hostOwnerId = randomUUID(); // host org — APPROVER-side actor
  const counterpartyId = randomUUID(); // MANAGING, guestOrg — bound + slip
  const boundNoSlipId = randomUUID(); // MANAGING, guestOrg — bound, NO slip
  const unboundId = randomUUID(); // MANAGING, guestOrg — NO binding

  const projectId = randomUUID(); // host org

  const contractMainId = randomUUID(); // lifecycle + double-accept
  const contractPrePinId = randomUUID(); // already-pinned-first
  const contractVoidId = randomUUID(); // void-before-execute
  const contractLeakId = randomUUID(); // leak-safety (binding for boundNoSlip)
  const contractDraftId = randomUUID(); // issuance status guard (DRAFT)
  const contractOrphanId = randomUUID(); // orphan slip: LIVE slip + REVOKED binding

  const allContractIds = [
    contractMainId,
    contractPrePinId,
    contractVoidId,
    contractLeakId,
    contractDraftId,
    contractOrphanId,
  ];

  let injectedUser: any;

  const COUNTERPARTY = () => ({
    id: counterpartyId,
    role: 'OWNER_ADMIN',
    organization_id: guestOrgId, // NON-NULL — the org-id-inert proof rides on this
    account_type: 'MANAGING',
  });
  const BOUND_NO_SLIP = () => ({
    id: boundNoSlipId,
    role: 'OWNER_ADMIN',
    organization_id: guestOrgId,
    account_type: 'MANAGING',
  });
  const UNBOUND = () => ({
    id: unboundId,
    role: 'OWNER_ADMIN',
    organization_id: guestOrgId,
    account_type: 'MANAGING',
  });

  const insertUser = (id: string, org: string | null) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,'$2a$10$guestsign.hash.sentinel.not.real.hash',
                 'Sign','Test','OWNER_ADMIN','MANAGING',$3,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `sign-${id.slice(0, 8)}@test.local`, org],
    );

  const insertContract = (id: string, name: string, status: string) =>
    dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, status,
                              current_version, creation_flow, created_by,
                              party_first_name, party_second_name)
       VALUES ($1,$2,$3,'UPLOADED',$4,1,'UPLOAD',$5,
               'الهيئة القومية للأنفاق','شركة المقاولون العرب')`,
      [id, projectId, name, status, hostOwnerId],
    );

  const seedClause = async (contractId: string, order: number) => {
    const clauseId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, clause_type,
                            source, review_status, version, is_active,
                            confidence_score, created_by)
       VALUES ($1,$2,$3,$4,'payment_terms','AI_EXTRACTED','APPROVED',1,TRUE,
               0.9,$5)`,
      [
        clauseId,
        hostOrgId,
        `شرط رقم ${order} — ${tag}`,
        `محتوى الشرط ${order} للعقد ${contractId.slice(0, 8)}`,
        hostOwnerId,
      ],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number,
                                     order_index, is_proposed)
       VALUES ($1,$2,$3,$4,$5,FALSE)`,
      [randomUUID(), contractId, clauseId, String(order), order],
    );
  };

  const insertBinding = (userId: string, contractId: string) =>
    dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), userId, contractId, hostOwnerId],
    );

  const getSlipRows = (contractId: string): Promise<any[]> =>
    dataSource.query(
      `SELECT * FROM guest_sign_slips WHERE contract_id = $1
        ORDER BY granted_at ASC`,
      [contractId],
    );

  const getContractRow = async (contractId: string): Promise<any> =>
    (
      await dataSource.query(`SELECT * FROM contracts WHERE id = $1`, [
        contractId,
      ])
    )[0];

  const getSignAudits = (contractId: string): Promise<any[]> =>
    dataSource.query(
      `SELECT * FROM audit_logs
        WHERE action = 'guest_contract_signed' AND entity_id = $1`,
      [contractId],
    );

  const getSlip = (principal: any, contractId: string) => {
    injectedUser = principal;
    return request(app.getHttpServer())
      .get(`/guest/contracts/${contractId}/sign-slip`)
      .set('Authorization', 'Bearer test-jwt');
  };

  const acceptSlip = (principal: any, contractId: string) => {
    injectedUser = principal;
    return request(app.getHttpServer())
      .post(`/guest/contracts/${contractId}/sign-slip/accept`)
      .set('Authorization', 'Bearer test-jwt');
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
      ],
      controllers: [GuestSignController],
      providers: [
        {
          provide: GuestSignSlipService,
          useFactory: (ds: DataSource) => {
            contractAccess = new ContractAccessService(
              ds.getRepository(Contract),
              ds.getRepository(GuestContractAccess),
            );
            // Manual ContractsService construction — the signed-state-pinning
            // precedent: real repos for the exercised paths
            // (createVersionSnapshot), `{} as any` for the rest.
            contractsService = new ContractsService(
              ds.getRepository(Contract),
              ds.getRepository(ContractClause),
              ds.getRepository(ContractVersion),
              {} as any,
              {} as any,
              {} as any,
              ds.getRepository(User),
              {} as any,
              {} as any,
              {} as any,
              {} as any,
              contractAccess,
              {} as any,
              {} as any,
              {} as any,
              {} as any,
              {} as any,
              ds.getRepository(Clause),
              {} as any, // relationshipTypes (T0a) — not exercised
            );
            pinning = new ContractPinningService(
              ds,
              contractsService,
              contractAccess,
              ds.getRepository(AuditLog),
            );
            slipService = new GuestSignSlipService(
              ds,
              contractAccess,
              pinning,
              ds.getRepository(GuestSignSlip),
              ds.getRepository(Contract),
              ds.getRepository(AuditLog),
            );
            return slipService;
          },
          inject: [DataSource],
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!injectedUser) {
            throw new UnauthorizedException();
          }
          ctx.switchToHttp().getRequest().user = injectedUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = moduleRef.get(DataSource);

    // ── Orgs / users / project ──
    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1,$2), ($3,$4), ($5,$6)`,
      [
        hostOrgId,
        `sign-host-org-${tag}`,
        guestOrgId,
        `sign-guest-org-${tag}`,
        foreignOrgId,
        `sign-foreign-org-${tag}`,
      ],
    );
    await insertUser(hostOwnerId, hostOrgId);
    await insertUser(counterpartyId, guestOrgId); // NON-NULL org — org-id-inert
    await insertUser(boundNoSlipId, guestOrgId);
    await insertUser(unboundId, guestOrgId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by)
       VALUES ($1,$2,'sign-project',$3)`,
      [projectId, hostOrgId, hostOwnerId],
    );

    // ── Contracts (host org). ACTIVE ∈ MARK_SIGNED_ALLOWED_STATUSES. ──
    await insertContract(contractMainId, `عقد التنفيذ الرئيسي ${tag}`, 'ACTIVE');
    await insertContract(contractPrePinId, `عقد مُنفَّذ مسبقاً ${tag}`, 'ACTIVE');
    await insertContract(contractVoidId, `عقد الإلغاء ${tag}`, 'ACTIVE');
    await insertContract(contractLeakId, `عقد التسريب ${tag}`, 'ACTIVE');
    await insertContract(contractDraftId, `عقد مسودة ${tag}`, 'DRAFT');
    // Orphan-slip fixture: ACTIVE (signable) so the slip can be ISSUED; its
    // binding is created + then REVOKED inside the test (not here).
    await insertContract(contractOrphanId, `عقد اليتيم ${tag}`, 'ACTIVE');
    for (const cid of [contractMainId, contractPrePinId, contractVoidId]) {
      await seedClause(cid, 1);
      await seedClause(cid, 2);
    }

    // ── Bindings ──
    await insertBinding(counterpartyId, contractMainId);
    await insertBinding(counterpartyId, contractPrePinId);
    await insertBinding(counterpartyId, contractVoidId);
    await insertBinding(boundNoSlipId, contractLeakId); // bound, NEVER a slip
    await insertBinding(counterpartyId, contractDraftId); // bound; DRAFT status
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // FK is ON DELETE RESTRICT on the pin pointer — clear before versions.
      await dataSource.query(
        `UPDATE contracts SET pinned_version_id = NULL WHERE id = ANY($1)`,
        [allContractIds],
      );
      await dataSource.query(
        `DELETE FROM audit_logs WHERE entity_id = ANY($1)`,
        [allContractIds],
      );
      await dataSource.query(
        `DELETE FROM guest_sign_slips WHERE contract_id = ANY($1)`,
        [allContractIds],
      );
      await dataSource.query(
        `DELETE FROM guest_contract_access WHERE contract_id = ANY($1)`,
        [allContractIds],
      );
      await dataSource.query(
        `DELETE FROM contract_versions WHERE contract_id = ANY($1)`,
        [allContractIds],
      );
      await dataSource.query(
        `DELETE FROM contract_clauses WHERE contract_id = ANY($1)`,
        [allContractIds],
      );
      await dataSource.query(
        `DELETE FROM clauses WHERE organization_id = $1`,
        [hostOrgId],
      );
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        allContractIds,
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [hostOwnerId, counterpartyId, boundNoSlipId, unboundId],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [hostOrgId, guestOrgId, foreignOrgId],
      ]);
    }
    await app?.close();
  });

  // ═══ 1. LEAK-SAFETY — the REQUIRED test ═══════════════════════════════════

  describe('LEAK-SAFETY: uniform 404, no existence oracle', () => {
    it('slip-status GET: no-binding vs binding-but-no-slip are INDISTINGUISHABLE', async () => {
      const noBinding = await getSlip(UNBOUND(), contractLeakId);
      const bindingNoSlip = await getSlip(BOUND_NO_SLIP(), contractLeakId);

      expect(noBinding.status).toBe(404);
      expect(bindingNoSlip.status).toBe(404);
      // Deep-equal BODY — byte-identical envelopes, no distinguishable signal.
      expect(bindingNoSlip.body).toEqual(noBinding.body);
      expect(noBinding.body.message).toBe('Contract not found');
    });

    it('accept POST: no-binding vs binding-but-no-slip are INDISTINGUISHABLE', async () => {
      const noBinding = await acceptSlip(UNBOUND(), contractLeakId);
      const bindingNoSlip = await acceptSlip(BOUND_NO_SLIP(), contractLeakId);

      expect(noBinding.status).toBe(404);
      expect(bindingNoSlip.status).toBe(404);
      expect(bindingNoSlip.body).toEqual(noBinding.body);
      expect(noBinding.body.message).toBe('Contract not found');
    });

    it('a valid binding WITHOUT a slip signs nothing — contract untouched', async () => {
      const res = await acceptSlip(BOUND_NO_SLIP(), contractLeakId);
      expect(res.status).toBe(404);

      const row = await getContractRow(contractLeakId);
      expect(row.pinned_version_id).toBeNull();
      expect(row.signature_status).not.toBe('FULLY_EXECUTED');
      expect(await getSlipRows(contractLeakId)).toHaveLength(0);
    });

    it('unauthenticated → 401 (guard), never a slip read', async () => {
      injectedUser = null;
      const res = await request(app.getHttpServer())
        .get(`/guest/contracts/${contractLeakId}/sign-slip`)
        .set('Authorization', 'Bearer test-jwt');
      expect(res.status).toBe(401);
    });
  });

  // ═══ 1b. ORPHAN SLIP — LIVE slip + REVOKED binding (Ayman's regression) ════
  //
  // The suite's leak-safety cases exercise the !slip term (binding-but-no-slip)
  // and the double-miss (no-binding). This case exercises the !hasBinding term
  // WITH A LIVE SLIP present — the ONLY cross-org authorization on the sign
  // path. A slip issued while bound must NOT survive the binding's revocation:
  // the binding, never the slip, is the grant (standing invariant 1). If the
  // gate ever regressed to "a live slip alone authorizes", THIS is the only
  // fixture that would catch it.

  describe('ORPHAN SLIP: live slip + revoked binding', () => {
    let orphanSlipId: string;

    beforeAll(async () => {
      // (1) bind, (2) issue a PENDING slip via the REAL issuance path…
      await insertBinding(counterpartyId, contractOrphanId);
      const slip = await slipService.issueSlip(
        contractOrphanId,
        counterpartyId,
        { userId: hostOwnerId, orgId: hostOrgId },
      );
      orphanSlipId = slip.id;
      expect(slip.status).toBe('PENDING');
      // (3) …then REVOKE the binding — orphan state: slip live, binding gone.
      await dataSource.query(
        `DELETE FROM guest_contract_access
          WHERE user_id = $1 AND contract_id = $2`,
        [counterpartyId, contractOrphanId],
      );
    });

    it('GET sign-slip → uniform 404 (revoked binding, despite the live slip)', async () => {
      const res = await getSlip(COUNTERPARTY(), contractOrphanId);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contract not found');
    });

    it('POST accept → uniform 404 (revoked binding, despite the live slip)', async () => {
      const res = await acceptSlip(COUNTERPARTY(), contractOrphanId);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Contract not found');
    });

    it('the orphan 404 is IDENTICAL to the no-binding AND binding-no-slip cases (no oracle)', async () => {
      // The three denial shapes must be byte-identical (status + body): a
      // revoked-binding orphan must not be distinguishable from "never bound"
      // or "bound-but-no-slip".
      const orphanGet = await getSlip(COUNTERPARTY(), contractOrphanId);
      const noBindingGet = await getSlip(UNBOUND(), contractLeakId);
      const bindingNoSlipGet = await getSlip(BOUND_NO_SLIP(), contractLeakId);
      expect(orphanGet.status).toBe(noBindingGet.status);
      expect(orphanGet.status).toBe(bindingNoSlipGet.status);
      expect(orphanGet.body).toEqual(noBindingGet.body);
      expect(orphanGet.body).toEqual(bindingNoSlipGet.body);

      const orphanPost = await acceptSlip(COUNTERPARTY(), contractOrphanId);
      const noBindingPost = await acceptSlip(UNBOUND(), contractLeakId);
      const bindingNoSlipPost = await acceptSlip(BOUND_NO_SLIP(), contractLeakId);
      expect(orphanPost.status).toBe(noBindingPost.status);
      expect(orphanPost.status).toBe(bindingNoSlipPost.status);
      expect(orphanPost.body).toEqual(noBindingPost.body);
      expect(orphanPost.body).toEqual(bindingNoSlipPost.body);
    });

    it('nothing pinned, slip never advanced, no signed audit', async () => {
      // The contract is untouched…
      const row = await getContractRow(contractOrphanId);
      expect(row.pinned_version_id).toBeNull();
      expect(row.signature_status).not.toBe('FULLY_EXECUTED');
      // …the slip stayed PENDING (never ACCEPTED/EXECUTED)…
      const [slip] = await getSlipRows(contractOrphanId);
      expect(slip.id).toBe(orphanSlipId);
      expect(slip.status).toBe('PENDING');
      expect(slip.accepted_at).toBeNull();
      expect(slip.accepted_version_id).toBeNull();
      // …and no execution audit was ever emitted.
      expect(await getSignAudits(contractOrphanId)).toHaveLength(0);
    });
  });

  // ═══ 2. ISSUANCE GUARDS (host side, service-level) ════════════════════════

  describe('issuance guards', () => {
    it('REFINEMENT: rejects a grantee with NO binding — no dead slips', async () => {
      await expect(
        slipService.issueSlip(contractLeakId, unboundId, {
          userId: hostOwnerId,
          orgId: hostOrgId,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await getSlipRows(contractLeakId)).toHaveLength(0);
    });

    it('rejects issuance from a non-signable status (DRAFT)', async () => {
      await expect(
        slipService.issueSlip(contractDraftId, counterpartyId, {
          userId: hostOwnerId,
          orgId: hostOrgId,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await getSlipRows(contractDraftId)).toHaveLength(0);
    });

    it('cross-org issuance → uniform 404 (findInOrg wall)', async () => {
      await expect(
        slipService.issueSlip(contractMainId, counterpartyId, {
          userId: hostOwnerId,
          orgId: foreignOrgId,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('issues a PENDING slip for a bound grantee, then 409s a duplicate', async () => {
      const slip = await slipService.issueSlip(contractMainId, counterpartyId, {
        userId: hostOwnerId,
        orgId: hostOrgId,
      });
      expect(slip.status).toBe('PENDING');
      expect(slip.grantee_user_id).toBe(counterpartyId);

      await expect(
        slipService.issueSlip(contractMainId, counterpartyId, {
          userId: hostOwnerId,
          orgId: hostOrgId,
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await getSlipRows(contractMainId)).toHaveLength(1);
    });
  });

  // ═══ 3. LIFECYCLE + org-id-inert ══════════════════════════════════════════

  describe('lifecycle: PENDING → ACCEPTED → EXECUTED', () => {
    it('the bound grantee (NON-NULL foreign org — org-id-inert) sees the PENDING slip', async () => {
      const res = await getSlip(COUNTERPARTY(), contractMainId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.slip_id).toBeDefined();
      // Guest projection is MINIMAL — no granter, no version UUID, no envelope.
      expect(res.body.granted_by).toBeUndefined();
      expect(res.body.accepted_version_id).toBeUndefined();
      expect(res.body.envelope_id).toBeUndefined();
    });

    it('Accept & Execute pins via door GUEST_SIGN and records the acceptance', async () => {
      const res = await acceptSlip(COUNTERPARTY(), contractMainId);
      expect(res.status).toBe(200);
      expect(res.body.executed).toBe(true);
      expect(res.body.already_pinned).toBe(false);
      expect(res.body.status).toBe('EXECUTED');
      expect(res.body.accepted_content_hash).toMatch(/^[0-9a-f]{64}$/);

      // Contract: pinned + FULLY_EXECUTED via the EXISTING pin operation.
      const contract = await getContractRow(contractMainId);
      expect(contract.pinned_version_id).not.toBeNull();
      expect(contract.pinned_content_hash).toBe(res.body.accepted_content_hash);
      expect(contract.signature_status).toBe('FULLY_EXECUTED');
      expect(contract.status).toBe('ACTIVE');

      // Slip: EXECUTED with the capture from the PinResult.
      const [slip] = await getSlipRows(contractMainId);
      expect(slip.status).toBe('EXECUTED');
      expect(slip.accepted_at).not.toBeNull();
      expect(slip.accepted_version_id).toBe(contract.pinned_version_id);
      expect(slip.accepted_content_hash).toBe(contract.pinned_content_hash);
      expect(slip.envelope_id).toBeNull(); // RESERVED — v1 never populates it.

      // The pinned version row carries the same hash + the GUEST_SIGN door.
      const [version] = await dataSource.query(
        `SELECT * FROM contract_versions WHERE id = $1`,
        [slip.accepted_version_id],
      );
      expect(version.content_hash).toBe(slip.accepted_content_hash);
      expect(version.metadata?.pin_payload).toBeDefined();

      // Audit: guest_contract_signed emitted once.
      const audits = await getSignAudits(contractMainId);
      expect(audits).toHaveLength(1);
      expect(audits[0].user_id).toBe(counterpartyId);
      expect(audits[0].new_values.door).toBe('GUEST_SIGN');
      expect(audits[0].new_values.slip_id).toBe(slip.id);
      expect(audits[0].new_values.already_pinned).toBe(false);
    });

    it('double-accept: second click is an already-pinned no-op — no error, no double-record', async () => {
      const before = await getContractRow(contractMainId);
      const res = await acceptSlip(COUNTERPARTY(), contractMainId);
      expect(res.status).toBe(200);
      expect(res.body.executed).toBe(true);
      expect(res.body.already_pinned).toBe(true);

      // Nothing re-pinned, nothing duplicated.
      const after = await getContractRow(contractMainId);
      expect(after.pinned_version_id).toBe(before.pinned_version_id);
      expect(after.pinned_content_hash).toBe(before.pinned_content_hash);
      expect(await getSlipRows(contractMainId)).toHaveLength(1);
      expect(await getSignAudits(contractMainId)).toHaveLength(1);
      const versions = await dataSource.query(
        `SELECT count(*)::int n FROM contract_versions
          WHERE contract_id = $1 AND event_type = 'EXECUTED'`,
        [contractMainId],
      );
      expect(versions[0].n).toBe(1);
    });

    it('GET after execution returns the EXECUTED slip (the guest keeps their receipt)', async () => {
      const res = await getSlip(COUNTERPARTY(), contractMainId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('EXECUTED');
      expect(res.body.accepted_content_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ═══ 4. ALREADY-PINNED-FIRST (host pins while slip PENDING) ═══════════════

  describe('host-pins-while-slip-PENDING', () => {
    it('guest acceptance after a manual host pin records against the EXISTING pin — no error', async () => {
      // Slip issued while the contract is signable…
      await slipService.issueSlip(contractPrePinId, counterpartyId, {
        userId: hostOwnerId,
        orgId: hostOrgId,
      });
      // …then the HOST pins first (manual mark-signed door).
      const hostPin = await pinning.markAsSigned(
        contractPrePinId,
        hostOwnerId,
        hostOrgId,
      );
      expect(hostPin.pinned).toBe(true);

      // Guest clicks Accept & Execute afterwards — NOT an error.
      const res = await acceptSlip(COUNTERPARTY(), contractPrePinId);
      expect(res.status).toBe(200);
      expect(res.body.executed).toBe(true);
      expect(res.body.already_pinned).toBe(true);

      // Acceptance recorded with version + hash from the EXISTING pin.
      const [slip] = await getSlipRows(contractPrePinId);
      expect(slip.status).toBe('EXECUTED');
      expect(slip.accepted_version_id).toBe(hostPin.pinned_version_id);
      expect(slip.accepted_content_hash).toBe(hostPin.content_hash);
      expect(slip.accepted_at).not.toBeNull();

      // The acceptance audit exists and flags already_pinned.
      const audits = await getSignAudits(contractPrePinId);
      expect(audits).toHaveLength(1);
      expect(audits[0].new_values.already_pinned).toBe(true);

      // No SECOND pin: exactly one EXECUTED snapshot (the host's).
      const versions = await dataSource.query(
        `SELECT count(*)::int n FROM contract_versions
          WHERE contract_id = $1 AND event_type = 'EXECUTED'`,
        [contractPrePinId],
      );
      expect(versions[0].n).toBe(1);
    });
  });

  // ═══ 5. HOST VOID ═════════════════════════════════════════════════════════

  describe('host VOID', () => {
    it('void before execute: slip → VOIDED, guest sees uniform 404, nothing pinned', async () => {
      const slip = await slipService.issueSlip(contractVoidId, counterpartyId, {
        userId: hostOwnerId,
        orgId: hostOrgId,
      });
      const voided = await slipService.voidSlip(contractVoidId, slip.id, {
        userId: hostOwnerId,
        orgId: hostOrgId,
      });
      expect(voided.status).toBe('VOIDED');
      expect(voided.voided_at).not.toBeNull();

      // The voided slip is INVISIBLE to the guest — uniform 404, identical to
      // never-had-a-slip (no oracle).
      const get = await getSlip(COUNTERPARTY(), contractVoidId);
      const post = await acceptSlip(COUNTERPARTY(), contractVoidId);
      expect(get.status).toBe(404);
      expect(post.status).toBe(404);
      expect(get.body.message).toBe('Contract not found');

      // Nothing pinned.
      const row = await getContractRow(contractVoidId);
      expect(row.pinned_version_id).toBeNull();
      expect(row.signature_status).not.toBe('FULLY_EXECUTED');
    });

    it('a fresh slip can be re-issued after a void (terminal rows do not block)', async () => {
      const reissued = await slipService.issueSlip(
        contractVoidId,
        counterpartyId,
        { userId: hostOwnerId, orgId: hostOrgId },
      );
      expect(reissued.status).toBe('PENDING');
      // Clean up: void it again so this contract ends un-executed.
      await slipService.voidSlip(contractVoidId, reissued.id, {
        userId: hostOwnerId,
        orgId: hostOrgId,
      });
    });

    it('void after execute → 400, the executed slip is untouched', async () => {
      const [executedSlip] = await getSlipRows(contractMainId);
      expect(executedSlip.status).toBe('EXECUTED');
      await expect(
        slipService.voidSlip(contractMainId, executedSlip.id, {
          userId: hostOwnerId,
          orgId: hostOrgId,
        }),
      ).rejects.toMatchObject({ status: 400 });
      const [still] = await getSlipRows(contractMainId);
      expect(still.status).toBe('EXECUTED');
    });
  });
});
