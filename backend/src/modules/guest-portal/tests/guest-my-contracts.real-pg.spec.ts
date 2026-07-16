import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as request from 'supertest';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import {
  AccountType,
  Contract,
  GuestContractAccess,
  UserRole,
} from '../../../database/entities';
import { ContractAccessService } from '../../contracts/services/contract-access.service';
import { GuestMyContractsController } from '../controllers/guest-my-contracts.controller';

/**
 * ⭐ Feature #8a — GET /guest/my-contracts (real Postgres).
 *
 * The discovery endpoint for a caller's OWN guest bindings. Proves:
 *
 *   1. CROSS-USER ISOLATION — each caller gets EXACTLY their own binding
 *      rows, never another user's; no bindings → [] with 200 (self-scoping
 *      list, no 404 semantics).
 *   2. TIGHT PROJECTION — the serialized payload carries ONLY the safe row
 *      (11 fields) and NONE of: risk findings, internal-note comments,
 *      proposed/live clause content, the raw organization_id / project id /
 *      granted_by UUIDs, or the binding row ids.
 *   3. BOTH JWT TYPES (Model A) — a GUEST JWT and a MANAGING JWT each list
 *      their own bindings keyed on user.id ONLY; a MANAGING user's own-org
 *      contracts do NOT appear (no binding rows → external-only).
 *   4. THE TWO SHARED-BY FIELDS — shared_by_org (trimmed org name, null on
 *      empty/whitespace) + shared_by_user (granter "First Last", null when
 *      granted_by is NULL); never a UUID, never an empty label.
 *   5. Unauthenticated → 401.
 *
 * CI is unit-test ONLY (CLAUDE.md) — skips LOUDLY when DATABASE_URL is unset.
 */

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[guest-my-contracts] SKIPPING guest-my-contracts.real-pg.spec.ts: ' +
      'DATABASE_URL unset — the cross-user isolation + tight-projection ' +
      'invariants MUST be proven against real Postgres.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(120_000);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const RISK_SENTINEL = `RISK-FINDING-${randomUUID().slice(0, 8)}`;
const INTERNAL_SENTINEL = `INTERNAL-NOTE-${randomUUID().slice(0, 8)}`;
const PROPOSED_SENTINEL = `PROPOSED-CLAUSE-${randomUUID().slice(0, 8)}`;
const LIVE_CLAUSE_SENTINEL = `LIVE-CLAUSE-${randomUUID().slice(0, 8)}`;

