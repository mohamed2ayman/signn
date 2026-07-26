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
  User,
  UserRole,
} from '../../../database/entities';
import { ContractsService } from '../../contracts/contracts.service';
import {
  ContractAccessService,
  ManagingOrGuestCaller,
} from '../../contracts/services/contract-access.service';
import { NegotiationStatusService } from '../../contracts/services/negotiation-status.service';
import { computeClauseDiff } from '../../contracts/utils/clause-diff.util';
import { RedlineService } from '../redline.service';

/**
 * 7.19 Slice 1 — counterparty redlining spine, proven on real Postgres.
 *
 * The negotiation loop (propose / accept / reject / counter / withdraw) rides
 * atomicity, conditional-flip races, parent-chain promotion, and FK-backed
 * staleness — all SQL-level guarantees a mocked DB hides (lesson #140).
 *
 * EVERY negative test asserts ZERO side effects (no new contract_version row,
 * no clause is_active flip, no junction repoint, redline status unchanged) —
 * a 409/404 that already mutated is a failure, not a pass.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[redline-spine] SKIPPING real-Postgres spec: DATABASE_URL unset — this ' +
      'MUST run against Postgres to prove atomicity, staleness, and the ' +
      'parent-chain promotion. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(60000);

describeReal('RedlineService — 7.19 Slice 1 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let contractsService: ContractsService;
  let contractAccess: ContractAccessService;
  let redlines: RedlineService;

  const hostOrgId = randomUUID();
  const cpOrgId = randomUUID(); // counterparty's own org
  const unrelatedOrgId = randomUUID();
  const hostUserId = randomUUID();
  const cpUserId = randomUUID();
  const unrelatedUserId = randomUUID();
  const guestUserId = randomUUID(); // bound GUEST account (write-exclusion fixtures)
  const projectId = randomUUID();
  const contractId = randomUUID(); // the negotiated contract (host org)
  const otherContractId = randomUUID(); // sibling contract, SAME host org (IDOR fixtures)

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
  // An established-identity GUEST account holding a binding to the contract.
  // The wall ADMITS it (binding = grant); the write-exclusion gate must still
  // 404 its propose/counter while leaving list/withdraw open.
  const guestCaller: ManagingOrGuestCaller = {
    id: guestUserId,
    organization_id: null,
    role: UserRole.GUEST,
    account_type: AccountType.GUEST,
  };

  const insertUser = (
    id: string,
    org: string | null,
    first: string,
    last: string,
    role = 'OWNER_ADMIN',
    accountType = 'MANAGING',
  ) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `rl-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.redline.spec', first, last, role, accountType, org],
    );

  /** Seed a LIVE clause + junction on a contract; returns ids. */
  const seedLive = async (
    title: string,
    content: string,
    order: number,
    cid: string = contractId,
  ) => {
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
      [ccId, cid, clauseId, String(order + 1), order],
    );
    return { clauseId, ccId };
  };

  /** Pin a contract (signed-state freeze) via a milestone version row. */
  const pinContract = async (cid: string) => {
    const vid = randomUUID();
    await dataSource.query(
      `INSERT INTO contract_versions (id, contract_id, version_number, snapshot, created_at)
       VALUES ($1,$2,999,'{}',NOW())`,
      [vid, cid],
    );
    await dataSource.query(
      `UPDATE contracts SET pinned_version_id = $1, pinned_at = NOW() WHERE id = $2`,
      [vid, cid],
    );
    return vid;
  };

  const versionCount = async (cid: string = contractId) =>
    Number(
      (
        await dataSource.query(
          `SELECT count(*)::int n FROM contract_versions WHERE contract_id = $1`,
          [cid],
        )
      )[0].n,
    );
  const currentVersion = async (cid: string = contractId) =>
    Number(
      (await dataSource.query(`SELECT current_version FROM contracts WHERE id = $1`, [cid]))[0]
        .current_version,
    );
  const clauseRow = async (id: string) =>
    (
      await dataSource.query(
        `SELECT id, title, content, version, parent_clause_id, is_active, review_status, source, source_document_id
           FROM clauses WHERE id = $1`,
        [id],
      )
    )[0];
  const junctionClauseId = async (ccId: string) =>
    (await dataSource.query(`SELECT clause_id FROM contract_clauses WHERE id = $1`, [ccId]))[0]
      ?.clause_id;
  const redlineRow = async (id: string) =>
    (await dataSource.query(`SELECT * FROM clause_redlines WHERE id = $1`, [id]))[0];
  const redlineCount = async () =>
    Number(
      (
        await dataSource.query(
          `SELECT count(*)::int n FROM clause_redlines WHERE contract_id IN ($1, $2)`,
          [contractId, otherContractId],
        )
      )[0].n,
    );

  /** Full zero-side-effect assertion for a clause thread + its redline. */
  const assertUntouched = async (fix: {
    clauseId: string;
    ccId: string;
    redlineId?: string;
    expectedStatus?: string;
    expectedVersions?: number;
  }) => {
    expect(await versionCount()).toBe(fix.expectedVersions ?? 0);
    expect(await currentVersion()).toBe(0);
    const clause = await clauseRow(fix.clauseId);
    expect(clause.is_active).toBe(true);
    expect(await junctionClauseId(fix.ccId)).toBe(fix.clauseId);
    if (fix.redlineId) {
      expect((await redlineRow(fix.redlineId)).status).toBe(
        fix.expectedStatus ?? 'PROPOSED',
      );
    }
  };

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
    contractsService = new ContractsService(
      dataSource.getRepository(Contract),
      dataSource.getRepository(ContractClause),
      dataSource.getRepository(ContractVersion),
      {} as any,
      {} as any,
      {} as any,
      dataSource.getRepository(User),
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
      dataSource.getRepository(Clause),
      {} as any, // relationshipTypes (T0a) — not exercised
      {} as any, // 20 negotiationStatus (7.19 S2) — share hook not exercised here
    );
    redlines = new RedlineService(
      dataSource.getRepository(ClauseRedline),
      dataSource.getRepository(ContractClause),
      contractAccess,
      contractsService,
      // 7.19 Slice 2 — real negotiation service (propose's auto-hook rides
      // the txn; every contract here sits at lane DRAFT, so the hook no-ops
      // and Slice-1 behavior is unchanged).
      new NegotiationStatusService(
        dataSource.getRepository(Contract),
        contractAccess,
      ),
      // 7.19 Slice 4 — notifications DELIBERATELY absent here. Slice 1's
      // negotiation-loop guarantees (atomicity, staleness, conditional flips,
      // parent-chain promotion, zero-side-effect negatives) must hold with NO
      // notifier wired, so this spec keeps the pre-Slice-4 positional shape
      // and proves Slice 1 is unchanged. Notification behaviour is proven
      // separately in redline-notification.real-pg.spec.ts.
      undefined as any,
    );

    for (const [org, name] of [
      [hostOrgId, 'rl-host-org'],
      [cpOrgId, 'rl-cp-org'],
      [unrelatedOrgId, 'rl-unrelated-org'],
    ] as const) {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
        org,
        `${name}-${org.slice(0, 8)}`,
      ]);
    }
    await insertUser(hostUserId, hostOrgId, 'Hana', 'Host');
    await insertUser(cpUserId, cpOrgId, 'Cara', 'Counterparty');
    await insertUser(unrelatedUserId, unrelatedOrgId, 'Uri', 'Unrelated');
    await insertUser(guestUserId, null, 'Gina', 'Guest', 'GUEST', 'GUEST');
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'rl-project',$3)`,
      [projectId, hostOrgId, hostUserId],
    );
    for (const cid of [contractId, otherContractId]) {
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1,$2,$3,'FIDIC_RED_BOOK',$4)`,
        [cid, projectId, cid === contractId ? 'RL Contract' : 'RL Other Contract', hostUserId],
      );
    }
    // The Model A binding: the counterparty's REAL account is bound to the
    // negotiated contract via guest_contract_access ("Shared with me").
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), cpUserId, contractId, hostUserId],
    );
    // A GUEST-account binding too — the wall admits it; the write-exclusion
    // gate is what must close propose/counter for this caller.
    await dataSource.query(
      `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
       VALUES ($1,$2,$3,$4)`,
      [randomUUID(), guestUserId, contractId, hostUserId],
    );
  });

  // Every test reseeds its clause thread; wipe negotiation + clause state.
  beforeEach(async () => {
    jest.restoreAllMocks();
    await dataSource.query(
      `UPDATE contracts SET pinned_version_id = NULL, pinned_at = NULL, pinned_content_hash = NULL, current_version = 0
        WHERE id IN ($1, $2)`,
      [contractId, otherContractId],
    );
    await dataSource.query(`DELETE FROM clause_redlines WHERE contract_id IN ($1, $2)`, [
      contractId,
      otherContractId,
    ]);
    await dataSource.query(`DELETE FROM contract_versions WHERE contract_id IN ($1, $2)`, [
      contractId,
      otherContractId,
    ]);
    await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id IN ($1, $2)`, [
      contractId,
      otherContractId,
    ]);
    await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [hostOrgId]);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM clause_redlines WHERE contract_id IN ($1,$2)`, [
        contractId,
        otherContractId,
      ]);
      await dataSource.query(
        `UPDATE contracts SET pinned_version_id = NULL WHERE id IN ($1,$2)`,
        [contractId, otherContractId],
      );
      await dataSource.query(`DELETE FROM contract_versions WHERE contract_id IN ($1,$2)`, [
        contractId,
        otherContractId,
      ]);
      await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id IN ($1,$2)`, [
        contractId,
        otherContractId,
      ]);
      await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [hostOrgId]);
      await dataSource.query(`DELETE FROM guest_contract_access WHERE contract_id = $1`, [
        contractId,
      ]);
      await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [
        contractId,
        otherContractId,
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2,$3,$4)`, [
        hostUserId,
        cpUserId,
        unrelatedUserId,
        guestUserId,
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
  // PROPOSE
  // ══════════════════════════════════════════════════════════════════════

  it('propose (counterparty via binding): PROPOSED row, base snapshot == current content', async () => {
    const { clauseId, ccId } = await seedLive('Payment', 'Original payment terms.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'New payment terms.', note: 'please review' },
      cpCaller,
    );
    expect(rl.status).toBe('PROPOSED');
    expect(rl.round).toBe(1);
    expect(rl.parent_redline_id).toBeNull();
    expect(rl.author_identity_source).toBe('MANAGING_USER');
    const row = await redlineRow(rl.id);
    expect(row.base_content_snapshot).toBe('Original payment terms.');
    expect(row.author_user_id).toBe(cpUserId);
    // No side effects on the clause thread.
    await assertUntouched({ clauseId, ccId });
  });

  it('propose by the host (own-org path) also works', async () => {
    const { ccId } = await seedLive('Scope', 'Scope body.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'Host-proposed scope body.' },
      hostCaller,
    );
    expect(rl.status).toBe('PROPOSED');
    expect((await redlineRow(rl.id)).author_user_id).toBe(hostUserId);
  });

  it('propose on a pinned contract → 409 CONTRACT_PINNED, no row', async () => {
    const { ccId } = await seedLive('Pin', 'Pinned body.', 0);
    await pinContract(contractId);
    await expect(
      redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'CONTRACT_PINNED' }),
    });
    expect(await redlineCount()).toBe(0);
  });

  it('propose by an unrelated user (no binding) → uniform 404, no row', async () => {
    const { ccId } = await seedLive('Sec', 'Body.', 0);
    await expect(
      redlines.propose(contractId, ccId, { proposedContent: 'x' }, unrelatedCaller),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await redlineCount()).toBe(0);
  });

  it('propose with a contractClauseId belonging to a DIFFERENT contract → 404, no row', async () => {
    await seedLive('A', 'A body.', 0);
    const other = await seedLive('B', 'B body.', 0, otherContractId);
    await expect(
      redlines.propose(contractId, other.ccId, { proposedContent: 'x' }, cpCaller),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await redlineCount()).toBe(0);
  });

  it('propose with an unknown contractClauseId → 404, no row', async () => {
    await seedLive('A', 'A body.', 0);
    await expect(
      redlines.propose(contractId, randomUUID(), { proposedContent: 'x' }, cpCaller),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await redlineCount()).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // GUEST WRITE-EXCLUSION (static gate — writes closed until #8c hardening)
  // ══════════════════════════════════════════════════════════════════════

  it('propose by a BOUND GUEST account → uniform 404 (write-exclusion), zero side effects', async () => {
    const { clauseId, ccId } = await seedLive('GW', 'Guest-gate body.', 0);
    await expect(
      redlines.propose(contractId, ccId, { proposedContent: 'x' }, guestCaller),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await redlineCount()).toBe(0); // no redline row created
    await assertUntouched({ clauseId, ccId });
  });

  it('counter by a BOUND GUEST account → uniform 404, original stays PROPOSED, no child', async () => {
    const { ccId } = await seedLive('GW2', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    const before = await redlineCount();
    await expect(
      redlines.counter(contractId, rl.id, guestCaller, { proposedContent: 'y' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await redlineCount()).toBe(before);
    expect((await redlineRow(rl.id)).status).toBe('PROPOSED');
  });

  it('list by a BOUND GUEST account still works (reads are NOT gated)', async () => {
    const { ccId } = await seedLive('GW3', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    const view = await redlines.list(contractId, guestCaller);
    expect(view.map((r) => r.id)).toContain(rl.id);
  });

  it('withdraw by a GUEST author of a pre-gate redline still works (author cleanup NOT gated)', async () => {
    const { ccId } = await seedLive('GW4', 'Body.', 0);
    // A guest-authored PROPOSED row can only pre-date the gate — seed directly.
    const preGateId = randomUUID();
    await dataSource.query(
      `INSERT INTO clause_redlines (id, contract_id, contract_clause_id, round,
         proposed_content, base_content_snapshot, author_user_id,
         author_identity_source, status)
       VALUES ($1,$2,$3,1,'pre-gate proposal','Body.',$4,'GUEST','PROPOSED')`,
      [preGateId, contractId, ccId, guestUserId],
    );
    const updated = await redlines.withdraw(contractId, preGateId, guestCaller);
    expect(updated.status).toBe('WITHDRAWN');
  });

  // ══════════════════════════════════════════════════════════════════════
  // LIST
  // ══════════════════════════════════════════════════════════════════════

  it('list: both parties see redlines; author projection scrubbed (no PII/UUIDs), TEAM/GUEST + is_author correct', async () => {
    const { ccId } = await seedLive('L', 'List body.', 0);
    const cpRl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'cp proposal' },
      cpCaller,
    );
    const hostRl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'host proposal' },
      hostCaller,
    );

    const hostView = await redlines.list(contractId, hostCaller);
    const cpView = await redlines.list(contractId, cpCaller);
    expect(hostView).toHaveLength(2);
    expect(cpView).toHaveLength(2);

    const cpRowHostView = hostView.find((r) => r.id === cpRl.id)!;
    const hostRowHostView = hostView.find((r) => r.id === hostRl.id)!;
    // Counterparty (managing user of ANOTHER org, via binding) is EXTERNAL —
    // never TEAM; host-org author is TEAM. Names are display names only.
    expect(cpRowHostView.author_role).toBe('GUEST');
    expect(cpRowHostView.author_name).toBe('Cara Counterparty');
    expect(hostRowHostView.author_role).toBe('TEAM');
    expect(hostRowHostView.author_name).toBe('Hana Host');
    // is_author is caller-relative.
    expect(cpRowHostView.is_author).toBe(false);
    expect(cpView.find((r) => r.id === cpRl.id)!.is_author).toBe(true);
    // Scrub: no raw user UUIDs / emails / org ids on the wire shape.
    for (const row of [...hostView, ...cpView]) {
      expect(row).not.toHaveProperty('author_user_id');
      expect(row).not.toHaveProperty('decided_by_user_id');
      expect(row).not.toHaveProperty('author_email');
      expect(row).not.toHaveProperty('author_org_id');
      expect(JSON.stringify(row)).not.toContain('@test.local');
    }
  });

  it('list by an unrelated user → uniform 404', async () => {
    await expect(redlines.list(contractId, unrelatedCaller)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('list filters by status and contractClauseId', async () => {
    const a = await seedLive('F1', 'F1 body.', 0);
    const b = await seedLive('F2', 'F2 body.', 1);
    const rlA = await redlines.propose(contractId, a.ccId, { proposedContent: 'pa' }, cpCaller);
    await redlines.propose(contractId, b.ccId, { proposedContent: 'pb' }, cpCaller);
    await redlines.reject(contractId, rlA.id, hostCaller, {});

    const proposed = await redlines.list(contractId, hostCaller, { status: 'PROPOSED' });
    expect(proposed).toHaveLength(1);
    expect(proposed[0].contract_clause_id).toBe(b.ccId);

    const byClause = await redlines.list(contractId, hostCaller, {
      contractClauseId: a.ccId,
    });
    expect(byClause).toHaveLength(1);
    expect(byClause[0].status).toBe('REJECTED');
  });

  it('list rows carry word_level_diff matching the SHARED clause-diff util (Slice 3); null when identical', async () => {
    const { ccId } = await seedLive('WD', 'The employer shall pay within 30 days.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'The employer shall pay within 45 days.' },
      cpCaller,
    );
    // A byte-identical "proposal" → UNCHANGED pair → null diff.
    const same = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'The employer shall pay within 30 days.' },
      cpCaller,
    );

    const rows = await redlines.list(contractId, hostCaller);
    const changed = rows.find((r) => r.id === rl.id)!;
    const identical = rows.find((r) => r.id === same.id)!;

    // Shape + content must equal the SAME shared util's output for the pair —
    // the frontend DiffView consumes this byte-consistently with version diffs.
    const expected = computeClauseDiff(
      [{ clause_id: 'k', clause_title: '', clause_content: changed.base_content_snapshot, section_number: null }],
      [{ clause_id: 'k', clause_title: '', clause_content: changed.proposed_content, section_number: null }],
    ).changes[0].wordLevelDiff;
    expect(changed.word_level_diff).toEqual(expected);
    expect(changed.word_level_diff!.some((s) => s.added)).toBe(true);
    expect(changed.word_level_diff!.some((s) => s.removed)).toBe(true);
    // Reconstruction invariant: non-removed segments concatenate to the proposal.
    expect(
      changed.word_level_diff!.filter((s) => !s.removed).map((s) => s.value).join(''),
    ).toBe(changed.proposed_content);

    expect(identical.word_level_diff).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════════
  // ACCEPT
  // ══════════════════════════════════════════════════════════════════════

  it('accept as-is: snapshot + parent-chain promotion + junction repoint + ACCEPTED linkage', async () => {
    const { clauseId, ccId } = await seedLive('Accept', 'Old body.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'New body.', proposedTitle: 'Accept v2' },
      cpCaller,
    );

    const updated = await redlines.accept(contractId, rl.id, hostCaller, {});

    // Redline terminal state + linkage.
    expect(updated.status).toBe('ACCEPTED');
    expect(updated.decided_by_user_id).toBe(hostUserId);
    expect(updated.decided_at).not.toBeNull();
    expect(updated.resulting_version_id).not.toBeNull();
    expect(updated.resulting_clause_id).not.toBeNull();

    // Version model: exactly one new contract_version, current_version bumped.
    expect(await versionCount()).toBe(1);
    expect(await currentVersion()).toBe(1);
    const [version] = await dataSource.query(
      `SELECT id, version_number, event_type FROM contract_versions WHERE contract_id = $1`,
      [contractId],
    );
    expect(version.id).toBe(updated.resulting_version_id);
    expect(version.event_type).toBe('EDITED');
    // SNAPSHOT-BEFORE: the snapshot holds the ORIGINAL wording (it ran first).
    const [snap] = await dataSource.query(
      `SELECT clause_snapshot FROM contract_versions WHERE id = $1`,
      [version.id],
    );
    expect(JSON.stringify(snap.clause_snapshot)).toContain('Old body.');
    expect(JSON.stringify(snap.clause_snapshot)).not.toContain('New body.');

    // Parent-chain promotion.
    const promoted = await clauseRow(updated.resulting_clause_id!);
    expect(promoted.content).toBe('New body.');
    expect(promoted.title).toBe('Accept v2');
    expect(promoted.parent_clause_id).toBe(clauseId);
    expect(promoted.version).toBe(2);
    expect(promoted.is_active).toBe(true);
    expect(promoted.review_status).toBe('APPROVED');
    expect(promoted.source).toBe('COUNTERPARTY_REDLINE');
    expect(promoted.source_document_id).toBeNull();
    // Original retired; junction repointed.
    expect((await clauseRow(clauseId)).is_active).toBe(false);
    expect(await junctionClauseId(ccId)).toBe(updated.resulting_clause_id);
  });

  it('accept with editedContent: review_status EDITED, promoted content == host edit', async () => {
    const { ccId } = await seedLive('Edit', 'Old.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'CP text.' }, cpCaller);
    const updated = await redlines.accept(contractId, rl.id, hostCaller, {
      editedContent: 'Host-merged text.',
      note: 'merged with tweaks',
    });
    const promoted = await clauseRow(updated.resulting_clause_id!);
    expect(promoted.content).toBe('Host-merged text.');
    expect(promoted.review_status).toBe('EDITED');
    expect(updated.decision_note).toBe('merged with tweaks');
  });

  it('accept by the counterparty → 404 (host-org only), zero side effects', async () => {
    const { clauseId, ccId } = await seedLive('NA', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await expect(redlines.accept(contractId, rl.id, cpCaller, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await assertUntouched({ clauseId, ccId, redlineId: rl.id });
  });

  it('accept on a pinned contract → 409 CONTRACT_PINNED, zero side effects', async () => {
    const { clauseId, ccId } = await seedLive('Pin2', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await pinContract(contractId);
    await expect(redlines.accept(contractId, rl.id, hostCaller, {})).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'CONTRACT_PINNED' }),
    });
    // Pin fixture adds one version row (the pin target) — no NEW one beyond it.
    expect(await versionCount()).toBe(1);
    const clause = await clauseRow(clauseId);
    expect(clause.is_active).toBe(true);
    expect(await junctionClauseId(ccId)).toBe(clauseId);
    expect((await redlineRow(rl.id)).status).toBe('PROPOSED');
  });

  it('accept when the clause changed since propose → redline STALE + 409 STALE_REDLINE, zero side effects', async () => {
    const { clauseId, ccId } = await seedLive('Stale', 'Seen body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    // Someone edits the clause under the redline's feet.
    await dataSource.query(`UPDATE clauses SET content = 'Changed body.' WHERE id = $1`, [
      clauseId,
    ]);
    await expect(redlines.accept(contractId, rl.id, hostCaller, {})).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'STALE_REDLINE' }),
    });
    // STALE persisted; NOTHING else mutated (txn rolled back).
    expect((await redlineRow(rl.id)).status).toBe('STALE');
    expect(await versionCount()).toBe(0);
    expect(await currentVersion()).toBe(0);
    expect((await clauseRow(clauseId)).is_active).toBe(true);
    expect(await junctionClauseId(ccId)).toBe(clauseId);
  });

  it('accept a non-PROPOSED redline (already accepted) → 409 conflict, no second version', async () => {
    const { ccId } = await seedLive('Twice', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'v2 body' }, cpCaller);
    await redlines.accept(contractId, rl.id, hostCaller, {});
    await expect(redlines.accept(contractId, rl.id, hostCaller, {})).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'REDLINE_NOT_PROPOSED' }),
    });
    expect(await versionCount()).toBe(1); // still just the first accept's version
  });

  it('accept with a redlineId belonging to a DIFFERENT contract → 404, zero side effects', async () => {
    const mine = await seedLive('Mine', 'Mine body.', 0);
    const other = await seedLive('Other', 'Other body.', 0, otherContractId);
    // Redline lives on the OTHER contract; URL names ours.
    const foreign = await redlines.propose(
      otherContractId,
      other.ccId,
      { proposedContent: 'x' },
      hostCaller, // host org owns both contracts; only the URL/redline mismatch is under test
    );
    await expect(
      redlines.accept(contractId, foreign.id, hostCaller, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    await assertUntouched({ clauseId: mine.clauseId, ccId: mine.ccId });
    expect((await redlineRow(foreign.id)).status).toBe('PROPOSED');
  });

  it('accept an unknown redlineId → 404', async () => {
    await seedLive('U', 'Body.', 0);
    await expect(
      redlines.accept(contractId, randomUUID(), hostCaller, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await versionCount()).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // TRANSACTION INTEGRITY
  // ══════════════════════════════════════════════════════════════════════

  it('forced failure AFTER the snapshot (d→e boundary) → FULL rollback', async () => {
    const { clauseId, ccId } = await seedLive('Atomic', 'Atomic body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);

    const real = contractsService.createVersionSnapshot.bind(contractsService);
    jest
      .spyOn(contractsService, 'createVersionSnapshot')
      .mockImplementationOnce(async (...args: Parameters<typeof real>) => {
        await real(...args); // the snapshot DID run inside the txn…
        throw new Error('FORCED_POST_SNAPSHOT_FAILURE'); // …then the promote "fails"
      });

    await expect(redlines.accept(contractId, rl.id, hostCaller, {})).rejects.toThrow(
      'FORCED_POST_SNAPSHOT_FAILURE',
    );

    // FULL rollback: no orphan version, no current_version bump, clause
    // active, junction unmoved, redline still PROPOSED.
    await assertUntouched({ clauseId, ccId, redlineId: rl.id });
  });

  it('two sequential accepts on two DIFFERENT clauses: independent versions + repoints', async () => {
    const a = await seedLive('SeqA', 'A old.', 0);
    const b = await seedLive('SeqB', 'B old.', 1);
    const rlA = await redlines.propose(contractId, a.ccId, { proposedContent: 'A new.' }, cpCaller);
    const rlB = await redlines.propose(contractId, b.ccId, { proposedContent: 'B new.' }, cpCaller);

    const accA = await redlines.accept(contractId, rlA.id, hostCaller, {});
    const accB = await redlines.accept(contractId, rlB.id, hostCaller, {});

    expect(await versionCount()).toBe(2);
    expect(await currentVersion()).toBe(2);
    expect(accA.resulting_version_id).not.toBe(accB.resulting_version_id);
    // Neither accept clobbered the other's junction repoint.
    expect(await junctionClauseId(a.ccId)).toBe(accA.resulting_clause_id);
    expect(await junctionClauseId(b.ccId)).toBe(accB.resulting_clause_id);
    expect((await clauseRow(accA.resulting_clause_id!)).content).toBe('A new.');
    expect((await clauseRow(accB.resulting_clause_id!)).content).toBe('B new.');
    expect((await clauseRow(a.clauseId)).is_active).toBe(false);
    expect((await clauseRow(b.clauseId)).is_active).toBe(false);
  });

  // ══════════════════════════════════════════════════════════════════════
  // REJECT
  // ══════════════════════════════════════════════════════════════════════

  it('reject happy: REJECTED with decision fields, clause unchanged', async () => {
    const { clauseId, ccId } = await seedLive('Rej', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    const updated = await redlines.reject(contractId, rl.id, hostCaller, { note: 'no thanks' });
    expect(updated.status).toBe('REJECTED');
    expect(updated.decided_by_user_id).toBe(hostUserId);
    expect(updated.decision_note).toBe('no thanks');
    await assertUntouched({ clauseId, ccId, redlineId: rl.id, expectedStatus: 'REJECTED' });
  });

  it('reject a non-PROPOSED redline → 409 conflict, status unchanged', async () => {
    const { ccId } = await seedLive('Rej2', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await redlines.withdraw(contractId, rl.id, cpCaller);
    await expect(
      redlines.reject(contractId, rl.id, hostCaller, {}),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'REDLINE_NOT_PROPOSED' }),
    });
    expect((await redlineRow(rl.id)).status).toBe('WITHDRAWN');
  });

  it('reject by the counterparty → 404 (host-org only), status unchanged', async () => {
    const { ccId } = await seedLive('Rej3', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await expect(redlines.reject(contractId, rl.id, cpCaller, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await redlineRow(rl.id)).status).toBe('PROPOSED');
  });

  it('reject with a redlineId from a DIFFERENT contract → 404, no mutation', async () => {
    const other = await seedLive('RejX', 'Other.', 0, otherContractId);
    const foreign = await redlines.propose(
      otherContractId,
      other.ccId,
      { proposedContent: 'x' },
      hostCaller,
    );
    await expect(
      redlines.reject(contractId, foreign.id, hostCaller, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await redlineRow(foreign.id)).status).toBe('PROPOSED');
  });

  // ══════════════════════════════════════════════════════════════════════
  // COUNTER
  // ══════════════════════════════════════════════════════════════════════

  it('counter happy: original COUNTERED; child PROPOSED, round 2, parent set, FRESH base snapshot', async () => {
    const { clauseId, ccId } = await seedLive('Ctr', 'Round-1 body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'cp v2' }, cpCaller);
    // The clause moves on between propose and counter — the child must be
    // measured against the CURRENT body, not the round-1 base.
    await dataSource.query(`UPDATE clauses SET content = 'Interim body.' WHERE id = $1`, [
      clauseId,
    ]);

    const child = await redlines.counter(contractId, rl.id, hostCaller, {
      proposedContent: 'host counter v3',
      note: 'meet in the middle',
    });

    const original = await redlineRow(rl.id);
    expect(original.status).toBe('COUNTERED');
    expect(original.decided_by_user_id).toBe(hostUserId);

    expect(child.status).toBe('PROPOSED');
    expect(child.round).toBe(2);
    expect(child.parent_redline_id).toBe(rl.id);
    expect(child.contract_clause_id).toBe(ccId);
    expect(child.author_user_id).toBe(hostUserId);
    expect(child.note).toBe('meet in the middle');
    expect(child.base_content_snapshot).toBe('Interim body.'); // FRESH, not 'Round-1 body.'
    // No clause mutation from countering.
    expect((await clauseRow(clauseId)).is_active).toBe(true);
    expect(await junctionClauseId(ccId)).toBe(clauseId);
    expect(await versionCount()).toBe(0);
  });

  it('counter a non-PROPOSED redline → 409 conflict, no child minted', async () => {
    const { ccId } = await seedLive('Ctr2', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await redlines.reject(contractId, rl.id, hostCaller, {});
    const before = await redlineCount();
    await expect(
      redlines.counter(contractId, rl.id, hostCaller, { proposedContent: 'y' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'REDLINE_NOT_PROPOSED' }),
    });
    expect(await redlineCount()).toBe(before);
    expect((await redlineRow(rl.id)).status).toBe('REJECTED');
  });

  it('counter by the counterparty → 404 (host-org only)', async () => {
    const { ccId } = await seedLive('Ctr3', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await expect(
      redlines.counter(contractId, rl.id, cpCaller, { proposedContent: 'y' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await redlineRow(rl.id)).status).toBe('PROPOSED');
  });

  it('counter on a pinned contract → 409 CONTRACT_PINNED, original stays PROPOSED', async () => {
    const { ccId } = await seedLive('Ctr4', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await pinContract(contractId);
    const before = await redlineCount();
    await expect(
      redlines.counter(contractId, rl.id, hostCaller, { proposedContent: 'y' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'CONTRACT_PINNED' }),
    });
    expect(await redlineCount()).toBe(before);
    expect((await redlineRow(rl.id)).status).toBe('PROPOSED');
  });

  // ══════════════════════════════════════════════════════════════════════
  // WITHDRAW
  // ══════════════════════════════════════════════════════════════════════

  it('withdraw by the author → WITHDRAWN; clause untouched', async () => {
    const { clauseId, ccId } = await seedLive('Wd', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    const updated = await redlines.withdraw(contractId, rl.id, cpCaller);
    expect(updated.status).toBe('WITHDRAWN');
    await assertUntouched({ clauseId, ccId, redlineId: rl.id, expectedStatus: 'WITHDRAWN' });
  });

  it('withdraw by a NON-author → 404 (no existence oracle), status unchanged', async () => {
    const { ccId } = await seedLive('Wd2', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    // The host is a legitimate contract party but NOT the author.
    await expect(redlines.withdraw(contractId, rl.id, hostCaller)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect((await redlineRow(rl.id)).status).toBe('PROPOSED');
  });

  it('withdraw a non-PROPOSED redline (already accepted) → 409 conflict', async () => {
    const { ccId } = await seedLive('Wd3', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await redlines.accept(contractId, rl.id, hostCaller, {});
    await expect(redlines.withdraw(contractId, rl.id, cpCaller)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'REDLINE_NOT_PROPOSED' }),
    });
    expect((await redlineRow(rl.id)).status).toBe('ACCEPTED');
  });

  it('withdraw on a pinned contract → succeeds (no clause mutation, pin irrelevant)', async () => {
    const { ccId } = await seedLive('Wd4', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await pinContract(contractId);
    const updated = await redlines.withdraw(contractId, rl.id, cpCaller);
    expect(updated.status).toBe('WITHDRAWN');
  });

  it('withdraw with a redlineId from a DIFFERENT contract → 404', async () => {
    const other = await seedLive('WdX', 'Other.', 0, otherContractId);
    const foreign = await redlines.propose(
      otherContractId,
      other.ccId,
      { proposedContent: 'x' },
      hostCaller,
    );
    await expect(
      redlines.withdraw(contractId, foreign.id, hostCaller),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await redlineRow(foreign.id)).status).toBe('PROPOSED');
  });

  // ══════════════════════════════════════════════════════════════════════
  // CONCURRENCY — the same-clause junction race (lesson #277's open window)
  // ══════════════════════════════════════════════════════════════════════
  //
  // These run GENUINELY parallel transactions: each `redlines.*` call takes its
  // own pooled connection, so the interleaving and the outcome are decided by
  // real Postgres row locks, not by await ordering. A sequential pair of awaits
  // would prove nothing here.
  //
  // The guard under test is `lockLiveJunction` (SELECT … FOR UPDATE on the
  // shared junction row, taken before the staleness read). Remove it and the
  // FIRST test below fails with a DOUBLE promotion — that RED verification is
  // the whole point of this block.
  describe('concurrent deciders on the SAME clause', () => {
    /** How many clauses descend from `parentId` — >1 means a forked chain. */
    const childClauseCount = async (parentId: string) =>
      Number(
        (
          await dataSource.query(
            `SELECT count(*)::int n FROM clauses WHERE parent_clause_id = $1`,
            [parentId],
          )
        )[0].n,
      );

    /** Seed one live clause + TWO independent PROPOSED redlines against it. */
    const seedTwoProposals = async (label: string, body: string) => {
      const { clauseId, ccId } = await seedLive(label, body, 0);
      const r1 = await redlines.propose(
        contractId,
        ccId,
        { proposedContent: `${label} — proposal ONE` },
        cpCaller,
      );
      const r2 = await redlines.propose(
        contractId,
        ccId,
        { proposedContent: `${label} — proposal TWO` },
        hostCaller,
      );
      // Both measured against the same untouched base — neither is pre-stale.
      expect((await redlineRow(r1.id)).base_content_snapshot).toBe(body);
      expect((await redlineRow(r2.id)).base_content_snapshot).toBe(body);
      return { clauseId, ccId, r1, r2 };
    };

    /**
     * The invariant every outcome must satisfy: EXACTLY ONE promotion.
     * One version row, one child of the original, the junction on that child,
     * the original retired, and the winner's linkage pointing at what the
     * junction actually holds (no orphan).
     */
    const assertExactlyOnePromotion = async (
      clauseId: string,
      ccId: string,
      winnerId: string,
      loserId: string,
    ) => {
      expect(await versionCount()).toBe(1);
      expect(await currentVersion()).toBe(1);
      // THE orphan check — a second child means both txns promoted.
      expect(await childClauseCount(clauseId)).toBe(1);

      const winner = await redlineRow(winnerId);
      expect(winner.status).toBe('ACCEPTED');
      const live = await junctionClauseId(ccId);
      // The junction holds precisely the winner's promoted clause: no
      // last-committer-wins overwrite, no dangling resulting_clause_id.
      expect(live).toBe(winner.resulting_clause_id);
      const promoted = await clauseRow(live);
      expect(promoted.parent_clause_id).toBe(clauseId);
      expect(promoted.is_active).toBe(true);
      expect((await clauseRow(clauseId)).is_active).toBe(false);

      // The loser mutated nothing: terminal, unlinked.
      const loser = await redlineRow(loserId);
      expect(loser.status).not.toBe('ACCEPTED');
      expect(loser.resulting_clause_id).toBeNull();
      expect(loser.resulting_version_id).toBeNull();
    };

    it('⭐ TWO DIFFERENT redlines on ONE clause, accepted CONCURRENTLY → exactly one promotion, loser STALE, no orphaned clause', async () => {
      const { clauseId, ccId, r1, r2 } = await seedTwoProposals('Race', 'Base body.');

      // Genuinely parallel — two connections, two live transactions.
      const [o1, o2] = await Promise.allSettled([
        redlines.accept(contractId, r1.id, hostCaller, {}),
        redlines.accept(contractId, r2.id, hostCaller, {}),
      ]);

      const fulfilled = [o1, o2].filter((o) => o.status === 'fulfilled');
      const rejected = [o1, o2].filter((o) => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The loser fails with the EXISTING coded 409 — never a deadlock (40P01),
      // never a raw 500, never a silent success.
      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err).toMatchObject({
        response: expect.objectContaining({ error: 'STALE_REDLINE' }),
      });

      const winnerId = o1.status === 'fulfilled' ? r1.id : r2.id;
      const loserId = o1.status === 'fulfilled' ? r2.id : r1.id;
      await assertExactlyOnePromotion(clauseId, ccId, winnerId, loserId);
      expect((await redlineRow(loserId)).status).toBe('STALE');
    });

    it('the concurrent outcome is IDENTICAL to running the two accepts sequentially', async () => {
      // Same fixture, accepted one after the other — the reference state.
      const seq = await seedTwoProposals('Seq', 'Base body.');
      await redlines.accept(contractId, seq.r1.id, hostCaller, {});
      await expect(
        redlines.accept(contractId, seq.r2.id, hostCaller, {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'STALE_REDLINE' }),
      });
      await assertExactlyOnePromotion(seq.clauseId, seq.ccId, seq.r1.id, seq.r2.id);

      const reference = {
        versions: await versionCount(),
        currentVersion: await currentVersion(),
        children: await childClauseCount(seq.clauseId),
        junctionIsWinner: (await junctionClauseId(seq.ccId)) ===
          (await redlineRow(seq.r1.id)).resulting_clause_id,
        originalActive: (await clauseRow(seq.clauseId)).is_active,
        winnerStatus: (await redlineRow(seq.r1.id)).status,
        loserStatus: (await redlineRow(seq.r2.id)).status,
      };

      // Now the concurrent run, from a clean thread.
      await dataSource.query(`DELETE FROM clause_redlines WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM contract_versions WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id = $1`, [contractId]);
      await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [hostOrgId]);
      await dataSource.query(`UPDATE contracts SET current_version = 0 WHERE id = $1`, [
        contractId,
      ]);

      const par = await seedTwoProposals('Par', 'Base body.');
      const [p1] = await Promise.allSettled([
        redlines.accept(contractId, par.r1.id, hostCaller, {}),
        redlines.accept(contractId, par.r2.id, hostCaller, {}),
      ]);
      const winner = p1.status === 'fulfilled' ? par.r1 : par.r2;
      const loser = p1.status === 'fulfilled' ? par.r2 : par.r1;

      expect({
        versions: await versionCount(),
        currentVersion: await currentVersion(),
        children: await childClauseCount(par.clauseId),
        junctionIsWinner: (await junctionClauseId(par.ccId)) ===
          (await redlineRow(winner.id)).resulting_clause_id,
        originalActive: (await clauseRow(par.clauseId)).is_active,
        winnerStatus: (await redlineRow(winner.id)).status,
        loserStatus: (await redlineRow(loser.id)).status,
      }).toEqual(reference);
    });

    it('the SAME redline accepted CONCURRENTLY → one winner, loser 409 REDLINE_NOT_PROPOSED (identical to arriving second)', async () => {
      const { clauseId, ccId } = await seedLive('Same', 'Base body.', 0);
      const rl = await redlines.propose(contractId, ccId, { proposedContent: 'v2' }, cpCaller);

      const outcomes = await Promise.allSettled([
        redlines.accept(contractId, rl.id, hostCaller, {}),
        redlines.accept(contractId, rl.id, hostCaller, {}),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
      // The same coded 409 a sequential second accept produces — the racing
      // caller is indistinguishable from one who simply arrived second.
      expect(rejected.reason).toMatchObject({
        response: expect.objectContaining({ error: 'REDLINE_NOT_PROPOSED' }),
      });

      expect(await versionCount()).toBe(1);
      expect(await childClauseCount(clauseId)).toBe(1);
      expect((await redlineRow(rl.id)).status).toBe('ACCEPTED');
      expect(await junctionClauseId(ccId)).toBe(
        (await redlineRow(rl.id)).resulting_clause_id,
      );
    });

    it('accept + counter on the SAME redline CONCURRENTLY → no deadlock (40P01); one wins, the other gets a coded 409', async () => {
      // The lock-order test: accept locks junction→redline. If counter locked
      // redline→junction, this pair would cycle and Postgres would abort one
      // with a 40P01 deadlock (a 500, not a clean 409).
      const { clauseId, ccId } = await seedLive('Deadlock', 'Base body.', 0);
      const rl = await redlines.propose(contractId, ccId, { proposedContent: 'v2' }, cpCaller);

      const outcomes = await Promise.allSettled([
        redlines.accept(contractId, rl.id, hostCaller, {}),
        redlines.counter(contractId, rl.id, hostCaller, { proposedContent: 'host v3' }),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);

      const rejected = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
      const reason = rejected.reason as Error & { code?: string; response?: unknown };
      // NEVER a deadlock, and never a raw driver error surfacing as a 500.
      expect(reason.code).not.toBe('40P01');
      expect(String(reason.message)).not.toMatch(/deadlock/i);
      expect(reason).toMatchObject({
        response: expect.objectContaining({ error: 'REDLINE_NOT_PROPOSED' }),
      });

      // Whichever won, the clause thread is coherent: at most one promotion,
      // and the junction always points at a live clause.
      expect(await childClauseCount(clauseId)).toBeLessThanOrEqual(1);
      expect((await clauseRow(await junctionClauseId(ccId))).is_active).toBe(true);
    });

    it('counter racing an accept on the SAME clause reads a CONSISTENTLY SERIALIZED base — never a torn read', async () => {
      // Two DIFFERENT redlines: r1 accepted, r2 countered, concurrently. BOTH
      // orderings are legal — the junction lock serializes them, it does not
      // order them. What the lock guarantees is that the counter's base is a
      // body that was genuinely live while IT held the lock:
      //   - counter first  → base is the ORIGINAL body (then the accept promotes)
      //   - accept first   → base is the PROMOTED body (never born stale)
      // A base outside that pair would mean the counter read the clause while
      // another txn was mid-promotion, which is exactly what the lock prevents.
      const { clauseId, ccId, r1, r2 } = await seedTwoProposals('Fresh', 'Base body.');

      const [acc, ctr] = await Promise.allSettled([
        redlines.accept(contractId, r1.id, hostCaller, {}),
        redlines.counter(contractId, r2.id, hostCaller, { proposedContent: 'host v3' }),
      ]);

      if (acc.status === 'fulfilled' && ctr.status === 'fulfilled') {
        const promotedBody = (await clauseRow(acc.value.resulting_clause_id!)).content;
        expect(promotedBody).not.toBe('Base body.');
        // Exactly one of the two legal serializations — nothing else.
        expect(['Base body.', promotedBody]).toContain(
          ctr.value.base_content_snapshot,
        );
      }
      // Either way the thread stays coherent — one promotion at most, and the
      // junction always points at a live clause.
      expect(await childClauseCount(clauseId)).toBeLessThanOrEqual(1);
      expect((await clauseRow(await junctionClauseId(ccId))).is_active).toBe(true);
    });
  });
});
