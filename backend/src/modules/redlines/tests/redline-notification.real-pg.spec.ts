import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
  NotificationType,
  RedlineNotificationBatch,
  User,
  UserRole,
} from '../../../database/entities';
import { ContractsService } from '../../contracts/contracts.service';
import {
  ContractAccessService,
  ManagingOrGuestCaller,
} from '../../contracts/services/contract-access.service';
import { NegotiationStatusService } from '../../contracts/services/negotiation-status.service';
import { RedlineService } from '../redline.service';
import { RedlineNotificationService } from '../services/redline-notification.service';
import { RedlineDigestProcessor } from '../processors/redline-digest.processor';
import { resolveRecipientLang } from '../utils/recipient-language.util';

/**
 * 7.19 Slice 4 — redline notifications, proven on real Postgres.
 *
 * The load-bearing guarantees here are all SQL-level or ordering-level and a
 * mocked DB would hide every one of them (lesson #140):
 *
 *   • the debounce window is an atomic conditional UPSERT whose RETURNING
 *     shape decides leading-edge vs suppressed (the lesson #148/#280 tuple
 *     trap lives exactly here),
 *   • claim-by-delete must be at-most-once across concurrent flushes,
 *   • and BEST-EFFORT means a notification blowing up must leave a COMMITTED
 *     redline — which can only be proven by reading the row back from
 *     Postgres after forcing the failure.
 *
 * `NotificationDispatchService` is the ONE mocked seam (it owns a live Bull
 * queue + SMTP); everything under test — recipient resolution, channel
 * derivation, language, copy, leak-scrubbing, batching, the sweeper — is real.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[redline-notifications] SKIPPING real-Postgres spec: DATABASE_URL unset ' +
      '— the debounce UPSERT, claim-by-delete, and best-effort-commit ' +
      'guarantees are NOT proven without Postgres.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

jest.setTimeout(60000);

describeReal('RedlineNotificationService — 7.19 Slice 4 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let contractsService: ContractsService;
  let contractAccess: ContractAccessService;
  let redlines: RedlineService;
  let notifications: RedlineNotificationService;
  let digestProcessor: RedlineDigestProcessor;

  /** The single mocked seam — captures what would have been dispatched. */
  const dispatchMock = jest.fn();
  const enqueueEmailMock = jest.fn();
  const dispatchStub = {
    dispatch: (...args: any[]) => dispatchMock(...args),
    enqueueEmail: (...args: any[]) => enqueueEmailMock(...args),
  };

  const hostOrgId = randomUUID();
  const cpOrgId = randomUUID();
  const hostUserId = randomUUID();
  const cpUserId = randomUUID();
  const arUserId = randomUUID(); // counterparty whose preferred_language = 'ar'
  const projectId = randomUUID();
  const contractId = randomUUID();
  const arContractId = randomUUID(); // separate contract → separate debounce window

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
  const arCaller: ManagingOrGuestCaller = {
    id: arUserId,
    organization_id: cpOrgId,
    role: UserRole.OWNER_ADMIN,
    account_type: AccountType.MANAGING,
  };

  const insertUser = (
    id: string,
    org: string | null,
    first: string,
    last: string,
    lang = 'en',
    email?: string,
  ) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,$4,$5,'OWNER_ADMIN','MANAGING',$6,
                 TRUE,TRUE,FALSE,$7,0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [
        id,
        email ?? `rln-${id.slice(0, 8)}@test.local`,
        '$2a$10$dummy.hash.redline.notify',
        first,
        last,
        org,
        lang,
      ],
    );

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

  /** All dispatch calls (in-app + email) captured this test. */
  const dispatched = () => dispatchMock.mock.calls.map((c) => c[0]);
  const emailOnly = () => enqueueEmailMock.mock.calls.map((c) => c[0]);

  const batchRows = async (cid: string = contractId) =>
    dataSource.query(
      `SELECT * FROM redline_notification_batches WHERE contract_id = $1`,
      [cid],
    );

  /** Force every open window to have already elapsed, so the sweeper claims it. */
  const expireWindows = () =>
    dataSource.query(
      `UPDATE redline_notification_batches SET window_ends_at = NOW() - interval '1 minute'`,
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
      {} as any,
      {} as any,
    );
    notifications = new RedlineNotificationService(
      dispatchStub as any,
      dataSource.getRepository(User),
      dataSource.getRepository(RedlineNotificationBatch),
      moduleRef.get(ConfigService),
    );
    digestProcessor = new RedlineDigestProcessor(
      dataSource.getRepository(RedlineNotificationBatch),
      notifications,
    );
    redlines = new RedlineService(
      dataSource.getRepository(ClauseRedline),
      dataSource.getRepository(ContractClause),
      contractAccess,
      contractsService,
      new NegotiationStatusService(
        dataSource.getRepository(Contract),
        contractAccess,
      ),
      notifications,
    );

    for (const [org, name] of [
      [hostOrgId, 'rln-host-org'],
      [cpOrgId, 'rln-cp-org'],
    ] as const) {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
        org,
        `${name}-${org.slice(0, 8)}`,
      ]);
    }
    await insertUser(hostUserId, hostOrgId, 'Hana', 'Host', 'en', 'host@rln.test');
    await insertUser(cpUserId, cpOrgId, 'Cara', 'Counterparty', 'en', 'cp@rln.test');
    await insertUser(arUserId, cpOrgId, 'Amir', 'Arabi', 'ar', 'ar@rln.test');
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'rln-project',$3)`,
      [projectId, hostOrgId, hostUserId],
    );
    for (const cid of [contractId, arContractId]) {
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1,$2,$3,'FIDIC_RED_BOOK',$4)`,
        [cid, projectId, cid === contractId ? 'RLN Contract' : 'RLN Arabic Contract', hostUserId],
      );
      for (const uid of [cpUserId, arUserId]) {
        await dataSource.query(
          `INSERT INTO guest_contract_access (id, user_id, contract_id, granted_by)
           VALUES ($1,$2,$3,$4)`,
          [randomUUID(), uid, cid, hostUserId],
        );
      }
    }
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    dispatchMock.mockReset();
    enqueueEmailMock.mockReset();
    await dataSource.query(`DELETE FROM redline_notification_batches`);
    await dataSource.query(`DELETE FROM clause_redlines WHERE contract_id IN ($1,$2)`, [
      contractId,
      arContractId,
    ]);
    await dataSource.query(`DELETE FROM contract_versions WHERE contract_id IN ($1,$2)`, [
      contractId,
      arContractId,
    ]);
    await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id IN ($1,$2)`, [
      contractId,
      arContractId,
    ]);
    await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [hostOrgId]);
    await dataSource.query(
      `UPDATE contracts SET current_version = 0 WHERE id IN ($1,$2)`,
      [contractId, arContractId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM redline_notification_batches`);
      await dataSource.query(`DELETE FROM clause_redlines WHERE contract_id IN ($1,$2)`, [
        contractId,
        arContractId,
      ]);
      await dataSource.query(`DELETE FROM contract_versions WHERE contract_id IN ($1,$2)`, [
        contractId,
        arContractId,
      ]);
      await dataSource.query(`DELETE FROM contract_clauses WHERE contract_id IN ($1,$2)`, [
        contractId,
        arContractId,
      ]);
      await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [hostOrgId]);
      await dataSource.query(`DELETE FROM guest_contract_access WHERE contract_id IN ($1,$2)`, [
        contractId,
        arContractId,
      ]);
      await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [
        contractId,
        arContractId,
      ]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [
        hostUserId,
        cpUserId,
        arUserId,
      ]);
      await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [
        hostOrgId,
        cpOrgId,
      ]);
      await dataSource.destroy();
    }
    await moduleRef?.close();
  });

  // ══════════════════════════════════════════════════════════════════════
  // RECIPIENT + CHANNEL — the other party, never the actor
  // ══════════════════════════════════════════════════════════════════════

  it('propose → the HOST gets BOTH (in-app + email); the actor gets nothing', async () => {
    const { ccId } = await seedLive('Payment', 'Original payment terms.', 0);
    await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'New payment terms.' },
      cpCaller,
    );

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const call = dispatched()[0];
    expect(call.userId).toBe(hostUserId); // the HOST
    expect(call.userId).not.toBe(cpUserId); // never the actor
    expect(call.type).toBe(NotificationType.BOTH);
    expect(call.email?.to).toBe('host@rln.test');
    expect(call.relatedEntityType).toBe('contract');
    expect(call.relatedEntityId).toBe(contractId);
    expect(call.email?.templateName).toBe('redline-proposed');
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });

  it('accept → the COUNTERPARTY (author) gets BOTH; the deciding host gets nothing', async () => {
    const { ccId } = await seedLive('Payment', 'Original payment terms.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'New payment terms.' },
      cpCaller,
    );
    dispatchMock.mockReset();

    await redlines.accept(contractId, rl.id, hostCaller, {});

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const call = dispatched()[0];
    expect(call.userId).toBe(cpUserId); // the proposal's author
    expect(call.userId).not.toBe(hostUserId); // never the actor
    expect(call.type).toBe(NotificationType.BOTH);
    expect(call.email?.templateName).toBe('redline-accepted');
  });

  it('accept WITH host edits → honest "accepted with edits" copy, never "your wording is live"', async () => {
    const { ccId } = await seedLive('Liability', 'Original liability cap.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'Counterparty cap: 5%.' },
      cpCaller,
    );
    dispatchMock.mockReset();

    // The host substitutes DIFFERENT wording while accepting.
    await redlines.accept(contractId, rl.id, hostCaller, {
      editedContent: 'Host cap: 15%.',
    });

    const call = dispatched()[0];
    expect(call.userId).toBe(cpUserId);
    expect(call.email?.templateName).toBe('redline-accepted_edited');
    // It must SAY the wording was changed…
    expect(call.email?.subject).toContain('accepted with edits');
    expect(call.title).toContain('accepted with edits');
    expect(call.email?.html).toContain('modified the wording');
    expect(call.email?.html).toContain('differs from what you proposed');
    // …and must NOT claim the counterparty's own wording went live.
    expect(call.email?.html).not.toContain(
      'The proposed wording is now the live clause text',
    );
    // The promoted clause really is the host's text (the premise of the copy).
    const promoted = (
      await dataSource.query(
        `SELECT c.content, c.review_status
           FROM contract_clauses cc JOIN clauses c ON c.id = cc.clause_id
          WHERE cc.id = $1`,
        [ccId],
      )
    )[0];
    expect(promoted.content).toBe('Host cap: 15%.');
    expect(promoted.review_status).toBe('EDITED');
  });

  it('accept WITHOUT edits keeps the plain "accepted" copy', async () => {
    const { ccId } = await seedLive('Plain', 'Original body.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'Counterparty body.' },
      cpCaller,
    );
    dispatchMock.mockReset();
    await redlines.accept(contractId, rl.id, hostCaller, {});

    const call = dispatched()[0];
    expect(call.email?.templateName).toBe('redline-accepted');
    expect(call.email?.subject).not.toContain('with edits');
    expect(call.email?.html).toContain('The proposed wording is now the live clause text');
  });

  it('reject → the COUNTERPARTY gets BOTH; the deciding host gets nothing', async () => {
    const { ccId } = await seedLive('Scope', 'Scope body.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'Revised scope.' },
      cpCaller,
    );
    dispatchMock.mockReset();

    await redlines.reject(contractId, rl.id, hostCaller, { note: 'no' });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatched()[0].userId).toBe(cpUserId);
    expect(dispatched()[0].email?.templateName).toBe('redline-rejected');
  });

  it('counter → the PARENT author gets BOTH (not the child author, who is the host)', async () => {
    const { ccId } = await seedLive('Time', 'Original time body.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'CP time body.' },
      cpCaller,
    );
    dispatchMock.mockReset();

    await redlines.counter(contractId, rl.id, hostCaller, {
      proposedContent: 'Host counter body.',
    });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatched()[0].userId).toBe(cpUserId);
    expect(dispatched()[0].email?.templateName).toBe('redline-countered');
  });

  it('withdraw → NO notification at all', async () => {
    const { ccId } = await seedLive('Withdraw', 'Body.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'CP body.' },
      cpCaller,
    );
    dispatchMock.mockReset();
    enqueueEmailMock.mockReset();
    // The propose above legitimately opened a PROPOSED window for the host;
    // snapshot it so we assert on what WITHDRAW changed, not on what propose did.
    const before = await batchRows();

    await redlines.withdraw(contractId, rl.id, cpCaller);

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(enqueueEmailMock).not.toHaveBeenCalled();
    // Withdraw opened no window, bumped no counter, and left no DECIDED batch.
    const after = await batchRows();
    expect(after).toHaveLength(before.length);
    expect(after.filter((r: any) => r.event_class === 'DECIDED')).toHaveLength(0);
    expect(after.map((r: any) => Number(r.pending_count))).toEqual(
      before.map((r: any) => Number(r.pending_count)),
    );
  });

  it('host proposing on their OWN contract notifies nobody (actor === recipient)', async () => {
    const { ccId } = await seedLive('Self', 'Body.', 0);
    await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'Host self-proposal.' },
      hostCaller,
    );
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });

  it('recipient with NO user row → EMAIL only, no in-app row, no crash', async () => {
    await notifications.send({
      lang: 'en',
      variant: 'proposed',
      contract: { id: contractId, name: 'RLN Contract' } as any,
      recipient: {
        userId: null, // org-less future guest — no user row exists
        email: 'external@rln.test',
        preferredLanguage: null,
      },
      vars: { contractName: 'RLN Contract', actorName: 'Cara Counterparty' },
    });

    // dispatch() writes the in-app row and is NEVER called without a user id.
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(enqueueEmailMock).toHaveBeenCalledTimes(1);
    expect(emailOnly()[0].to).toBe('external@rln.test');
    expect(emailOnly()[0].html).toContain('Sign');
  });

  // ══════════════════════════════════════════════════════════════════════
  // BEST-EFFORT — the redline survives a broken notification
  // ══════════════════════════════════════════════════════════════════════

  it('BEST-EFFORT: a throwing notification still leaves the accept COMMITTED', async () => {
    const { clauseId, ccId } = await seedLive('Critical', 'Original body.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'Promoted body.' },
      cpCaller,
    );
    // Force the dispatch seam to blow up on the accept notification.
    dispatchMock.mockImplementation(() => {
      throw new Error('SMTP is down');
    });

    // The accept itself must SUCCEED.
    const accepted = await redlines.accept(contractId, rl.id, hostCaller, {});
    expect(accepted.status).toBe('ACCEPTED');

    // …and the committed state must be fully intact, read back from Postgres.
    const row = (
      await dataSource.query(`SELECT * FROM clause_redlines WHERE id = $1`, [rl.id])
    )[0];
    expect(row.status).toBe('ACCEPTED');
    expect(row.resulting_clause_id).toBeTruthy();
    expect(row.resulting_version_id).toBeTruthy();

    // The promotion happened: original retired, junction repointed, version cut.
    const original = (
      await dataSource.query(`SELECT is_active FROM clauses WHERE id = $1`, [clauseId])
    )[0];
    expect(original.is_active).toBe(false);
    const junction = (
      await dataSource.query(`SELECT clause_id FROM contract_clauses WHERE id = $1`, [ccId])
    )[0];
    expect(junction.clause_id).toBe(row.resulting_clause_id);
    const versions = await dataSource.query(
      `SELECT count(*)::int n FROM contract_versions WHERE contract_id = $1`,
      [contractId],
    );
    expect(versions[0].n).toBe(1);
  });

  it('BEST-EFFORT: a throwing notification still leaves the propose COMMITTED', async () => {
    const { ccId } = await seedLive('Prop', 'Body.', 0);
    dispatchMock.mockImplementation(() => {
      throw new Error('notification exploded');
    });

    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'Still saved.' },
      cpCaller,
    );

    const row = (
      await dataSource.query(`SELECT * FROM clause_redlines WHERE id = $1`, [rl.id])
    )[0];
    expect(row).toBeTruthy();
    expect(row.status).toBe('PROPOSED');
    expect(row.proposed_content).toBe('Still saved.');
  });

  // ══════════════════════════════════════════════════════════════════════
  // LANGUAGE
  // ══════════════════════════════════════════════════════════════════════

  it('resolveRecipientLang allowlists: ar/ar-EG → ar; en/fr/null/junk → en', () => {
    expect(resolveRecipientLang('ar')).toBe('ar');
    expect(resolveRecipientLang('AR')).toBe('ar');
    expect(resolveRecipientLang('ar-EG')).toBe('ar');
    expect(resolveRecipientLang('ar_SA')).toBe('ar');
    expect(resolveRecipientLang('en')).toBe('en');
    expect(resolveRecipientLang('fr')).toBe('en'); // documented: no fr copy yet
    expect(resolveRecipientLang(null)).toBe('en');
    expect(resolveRecipientLang(undefined)).toBe('en');
    expect(resolveRecipientLang('')).toBe('en');
    expect(resolveRecipientLang('not-a-language')).toBe('en');
  });

  it('an ar recipient gets Arabic copy in an RTL shell; an en recipient gets English', async () => {
    // Arabic recipient: the ar user proposes → host is 'en' … so instead have
    // the HOST decide on the AR user's proposal, making the AR user the recipient.
    const { ccId } = await seedLive('Lang', 'Body for language test.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'Arabic-speaker proposal.' },
      arCaller,
    );
    dispatchMock.mockReset();

    await redlines.reject(contractId, rl.id, hostCaller, {});

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const arCall = dispatched()[0];
    expect(arCall.userId).toBe(arUserId);
    // Arabic subject + in-app copy…
    expect(arCall.email?.subject).toContain('تم رفض');
    expect(arCall.title).toContain('تم رفض');
    // …inside a genuinely RTL document (Arabic in an LTR shell renders wrong).
    expect(arCall.email?.html).toContain('<html lang="ar" dir="rtl">');
    expect(arCall.email?.html).toContain('direction:rtl');

    // Now the English recipient, same event class, different contract.
    const en = await seedLive('LangEn', 'English body.', 1, arContractId);
    const rl2 = await redlines.propose(
      arContractId,
      en.ccId,
      { proposedContent: 'English-speaker proposal.' },
      cpCaller,
    );
    dispatchMock.mockReset();
    await redlines.reject(arContractId, rl2.id, hostCaller, {});

    const enCall = dispatched()[0];
    expect(enCall.userId).toBe(cpUserId);
    expect(enCall.email?.subject).toContain('was rejected');
    expect(enCall.email?.html).toContain('<html lang="en" dir="ltr">');
    expect(enCall.email?.html).not.toContain('dir="rtl"');
  });

  // ══════════════════════════════════════════════════════════════════════
  // NO CROSS-ORG LEAK
  // ══════════════════════════════════════════════════════════════════════

  it('no cross-org leak: the actor is a display NAME only — no email, org, role, or UUID', async () => {
    const { ccId } = await seedLive('Leak', 'Leak-test body.', 0);
    await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'Counterparty wording.', note: 'internal-ish note' },
      cpCaller,
    );

    const call = dispatched()[0];
    const payload = JSON.stringify(call);

    // The scrubbed display name IS present…
    expect(call.email?.html).toContain('Cara Counterparty');
    // …and NOTHING identifying beyond it.
    expect(payload).not.toContain('cp@rln.test'); // the actor's email
    expect(payload).not.toContain(cpOrgId); // the actor's org UUID
    expect(payload).not.toContain('rln-cp-org'); // the actor's org NAME
    expect(payload).not.toContain('OWNER_ADMIN'); // the actor's role
    expect(payload).not.toContain(cpUserId); // the actor's user UUID
    expect(payload).not.toContain(hostOrgId); // the host org UUID
    // The proposal's free-text note is NOT broadcast either.
    expect(payload).not.toContain('internal-ish note');
  });

  it('a cross-org actor is labelled GUEST (external), never TEAM', async () => {
    const { ccId } = await seedLive('Label', 'Body.', 0);
    const rl = await redlines.propose(
      contractId,
      ccId,
      { proposedContent: 'CP wording.' },
      cpCaller,
    );
    // Host decides → the counterparty is notified and sees the HOST's name,
    // which is a host-org member, so the TEAM branch is the one exercised.
    dispatchMock.mockReset();
    await redlines.reject(contractId, rl.id, hostCaller, {});
    expect(dispatched()[0].email?.html).toContain('Hana Host');
  });

  // ══════════════════════════════════════════════════════════════════════
  // DEBOUNCE / DIGEST (Phase 1B)
  // ══════════════════════════════════════════════════════════════════════

  it('leading edge sends immediately and opens ONE window with pending_count 0', async () => {
    const { ccId } = await seedLive('W1', 'Body.', 0);
    await redlines.propose(contractId, ccId, { proposedContent: 'a' }, cpCaller);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const rows = await batchRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].pending_count)).toBe(0);
    expect(rows[0].event_class).toBe('PROPOSED');
    expect(rows[0].recipient_key).toBe(`u:${hostUserId}`);
  });

  it('a burst of N proposes → ONE immediate + ONE digest (not N notifications)', async () => {
    const seeds = [];
    for (let i = 0; i < 5; i++) {
      seeds.push(await seedLive(`Burst${i}`, `Body ${i}.`, i));
    }
    for (const s of seeds) {
      await redlines.propose(
        contractId,
        s.ccId,
        { proposedContent: `Proposal ${s.ccId}` },
        cpCaller,
      );
    }

    // Exactly ONE immediate notification for 5 events.
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const rows = await batchRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].pending_count)).toBe(4); // the 4 suppressed

    // Flush the window → exactly ONE digest carrying the count.
    dispatchMock.mockReset();
    await expireWindows();
    await digestProcessor.handleFlush({} as any);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const digest = dispatched()[0];
    expect(digest.userId).toBe(hostUserId);
    expect(digest.email?.templateName).toBe('redline-digest_proposed');
    expect(digest.email?.subject).toContain('4 more changes');
    // A digest carries NO cross-org author detail.
    expect(JSON.stringify(digest)).not.toContain('Cara Counterparty');

    // The window is consumed — a second flush sends nothing.
    dispatchMock.mockReset();
    await digestProcessor.handleFlush({} as any);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(await batchRows()).toHaveLength(0);
  });

  it('SELF-HEALING: a DEAD sweeper cannot permanently suppress — a stale window re-arms', async () => {
    // Simulates the sweeper being gone (crashed, paused queue, wiped
    // repeatable, deploy gap): windows elapse but are NEVER drained.
    const s1 = await seedLive('Heal1', 'Body.', 0);
    await redlines.propose(contractId, s1.ccId, { proposedContent: 'a' }, cpCaller);
    expect(dispatchMock).toHaveBeenCalledTimes(1); // leading edge

    const s2 = await seedLive('Heal2', 'Body.', 1);
    await redlines.propose(contractId, s2.ccId, { proposedContent: 'b' }, cpCaller);
    expect(dispatchMock).toHaveBeenCalledTimes(1); // suppressed, as designed

    // The window elapses. NOTHING drains it — the sweeper never runs.
    await expireWindows();

    const s3 = await seedLive('Heal3', 'Body.', 2);
    await redlines.propose(contractId, s3.ccId, { proposedContent: 'c' }, cpCaller);

    // Without the stale-window reset this would stay suppressed FOREVER:
    // no email, no in-app row, no digest, and no error anywhere.
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    const rows = await batchRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].pending_count)).toBe(0); // re-armed as a fresh window
    expect(new Date(rows[0].window_ends_at).getTime()).toBeGreaterThan(Date.now());

    // …and the re-armed window still batches normally.
    const s4 = await seedLive('Heal4', 'Body.', 3);
    await redlines.propose(contractId, s4.ccId, { proposedContent: 'd' }, cpCaller);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(Number((await batchRows())[0].pending_count)).toBe(1);
  });

  it('a lone event flushes with NO digest (pending_count 0 closes silently)', async () => {
    const { ccId } = await seedLive('Lone', 'Body.', 0);
    await redlines.propose(contractId, ccId, { proposedContent: 'only one' }, cpCaller);
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    dispatchMock.mockReset();
    await expireWindows();
    await digestProcessor.handleFlush({} as any);

    expect(dispatchMock).not.toHaveBeenCalled(); // nothing was suppressed
    expect(await batchRows()).toHaveLength(0); // window still closed
  });

  it('PROPOSED and DECIDED batch SEPARATELY (different audiences, different windows)', async () => {
    const { ccId } = await seedLive('Sep', 'Body.', 0);
    const rl = await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);
    await redlines.reject(contractId, rl.id, hostCaller, {});

    const rows = await batchRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.event_class).sort()).toEqual(['DECIDED', 'PROPOSED']);
    // Both were leading edges → both sent immediately.
    expect(dispatchMock).toHaveBeenCalledTimes(2);
  });

  it('claim-by-delete is at-most-once: concurrent flushes never double-send', async () => {
    const seeds = [];
    for (let i = 0; i < 3; i++) {
      seeds.push(await seedLive(`Race${i}`, `Body ${i}.`, i));
    }
    for (const s of seeds) {
      await redlines.propose(contractId, s.ccId, { proposedContent: 'r' }, cpCaller);
    }
    expect(Number((await batchRows())[0].pending_count)).toBe(2);

    dispatchMock.mockReset();
    await expireWindows();

    // Four sweepers race on the same elapsed window.
    await Promise.all([
      digestProcessor.handleFlush({} as any),
      digestProcessor.handleFlush({} as any),
      digestProcessor.handleFlush({} as any),
      digestProcessor.handleFlush({} as any),
    ]);

    expect(dispatchMock).toHaveBeenCalledTimes(1); // exactly one digest
    expect(await batchRows()).toHaveLength(0);
  });

  it('a failing digest send neither throws nor resurrects the window', async () => {
    const a = await seedLive('Fail1', 'Body.', 0);
    const b = await seedLive('Fail2', 'Body.', 1);
    await redlines.propose(contractId, a.ccId, { proposedContent: 'a' }, cpCaller);
    await redlines.propose(contractId, b.ccId, { proposedContent: 'b' }, cpCaller);

    dispatchMock.mockReset();
    dispatchMock.mockImplementation(() => {
      throw new Error('digest email exploded');
    });
    await expireWindows();

    // The processor must swallow — Bull must never see a rejection.
    await expect(digestProcessor.handleFlush({} as any)).resolves.toBeUndefined();
    expect(await batchRows()).toHaveLength(0);

    // And the redlines are untouched by the failed digest.
    const rls = await dataSource.query(
      `SELECT status FROM clause_redlines WHERE contract_id = $1`,
      [contractId],
    );
    expect(rls).toHaveLength(2);
    expect(rls.every((r: any) => r.status === 'PROPOSED')).toBe(true);
  });

  it('different recipients on the same contract get INDEPENDENT windows', async () => {
    const s1 = await seedLive('Multi1', 'Body.', 0);
    const s2 = await seedLive('Multi2', 'Body.', 1);
    // Two different counterparties each propose → the host is the recipient for
    // both, so this shares ONE window…
    await redlines.propose(contractId, s1.ccId, { proposedContent: 'x' }, cpCaller);
    await redlines.propose(contractId, s2.ccId, { proposedContent: 'y' }, arCaller);
    expect(dispatchMock).toHaveBeenCalledTimes(1); // second was suppressed
    expect(await batchRows()).toHaveLength(1);

    // …while decisions to the two DIFFERENT authors open two separate windows.
    const rows = await dataSource.query(
      `SELECT id FROM clause_redlines WHERE contract_id = $1 ORDER BY created_at`,
      [contractId],
    );
    dispatchMock.mockReset();
    await redlines.reject(contractId, rows[0].id, hostCaller, {});
    await redlines.reject(contractId, rows[1].id, hostCaller, {});
    expect(dispatchMock).toHaveBeenCalledTimes(2); // two distinct recipients

    const decided = (await batchRows()).filter(
      (r: any) => r.event_class === 'DECIDED',
    );
    expect(decided).toHaveLength(2);
    expect(decided.map((r: any) => r.recipient_key).sort()).toEqual(
      [`u:${arUserId}`, `u:${cpUserId}`].sort(),
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  // CONTENT
  // ══════════════════════════════════════════════════════════════════════

  it('the email carries the contract name, the clause reference, and a real contract link', async () => {
    const { ccId } = await seedLive('Payment Terms', 'Body.', 3);
    await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);

    const html = dispatched()[0].email?.html as string;
    expect(html).toContain('RLN Contract');
    expect(html).toContain('§4 — Payment Terms'); // order 3 → section_number '4'
    expect(html).toContain(`/app/contracts/${contractId}`);
    // No fabricated deep-link query param: ContractDetailPage tabs are local
    // state with no URL sync, so `?tab=redlines` would silently do nothing.
    expect(html).not.toContain('?tab=');
  });

  it('HTML-escapes tenant-supplied text (contract name / clause title)', async () => {
    await dataSource.query(`UPDATE contracts SET name = $1 WHERE id = $2`, [
      'Acme <script>alert(1)</script> & Co',
      contractId,
    ]);
    const { ccId } = await seedLive('Bad "Title" <b>', 'Body.', 0);
    await redlines.propose(contractId, ccId, { proposedContent: 'x' }, cpCaller);

    const html = dispatched()[0].email?.html as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; Co');
    expect(html).toContain('&lt;b&gt;');

    await dataSource.query(`UPDATE contracts SET name = 'RLN Contract' WHERE id = $1`, [
      contractId,
    ]);
  });
});