describeReal('⭐ Feature #8a — GET /guest/my-contracts (real Postgres)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let dataSource: DataSource;

  // ─── Fixture ids ─────────────────────────────────────────────────────────
  const orgH1Id = randomUUID(); // host org with a REAL name
  const orgH2Id = randomUUID(); // host org whose name is whitespace-only
  const orgMId = randomUUID(); // the managing caller's OWN org

  const ownerO1Id = randomUUID(); // granter in H1 ("Owner Host")
  const ownerO2Id = randomUUID(); // granter in H2 ("Owner Two")
  const userAId = randomUUID(); // GUEST — bindings X, Y, V
  const userBId = randomUUID(); // GUEST — binding Z
  const userMId = randomUUID(); // MANAGING (org M) — binding W
  const userNId = randomUUID(); // GUEST — NO bindings

  const projectP1Id = randomUUID(); // H1
  const projectP2Id = randomUUID(); // H2
  const projectPMId = randomUUID(); // M's own org

  const contractXId = randomUUID(); // P1 — A bound (leaky data seeded here)
  const contractYId = randomUUID(); // P1 — A bound
  const contractVId = randomUUID(); // P1 — A bound, granted_by NULL
  const contractZId = randomUUID(); // P1 — B bound
  const contractWId = randomUUID(); // P2 — M bound (whitespace org name)
  const contractOwnId = randomUUID(); // PM — M's OWN contract, NO binding

  const bindingIds: string[] = []; // every binding row id — must never leak
  const riskId = randomUUID();
  const commentId = randomUUID();
  const liveClauseId = randomUUID();
  const liveCcId = randomUUID();
  const proposedClauseId = randomUUID();
  const proposedCcId = randomUUID();

  const ORG_H1_NAME = 'Acme Construction Co';

  let injectedUser: any;

  const GUEST_A = () => ({
    id: userAId,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });
  const GUEST_B = () => ({
    id: userBId,
    role: UserRole.GUEST,
    organization_id: null,
    account_type: AccountType.GUEST,
  });
  const MANAGING_M = () => ({
    id: userMId,
    role: UserRole.OWNER_ADMIN,
    organization_id: orgMId,
    account_type: AccountType.MANAGING,
  });
  const GUEST_N = () => ({
    id: userNId,
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
    firstName: string,
    lastName: string,
  ) => {
    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       )
       VALUES ($1, $2, '$2a$10$mycontracts.hash.sentinel.not.a.real.hashxx',
               $6, $7, $3, $4, $5,
               TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE)`,
      [id, email, role, accountType, org, firstName, lastName],
    );
  };

  /** Binding with a deterministic granted_at (daysAgo) for DESC-order proof. */
  const insertBinding = async (
    userId: string,
    contractId: string,
    grantedBy: string | null,
    daysAgo: number,
  ) => {
    const id = randomUUID();
    bindingIds.push(id);
    await dataSource.query(
      `INSERT INTO guest_contract_access
         (id, user_id, contract_id, granted_by, granted_at)
       VALUES ($1, $2, $3, $4, NOW() - make_interval(days => $5))`,
      [id, userId, contractId, grantedBy, daysAgo],
    );
  };

  const listAs = (principal: any) => {
    injectedUser = principal;
    return request(app.getHttpServer())
      .get('/guest/my-contracts')
      .set('Authorization', 'Bearer test-jwt');
  };

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        TypeOrmModule.forFeature([Contract, GuestContractAccess]),
      ],
      controllers: [GuestMyContractsController],
      providers: [ContractAccessService],
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
    await app.init();
    dataSource = moduleRef.get(DataSource);

    // ─── Fixture tree ────────────────────────────────────────────────────
    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
      [orgH1Id, ORG_H1_NAME],
    );
    // Whitespace-only org name — must normalize to shared_by_org = null.
    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
      [orgH2Id, '   '],
    );
    await dataSource.query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)`,
      [orgMId, `caller-own-org-${orgMId.slice(0, 8)}`],
    );

    await insertUser(ownerO1Id, `o1-${ownerO1Id.slice(0, 8)}@h1.test`, 'OWNER_ADMIN', 'MANAGING', orgH1Id, 'Owner', 'Host');
    await insertUser(ownerO2Id, `o2-${ownerO2Id.slice(0, 8)}@h2.test`, 'OWNER_ADMIN', 'MANAGING', orgH2Id, 'Owner', 'Two');
    await insertUser(userAId, `a-${userAId.slice(0, 8)}@ext.test`, 'GUEST', 'GUEST', null, 'Guest', 'Aye');
    await insertUser(userBId, `b-${userBId.slice(0, 8)}@ext.test`, 'GUEST', 'GUEST', null, 'Guest', 'Bee');
    await insertUser(userMId, `m-${userMId.slice(0, 8)}@org-m.test`, 'OWNER_ADMIN', 'MANAGING', orgMId, 'Manager', 'Em');
    await insertUser(userNId, `n-${userNId.slice(0, 8)}@ext.test`, 'GUEST', 'GUEST', null, 'Guest', 'None');

    for (const [pid, oid, name, creator] of [
      [projectP1Id, orgH1Id, 'my-contracts-P1', ownerO1Id],
      [projectP2Id, orgH2Id, 'my-contracts-P2', ownerO2Id],
      [projectPMId, orgMId, 'my-contracts-PM', userMId],
    ] as const) {
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by)
         VALUES ($1, $2, $3, $4)`,
        [pid, oid, name, creator],
      );
    }

    for (const [cid, pid, name, creator] of [
      [contractXId, projectP1Id, 'MyContracts Bound X', ownerO1Id],
      [contractYId, projectP1Id, 'MyContracts Bound Y', ownerO1Id],
      [contractVId, projectP1Id, 'MyContracts Bound V', ownerO1Id],
      [contractZId, projectP1Id, 'MyContracts Bound Z', ownerO1Id],
      [contractWId, projectP2Id, 'MyContracts Bound W', ownerO2Id],
      [contractOwnId, projectPMId, 'MyContracts Own Contract', userMId],
    ] as const) {
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [cid, pid, name, creator],
      );
    }
    // Party names on X — the projection must surface them.
    await dataSource.query(
      `UPDATE contracts
          SET party_first_name = 'Employer Alpha',
              party_second_name = 'Contractor Beta'
        WHERE id = $1`,
      [contractXId],
    );

    // Bindings. granted_at spread over distinct days → DESC order is X, Y, V.
    await insertBinding(userAId, contractXId, ownerO1Id, 1);
    await insertBinding(userAId, contractYId, ownerO1Id, 2);
    await insertBinding(userAId, contractVId, null, 3); // granter deleted → NULL
    await insertBinding(userBId, contractZId, ownerO1Id, 1);
    await insertBinding(userMId, contractWId, ownerO2Id, 1);
    // userN: deliberately NO bindings. contractOwn: deliberately NO binding.

    // ── Leaky data on X — none of it may appear in the list payload. ──────
    await dataSource.query(
      `INSERT INTO risk_analyses (id, contract_id, risk_category, risk_level, description)
       VALUES ($1, $2, 'Payment Terms', 'HIGH', $3)`,
      [riskId, contractXId, RISK_SENTINEL],
    );
    await dataSource.query(
      `INSERT INTO contract_comments
         (id, contract_id, contract_clause_id, user_id, content,
          is_resolved, is_internal_note, parent_comment_id)
       VALUES ($1, $2, NULL, $3, $4, FALSE, TRUE, NULL)`,
      [commentId, contractXId, ownerO1Id, INTERNAL_SENTINEL],
    );
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, created_by)
       VALUES ($1, $2, 'Live Clause', $3, 'AI_EXTRACTED', 'APPROVED', $4)`,
      [liveClauseId, orgH1Id, LIVE_CLAUSE_SENTINEL, ownerO1Id],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
       VALUES ($1, $2, $3, 0, FALSE)`,
      [liveCcId, contractXId, liveClauseId],
    );
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, created_by)
       VALUES ($1, $2, 'Proposed Clause', $3, 'AI_EXTRACTED', 'APPROVED', $4)`,
      [proposedClauseId, orgH1Id, PROPOSED_SENTINEL, ownerO1Id],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, order_index, is_proposed)
       VALUES ($1, $2, $3, 1, TRUE)`,
      [proposedCcId, contractXId, proposedClauseId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM risk_analyses WHERE id = $1`, [riskId]);
      await dataSource.query(`DELETE FROM contract_comments WHERE id = $1`, [
        commentId,
      ]);
      await dataSource.query(
        `DELETE FROM guest_contract_access WHERE id = ANY($1)`,
        [bindingIds],
      );
      await dataSource.query(
        `DELETE FROM contract_clauses WHERE id = ANY($1)`,
        [[liveCcId, proposedCcId]],
      );
      await dataSource.query(`DELETE FROM clauses WHERE id = ANY($1)`, [
        [liveClauseId, proposedClauseId],
      ]);
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [
        [
          contractXId,
          contractYId,
          contractVId,
          contractZId,
          contractWId,
          contractOwnId,
        ],
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = ANY($1)`, [
        [projectP1Id, projectP2Id, projectPMId],
      ]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
        [userAId, userBId, userMId, userNId, ownerO1Id, ownerO2Id],
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgH1Id, orgH2Id, orgMId],
      ]);
    }
    await app?.close();
  });

  // ═══ 1. CROSS-USER ISOLATION ════════════════════════════════════════════

  it('⭐ ISOLATION — user A gets EXACTLY its own bindings (X, Y, V), ordered granted_at DESC; never Z or W', async () => {
    const res = await listAs(GUEST_A()).expect(200);
    expect(res.body).toHaveLength(3);
    // DESC by granted_at: X (1 day ago) → Y (2 days) → V (3 days).
    expect(res.body.map((r: any) => r.contract_id)).toEqual([
      contractXId,
      contractYId,
      contractVId,
    ]);
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain(contractZId);
    expect(payload).not.toContain(contractWId);
  });

  it('⭐ ISOLATION — user B gets exactly Z; user N (no bindings) gets [] with 200', async () => {
    const resB = await listAs(GUEST_B()).expect(200);
    expect(resB.body.map((r: any) => r.contract_id)).toEqual([contractZId]);

    const resN = await listAs(GUEST_N()).expect(200);
    expect(resN.body).toEqual([]);
  });

  // ═══ 2. TIGHT PROJECTION ════════════════════════════════════════════════

  it('⭐ PROJECTION — the row carries exactly the 11 safe fields with the right values', async () => {
    const res = await listAs(GUEST_A()).expect(200);
    const rowX = res.body.find((r: any) => r.contract_id === contractXId);
    expect(rowX).toBeDefined();
    expect(Object.keys(rowX).sort()).toEqual(
      [
        'contract_id',
        'contract_name',
        'contract_type',
        'status',
        'signature_status',
        'party_first_name',
        'party_second_name',
        'project_name',
        'shared_by_org',
        'shared_by_user',
        'granted_at',
      ].sort(),
    );
    expect(rowX.contract_name).toBe('MyContracts Bound X');
    expect(rowX.contract_type).toBe('FIDIC_RED_BOOK');
    expect(rowX.status).toBe('DRAFT');
    expect(rowX.signature_status).toBeNull();
    expect(rowX.party_first_name).toBe('Employer Alpha');
    expect(rowX.party_second_name).toBe('Contractor Beta');
    expect(rowX.project_name).toBe('my-contracts-P1');
    expect(rowX.granted_at).toBeTruthy();
  });

  it('⭐ PROJECTION — gated/leaky data is ABSENT: risk findings, internal notes, proposed + live clause content, org/project/granted_by/binding UUIDs', async () => {
    const res = await listAs(GUEST_A()).expect(200);
    const payload = JSON.stringify(res.body);

    // Sentinels seeded on X must never surface in the list.
    expect(payload).not.toContain(RISK_SENTINEL);
    expect(payload).not.toContain(INTERNAL_SENTINEL);
    expect(payload).not.toContain(PROPOSED_SENTINEL);
    expect(payload).not.toContain(LIVE_CLAUSE_SENTINEL);

    // Raw ids the list must be TIGHTER than the detail read about.
    expect(payload).not.toContain(orgH1Id); // organization_id UUID
    expect(payload).not.toContain(projectP1Id); // project id
    expect(payload).not.toContain(ownerO1Id); // granted_by UUID
    for (const bid of bindingIds) {
      expect(payload).not.toContain(bid); // binding row ids
    }
    expect(payload).not.toContain(riskId);
    expect(payload).not.toContain(commentId);
  });

  // ═══ 3. BOTH JWT TYPES — Model A, external-only for managing ════════════

  it('⭐ BOTH JWT TYPES — a MANAGING JWT lists its own bindings (W); its OWN-ORG contracts do NOT appear (external-only)', async () => {
    const res = await listAs(MANAGING_M()).expect(200);
    expect(res.body.map((r: any) => r.contract_id)).toEqual([contractWId]);
    const payload = JSON.stringify(res.body);
    // M's own-org contract has no binding row → never listed.
    expect(payload).not.toContain(contractOwnId);
    expect(payload).not.toContain(orgMId); // caller's own org never read/emitted
  });

  // ═══ 4. THE TWO SHARED-BY FIELDS ════════════════════════════════════════

  it('⭐ SHARED-BY (i) — real org name + granter present → both fields populated', async () => {
    const res = await listAs(GUEST_A()).expect(200);
    const rowX = res.body.find((r: any) => r.contract_id === contractXId);
    expect(rowX.shared_by_org).toBe(ORG_H1_NAME);
    expect(rowX.shared_by_user).toBe('Owner Host');
  });

  it('⭐ SHARED-BY (ii) — whitespace-only org name → shared_by_org NULL (not ""), shared_by_user still resolves', async () => {
    const res = await listAs(MANAGING_M()).expect(200);
    const rowW = res.body.find((r: any) => r.contract_id === contractWId);
    expect(rowW.shared_by_org).toBeNull();
    expect(rowW.shared_by_user).toBe('Owner Two');
  });

  it('⭐ SHARED-BY (iii) — granted_by NULL (granter deleted) → shared_by_user NULL, shared_by_org still resolves', async () => {
    const res = await listAs(GUEST_A()).expect(200);
    const rowV = res.body.find((r: any) => r.contract_id === contractVId);
    expect(rowV.shared_by_user).toBeNull();
    expect(rowV.shared_by_org).toBe(ORG_H1_NAME);
  });

  it('⭐ SHARED-BY (iv) — no UUID ever appears in either field, across every row of every caller', async () => {
    for (const principal of [GUEST_A(), GUEST_B(), MANAGING_M()]) {
      const res = await listAs(principal).expect(200);
      for (const row of res.body) {
        for (const field of [row.shared_by_org, row.shared_by_user]) {
          if (field !== null) {
            expect(typeof field).toBe('string');
            expect(field.trim().length).toBeGreaterThan(0);
            expect(field).not.toMatch(UUID_RE);
          }
        }
      }
    }
  });

  // ═══ 5. AUTH ═════════════════════════════════════════════════════════════

  it('unauthenticated → 401', async () => {
    injectedUser = null;
    await request(app.getHttpServer()).get('/guest/my-contracts').expect(401);
  });
});
