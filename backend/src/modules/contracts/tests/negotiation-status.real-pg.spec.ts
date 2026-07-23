import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import {
  AccountType,
  Clause,
  ClauseRedline,
  Contract,
  ContractClause,
  ContractVersion,
  GuestContractAccess,
  NegotiationStatus,
  User,
  UserRole,
} from '../../../database/entities';
import { ContractsService } from '../contracts.service';
import {
  ContractAccessService,
  ManagingOrGuestCaller,
} from '../services/contract-access.service';
import { NegotiationStatusService } from '../services/negotiation-status.service';
import { ContractScopedRepository } from '../../scoped-repository/contract-scoped.repository';
import { RedlineService } from '../../redlines/redline.service';

/**
 * 7.19 Slice 2 — the negotiation status machine, proven on real Postgres.
 *
 * The lane (DRAFT → SHARED → UNDER_REVIEW → AGREED → READY_TO_SIGN) is a
 * SEPARATE column from the lifecycle ContractStatus; its guard, the AGREED
 * open-redlines precondition, the share/propose auto-hooks, and the
 * propose-txn atomicity are DB-level behaviors a mocked suite hides
 * (lesson #140).
 *
 * Every negative test asserts ZERO side effects (negotiation_status
 * unchanged) — a 409 that already moved the lane is a failure.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[negotiation-status] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'the guard, precondition, hooks, and txn atomicity MUST be proven ' +
      'against Postgres. CI green here does NOT prove them.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(60000);

describeReal('NegotiationStatusService — 7.19 Slice 2 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let contractAccess: ContractAccessService;
  let negotiation: NegotiationStatusService;
  let contractsService: ContractsService;
  let redlines: RedlineService;

  const hostOrgId = randomUUID();
  const cpOrgId = randomUUID();
  const unrelatedOrgId = randomUUID();
  const hostUserId = randomUUID();
  const cpUserId = randomUUID();
  const unrelatedUserId = randomUUID();
  const projectId = randomUUID();
  const contractId = randomUUID();

  const hostCaller: ManagingOrGuestCaller = {
    id: hostUserId,
    organization_id: hostOrgId,
    role: UserRole.OWNER_ADMIN,
    account_type: AccountType.MANAGING,
  };
  const cpCaller: ManagingOrGuestCaller = {
    id: cpUserId,
    organization_id: cpOrgId,
    role: UserRole.OWNER_ADMIN,
    account_type: AccountType.MANAGING,
  };
  const unrelatedCaller: ManagingOrGuestCaller = {
    id: unrelatedUserId,
    organization_id: unrelatedOrgId,
    role: UserRole.OWNER_ADMIN,
    account_type: AccountType.MANAGING,
  };

  const insertUser = (id: string, org: string | null, first: string, last: string) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,$4,$5,'OWNER_ADMIN','MANAGING',$6,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `ns-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.negstatus.spec', first, last, org],
    );

  /** Seed a LIVE clause + junction (redline anchor for hook/precondition tests). */
  const seedLive = async (title: string, content: string, order: number) => {
    const clauseId = randomUUID();
    const ccId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, version, is_active, created_by)
       VALUES ($1,$2,$3,$4,'AI_EXTRACTED','APPROVED',1,TRUE,$5)`,
      [clauseId, hostOrgId, title, content, hostUserId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number, order_index, is_proposed)
       VALUES ($1,$2,$3,$4,$5,false)`,
      [ccId, contractId, clauseId, String(order + 1), order],
    );
    return { clauseId, ccId };
  };

  /** TEST-ONLY lane arranger (production writes go through the guard only). */
  const setLane = (status: NegotiationStatus) =>
    dataSource.query(
      `UPDATE contracts SET negotiation_status = $1 WHERE id = $2`,
      [status, contractId],
    );
  const lane = async (): Promise<string> =>
    (
      await dataSource.query(
        `SELECT negotiation_status FROM contracts WHERE id = $1`,
        [contractId],
      )
    )[0].negotiation_status;
  const setLifecycle = (status: string) =>
    dataSource.query(`UPDATE contracts SET status = $1 WHERE id = $2`, [
      status,
      contractId,
    ]);
  const redlineCount = async () =>
    Number(
      (
        await dataSource.query(
          `SELECT count(*)::int n FROM clause_redlines WHERE contract_id = $1`,
          [contractId],
        )
      )[0].n,
    );

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
      ],
    }).compile();
    dataSource = moduleRef.get(DataSource);

    contractAccess = new ContractAccessService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(GuestContractAccess),
    );
    negotiation = new NegotiationStatusService(
      dataSource.getRepository(Contract),
      contractAccess,
    );
    contractsService = new ContractsService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(ContractClause),
      dataSource.getRepository(ContractVersion),
      {} as any,
      {} as any,
      {} as any,
      dataSource.getRepository(User),
      {} as any,
      // updateStatus emits a realtime event — stub the gateway method it calls.
      { emitStatusChanged: jest.fn() } as any,
      {} as any,
      {} as any,
      contractAccess,
      // updateStatus loads its mutation target through the scoped repo — REAL.
      new ContractScopedRepository(dataSource.getRepository(Contract)),
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      dataSource.getRepository(Clause),
      {} as any, // relationshipTypes — not exercised
      negotiation, // 7.19 Slice 2 — the share auto-hook under test
    );
    redlines = new RedlineService(
      dataSource.getRepository(ClauseRedline),
      dataSource.getRepository(ContractClause),
      contractAccess,
      contractsService,
      negotiation, // 7.19 Slice 2 — the propose auto-hook under test
    );

    for (const [org, name] of [
      [hostOrgId, 'ns-host-org'],
      [cpOrgId, 'ns-cp-org'],
      [unrelatedOrgId, 'ns-unrelated-org'],
    ] as const) {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
        org,
        `${name}-${org.slice(0, 8)}`,
      ]);
    }
    await insertUser(hostUserId, hostOrgId, 'Hana', 'Host');
    await insertUser(cpUserId, cpOrgId, 'Cara', 'Counterparty');
    await insertUser(unrelatedUserId, unrelatedOrgId, 'Uri', 'Unrelated');
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'ns-project',$3)`,
      [projectId, hostOrgId, hostUserId],
    );
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1,$2,'NS Contract','FIDIC_RED_BOOK',$3)`,
      [contractId, projectId, hostUserId],
    );
    // Model A binding — the counterparty's real account, "Shared with me".
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), cpUserId, contractId, hostUserId],
    );
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await dataSource.query(`DELETE FROM clause_redlines WHERE contract_id = $1`, [
      contractId,
    ]);
    await dataSource.query(`DELETE FROM contract_versions WHERE contract_id = $1`, [
      contractId,
    ]);
    await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id = $1`, [
      contractId,
    ]);
    await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [hostOrgId]);
    await dataSource.query(
      `UPDATE contracts SET status = 'DRAFT', negotiation_status = 'DRAFT',
              current_version = 0, shared_at = NULL WHERE id = $1`,
      [contractId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM clause_redlines WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM contract_versions WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [hostOrgId]);
      await dataSource.query(`DELETE FROM guest_contract_access WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [
        hostUserId,
        cpUserId,
        unrelatedUserId,
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2,$3)`, [
        hostOrgId,
        cpOrgId,
        unrelatedOrgId,
      ]);
      await dataSource.destroy();
    }
    await moduleRef?.close();
  });

  // ══════════════════════════════════════════════════════════════════════
  // MIGRATION / DEFAULT
  // ══════════════════════════════════════════════════════════════════════

  it('migration: every existing contract row is backfilled (no NULL lane anywhere)', async () => {
    const [row] = await dataSource.query(
      `SELECT count(*)::int AS n FROM contracts WHERE negotiation_status IS NULL`,
    );
    expect(Number(row.n)).toBe(0);
  });

  it('a new contract defaults to DRAFT', async () => {
    const freshId = randomUUID();
    await dataSource.query(
      `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
       VALUES ($1,$2,'NS Fresh','FIDIC_RED_BOOK',$3)`,
      [freshId, projectId, hostUserId],
    );
    const [row] = await dataSource.query(
      `SELECT negotiation_status FROM contracts WHERE id = $1`,
      [freshId],
    );
    expect(row.negotiation_status).toBe('DRAFT');
    await dataSource.query(`DELETE FROM contracts WHERE id = $1`, [freshId]);
  });

  // ══════════════════════════════════════════════════════════════════════
  // SHARE AUTO-HOOK (end-to-end through ContractsService.updateStatus)
  // ══════════════════════════════════════════════════════════════════════

  it('share (updateStatus → SENT_TO_CONTRACTOR) when lane DRAFT → SHARED', async () => {
    await setLifecycle('APPROVED'); // lifecycle guard allows APPROVED → SENT_TO_CONTRACTOR
    await contractsService.updateStatus(
      contractId,
      { status: 'SENT_TO_CONTRACTOR' } as any,
      hostUserId,
      hostOrgId,
    );
    expect(await lane()).toBe('SHARED');
  });

  it('re-share when lane already UNDER_REVIEW → NO backward move', async () => {
    await setLane(NegotiationStatus.UNDER_REVIEW);
    await setLifecycle('APPROVED');
    await contractsService.updateStatus(
      contractId,
      { status: 'SENT_TO_CONTRACTOR' } as any,
      hostUserId,
      hostOrgId,
    );
    expect(await lane()).toBe('UNDER_REVIEW');
  });

  // ══════════════════════════════════════════════════════════════════════
  // PROPOSE AUTO-HOOK (through RedlineService.propose)
  // ══════════════════════════════════════════════════════════════════════

  it('propose when SHARED → UNDER_REVIEW (negotiation started)', async () => {
    const { ccId } = await seedLive('P1', 'Body.', 0);
    await setLane(NegotiationStatus.SHARED);
    await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    expect(await lane()).toBe('UNDER_REVIEW');
  });

  it('propose when already UNDER_REVIEW → no-op (stays UNDER_REVIEW)', async () => {
    const { ccId } = await seedLive('P2', 'Body.', 0);
    await setLane(NegotiationStatus.UNDER_REVIEW);
    await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    expect(await lane()).toBe('UNDER_REVIEW');
  });

  it('propose when AGREED → bounce back to UNDER_REVIEW', async () => {
    const { ccId } = await seedLive('P3', 'Body.', 0);
    await setLane(NegotiationStatus.AGREED);
    await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    expect(await lane()).toBe('UNDER_REVIEW');
  });

  it('propose when DRAFT → lane untouched (pre-share drafting does not start it)', async () => {
    const { ccId } = await seedLive('P4', 'Body.', 0);
    await redlines.propose(contractId, ccId, { proposedContent: 'x' }, hostCaller);
    expect(await lane()).toBe('DRAFT');
  });

  it('propose when READY_TO_SIGN → never pulled backward (lane untouched)', async () => {
    const { ccId } = await seedLive('P5', 'Body.', 0);
    await setLane(NegotiationStatus.READY_TO_SIGN);
    await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    expect(await lane()).toBe('READY_TO_SIGN');
  });

  // ══════════════════════════════════════════════════════════════════════
  // TRANSACTION — propose insert + lane move are atomic
  // ══════════════════════════════════════════════════════════════════════

  it('a propose that rolls back also reverts the auto-lane move (no orphan UNDER_REVIEW)', async () => {
    const { ccId } = await seedLive('TX', 'Body.', 0);
    await setLane(NegotiationStatus.SHARED);

    const real = negotiation.autoOnProposeOpened.bind(negotiation);
    jest
      .spyOn(negotiation, 'autoOnProposeOpened')
      .mockImplementationOnce(async (...args: Parameters<typeof real>) => {
        await real(...args); // the lane DID move to UNDER_REVIEW inside the txn…
        throw new Error('FORCED_POST_HOOK_FAILURE'); // …then the txn dies
      });

    await expect(
      redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller),
    ).rejects.toThrow('FORCED_POST_HOOK_FAILURE');

    // FULL rollback: no redline row AND the lane snapped back to SHARED.
    expect(await redlineCount()).toBe(0);
    expect(await lane()).toBe('SHARED');
  });

  // ══════════════════════════════════════════════════════════════════════
  // MANUAL: AGREE
  // ══════════════════════════════════════════════════════════════════════

  it('agree with zero open redlines → AGREED', async () => {
    await setLane(NegotiationStatus.UNDER_REVIEW);
    const res = await negotiation.agree(contractId, hostCaller);
    expect(res.negotiation_status).toBe('AGREED');
    expect(await lane()).toBe('AGREED');
  });

  it('agree with a resolved (REJECTED) redline but none PROPOSED → AGREED', async () => {
    const { ccId } = await seedLive('AG', 'Body.', 0);
    await setLane(NegotiationStatus.SHARED);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    // propose auto-moved SHARED → UNDER_REVIEW; resolve the redline.
    await redlines.reject(contractId, rl.id, hostCaller, {});
    const res = await negotiation.agree(contractId, hostCaller);
    expect(res.negotiation_status).toBe('AGREED');
  });

  it('agree with an open (PROPOSED) redline → 409 OPEN_REDLINES_EXIST, lane unchanged', async () => {
    const { ccId } = await seedLive('AGX', 'Body.', 0);
    await setLane(NegotiationStatus.SHARED);
    await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    // Lane is now UNDER_REVIEW with one open redline.
    await expect(negotiation.agree(contractId, hostCaller)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'OPEN_REDLINES_EXIST' }),
    });
    expect(await lane()).toBe('UNDER_REVIEW');
  });

  it('agree from a wrong state (DRAFT) → 409 INVALID_NEGOTIATION_TRANSITION, lane unchanged', async () => {
    await expect(negotiation.agree(contractId, hostCaller)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'INVALID_NEGOTIATION_TRANSITION' }),
    });
    expect(await lane()).toBe('DRAFT');
  });

  it('agree by the counterparty → 404 (host-org only), lane unchanged', async () => {
    await setLane(NegotiationStatus.UNDER_REVIEW);
    await expect(negotiation.agree(contractId, cpCaller)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await lane()).toBe('UNDER_REVIEW');
  });

  // ══════════════════════════════════════════════════════════════════════
  // MANUAL: READY-TO-SIGN (TERMINAL)
  // ══════════════════════════════════════════════════════════════════════

  it('ready-to-sign from AGREED → READY_TO_SIGN', async () => {
    await setLane(NegotiationStatus.AGREED);
    const res = await negotiation.readyToSign(contractId, hostCaller);
    expect(res.negotiation_status).toBe('READY_TO_SIGN');
    expect(await lane()).toBe('READY_TO_SIGN');
  });

  it('ready-to-sign from a wrong state (UNDER_REVIEW) → 409, lane unchanged', async () => {
    await setLane(NegotiationStatus.UNDER_REVIEW);
    await expect(
      negotiation.readyToSign(contractId, hostCaller),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'INVALID_NEGOTIATION_TRANSITION' }),
    });
    expect(await lane()).toBe('UNDER_REVIEW');
  });

  it('READY_TO_SIGN is terminal: agree AND ready-to-sign both 409, lane unchanged', async () => {
    await setLane(NegotiationStatus.READY_TO_SIGN);
    await expect(negotiation.agree(contractId, hostCaller)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'INVALID_NEGOTIATION_TRANSITION' }),
    });
    await expect(
      negotiation.readyToSign(contractId, hostCaller),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'INVALID_NEGOTIATION_TRANSITION' }),
    });
    expect(await lane()).toBe('READY_TO_SIGN');
  });

  it('ready-to-sign by the counterparty → 404 (host-org only), lane unchanged', async () => {
    await setLane(NegotiationStatus.AGREED);
    await expect(
      negotiation.readyToSign(contractId, cpCaller),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await lane()).toBe('AGREED');
  });

  // ══════════════════════════════════════════════════════════════════════
  // AUTO-HOOK IDEMPOTENCE (direct service level)
  // ══════════════════════════════════════════════════════════════════════

  it('autoOnShare from any non-DRAFT lane is a strict no-op (never backward)', async () => {
    // NOTE: the guard MAP also allows UNDER_REVIEW → SHARED (deliberate
    // step-back), but Slice 2 ships no caller for it — autoOnShare only
    // fires from DRAFT, and there is no manual step-back endpoint yet.
    for (const s of [
      NegotiationStatus.SHARED,
      NegotiationStatus.UNDER_REVIEW,
      NegotiationStatus.AGREED,
      NegotiationStatus.READY_TO_SIGN,
    ]) {
      await setLane(s);
      const after = await negotiation.autoOnShare(contractId);
      expect(after).toBe(s);
      expect(await lane()).toBe(s);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // READ — either bound party; unrelated → 404
  // ══════════════════════════════════════════════════════════════════════

  it('GET status: readable by the host AND the bound counterparty', async () => {
    await setLane(NegotiationStatus.SHARED);
    expect((await negotiation.getStatus(contractId, hostCaller)).negotiation_status).toBe(
      'SHARED',
    );
    expect((await negotiation.getStatus(contractId, cpCaller)).negotiation_status).toBe(
      'SHARED',
    );
  });

  it('GET status by an unrelated user → uniform 404', async () => {
    await expect(
      negotiation.getStatus(contractId, unrelatedCaller),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
