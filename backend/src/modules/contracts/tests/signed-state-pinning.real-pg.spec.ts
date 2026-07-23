import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createHash, randomUUID } from 'crypto';

import {
  AuditLog,
  Clause,
  Contract,
  ContractClause,
  ContractVersion,
  GuestContractAccess,
  User,
} from '../../../database/entities';
import { ContractsService } from '../contracts.service';
import { ContractAccessService } from '../services/contract-access.service';
import { ContractPinningService } from '../services/contract-pinning.service';
import { DocuSignService } from '../../docusign/docusign.service';

/**
 * Signed-state pinning — Slice 1 (CAPTURE), real Postgres.
 *
 * BOTH execution doors (DocuSign completed webhook + manual mark-signed)
 * funnel through ONE shared pin operation: snapshot → canonical SHA-256 →
 * pin pointers → executed state, atomically. Proven against real Postgres
 * (atomicity, the FK, the conditional void-guard UPDATE, and jsonb
 * round-trip behaviour are SQL-level facts — lesson #140: mocks hide
 * exactly these).
 *
 * RED→GREEN: run before migration 1767000000001 is applied → every pin
 * query fails on the missing pinned_version_id / content_hash columns.
 * GREEN after the migration proves schema + behaviour end-to-end.
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[signed-state-pinning] SKIPPING real-Postgres spec: DATABASE_URL unset — ' +
      'this MUST run against Postgres to prove the pin is atomic, idempotent, ' +
      'and that the void-guard is a real conditional UPDATE.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

/**
 * INDEPENDENT canonical hash — deliberately NOT the production
 * canonical-pin.util implementation. Recursively sorts object keys, keeps
 * array order, sha256-hex. If the pinned hash matches this, it was produced
 * by a canonical serializer over the same inputs — not by hashing
 * Postgres-round-tripped jsonb (whose key order is not preserved).
 */
function independentCanonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(independentCanonical).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${independentCanonical(obj[k])}`)
    .join(',')}}`;
}
const independentHash = (payload: unknown): string =>
  createHash('sha256').update(independentCanonical(payload), 'utf8').digest('hex');

describeReal('Signed-state pinning — Slice 1 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let contractsService: ContractsService;
  let contractAccess: ContractAccessService;
  let pinning: ContractPinningService;
  let docusign: DocuSignService;

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const ownerId = randomUUID();
  const projectId = randomUUID();

  const contractIds: string[] = [];

  const insertUser = (id: string, org: string | null) =>
    dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'Pin','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [id, `pin-${id.slice(0, 8)}@test.local`, '$2a$10$dummy.hash.placeholder.pin.test', org],
    );

  const insertContract = async (opts: {
    status: string;
    signatureStatus?: string | null;
    envelopeId?: string | null;
  }): Promise<string> => {
    const id = randomUUID();
    contractIds.push(id);
    await dataSource.query(
      `INSERT INTO contracts (
         id, project_id, name, contract_type, created_by, status,
         signature_status, docusign_envelope_id,
         party_first_name, party_second_name, party_type,
         contract_value, currency, start_date, notice_period_days
       ) VALUES ($1,$2,'Pin Contract','FIDIC_RED_BOOK_2017',$3,$4,$5,$6,
                 'الهيئة القومية للأنفاق','شركة المقاولون العرب','OWNER',
                 1500000.50,'EGP','2026-01-15',28)`,
      [
        id,
        projectId,
        ownerId,
        opts.status,
        opts.signatureStatus ?? null,
        opts.envelopeId ?? null,
      ],
    );
    return id;
  };

  const seedClause = async (
    contractId: string,
    title: string,
    content: string,
    order: number,
    isProposed = false,
  ) => {
    const clauseId = randomUUID();
    await dataSource.query(
      `INSERT INTO clauses (id, organization_id, title, content, source, review_status, version, is_active, created_by)
       VALUES ($1,$2,$3,$4,'AI_EXTRACTED','APPROVED',1,TRUE,$5)`,
      [clauseId, orgId, title, content, ownerId],
    );
    await dataSource.query(
      `INSERT INTO contract_clauses (id, contract_id, clause_id, section_number, order_index, is_proposed)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), contractId, clauseId, String(order + 1), order, isProposed],
    );
  };

  const getContractRow = async (id: string) =>
    (
      await dataSource.query(
        `SELECT status, signature_status, executed_at, pinned_version_id, pinned_at, pinned_content_hash
           FROM contracts WHERE id = $1`,
        [id],
      )
    )[0];

  const getVersions = (contractId: string) =>
    dataSource.query(
      `SELECT id, version_number, event_type, content_hash, metadata
         FROM contract_versions WHERE contract_id = $1 ORDER BY version_number ASC`,
      [contractId],
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
      {} as any, // 19 relationshipTypes (T0a) — not exercised: no fixture passes relationship_type
      {} as any, // 20 negotiationStatus (7.19 S2) — share hook not exercised here
    );
    pinning = new ContractPinningService(
      dataSource,
      contractsService,
      contractAccess,
      dataSource.getRepository(AuditLog),
    );
    docusign = new DocuSignService(
      { get: jest.fn().mockReturnValue('') } as any, // configService
      dataSource.getRepository(Contract),
      dataSource.getRepository(AuditLog),
      {} as any, // exportService (unused on webhook path)
      { notifyContractStatusChange: jest.fn() } as any, // notificationsService
      { sendGenericEmail: jest.fn() } as any, // emailService
      contractAccess,
      pinning,
    );

    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      orgId,
      `pin-org-${orgId.slice(0, 8)}`,
    ]);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
      otherOrgId,
      `pin-other-org-${otherOrgId.slice(0, 8)}`,
    ]);
    await insertUser(ownerId, orgId);
    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'pin-project',$3)`,
      [projectId, orgId, ownerId],
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      // FK is ON DELETE RESTRICT — clear pin pointers before deleting versions.
      await dataSource.query(
        `UPDATE contracts SET pinned_version_id = NULL WHERE id = ANY($1)`,
        [contractIds],
      );
      await dataSource.query(
        `DELETE FROM audit_logs WHERE entity_id = ANY($1)`,
        [contractIds],
      );
      await dataSource.query(
        `DELETE FROM contract_versions WHERE contract_id = ANY($1)`,
        [contractIds],
      );
      await dataSource.query(
        `DELETE FROM contract_clauses WHERE contract_id = ANY($1)`,
        [contractIds],
      );
      await dataSource.query(`DELETE FROM clauses WHERE organization_id = $1`, [orgId]);
      await dataSource.query(`DELETE FROM contracts WHERE id = ANY($1)`, [contractIds]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [
        [orgId, otherOrgId],
      ]);
    }
    await moduleRef?.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // (a) + (b) — DocuSign completed door
  // ────────────────────────────────────────────────────────────────────

  it('⭐ (a) DocuSign completed webhook PINS: snapshot created, 64-hex content_hash, contract pointers + executed state set atomically; guest-proposed clauses excluded', async () => {
    const envelopeId = `env-${randomUUID().slice(0, 12)}`;
    const contractId = await insertContract({
      status: 'SENT_TO_CONTRACTOR',
      signatureStatus: 'PENDING_SIGNATURE',
      envelopeId,
    });
    await seedClause(contractId, 'البند رقم (1)', 'محتوى البند الأول — التعريفات', 0);
    await seedClause(contractId, 'البند رقم (2)', 'محتوى البند الثاني — قيمة العقد', 1);
    await seedClause(contractId, 'Proposed intruder', 'guest-proposed must NOT be pinned', 2, true);

    await docusign.handleWebhook({ envelopeId, status: 'completed' });

    const row = await getContractRow(contractId);
    expect(row.signature_status).toBe('FULLY_EXECUTED');
    expect(row.status).toBe('ACTIVE');
    expect(row.executed_at).not.toBeNull();
    expect(row.pinned_at).not.toBeNull();
    expect(row.pinned_version_id).not.toBeNull();
    expect(row.pinned_content_hash).toMatch(/^[0-9a-f]{64}$/);

    const versions = await getVersions(contractId);
    expect(versions).toHaveLength(1);
    const pinned = versions[0];
    expect(pinned.id).toBe(row.pinned_version_id);
    expect(pinned.event_type).toBe('EXECUTED');
    expect(pinned.content_hash).toBe(row.pinned_content_hash);

    // The stored pinned record carries the door + the full canonical payload
    // (metadata freeze set + clauses) — sufficient to recompute the hash.
    expect(pinned.metadata.pin_door).toBe('DOCUSIGN_WEBHOOK');
    const payload = pinned.metadata.pin_payload;
    expect(payload.schema).toBe('sign.pin.v1');
    expect(payload.contract_id).toBe(contractId);
    expect(payload.metadata.name).toBe('Pin Contract');
    expect(payload.metadata.party_first_name).toBe('الهيئة القومية للأنفاق');
    expect(payload.metadata.party_second_name).toBe('شركة المقاولون العرب');
    expect(payload.metadata.contract_value).toBe('1500000.50');
    expect(payload.metadata.currency).toBe('EGP');
    expect(payload.metadata.start_date).toBe('2026-01-15');
    expect(payload.metadata.notice_period_days).toBe(28);
    // Guest-proposed clause excluded — only the 2 live clauses are frozen.
    expect(payload.clauses).toHaveLength(2);
    expect(payload.clauses[0].content).toBe('محتوى البند الأول — التعريفات');
    expect(payload.clauses[1].content).toBe('محتوى البند الثاني — قيمة العقد');
    expect(JSON.stringify(payload)).not.toContain('guest-proposed');

    // Pin audit row (door + actor + hash).
    const audits = await dataSource.query(
      `SELECT action, new_values FROM audit_logs WHERE entity_id = $1 AND action = 'contract.signed_state_pinned'`,
      [contractId],
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].new_values.door).toBe('DOCUSIGN_WEBHOOK');
    expect(audits[0].new_values.content_hash).toBe(row.pinned_content_hash);
  });

  it('⭐ (b) completed REDELIVERY is a no-op: no second snapshot, hash unchanged, exactly-once pin', async () => {
    const envelopeId = `env-${randomUUID().slice(0, 12)}`;
    const contractId = await insertContract({
      status: 'SENT_TO_CONTRACTOR',
      signatureStatus: 'PENDING_SIGNATURE',
      envelopeId,
    });
    await seedClause(contractId, 'Clause 1', 'redelivery content', 0);

    await docusign.handleWebhook({ envelopeId, status: 'completed' });
    const first = await getContractRow(contractId);

    // Redeliver the SAME completed event.
    await docusign.handleWebhook({ envelopeId, status: 'completed' });
    const second = await getContractRow(contractId);

    expect(second.pinned_version_id).toBe(first.pinned_version_id);
    expect(second.pinned_content_hash).toBe(first.pinned_content_hash);
    expect(new Date(second.pinned_at).getTime()).toBe(new Date(first.pinned_at).getTime());
    expect(await getVersions(contractId)).toHaveLength(1);

    // Exactly one pin audit row despite two deliveries.
    const audits = await dataSource.query(
      `SELECT count(*)::int n FROM audit_logs WHERE entity_id = $1 AND action = 'contract.signed_state_pinned'`,
      [contractId],
    );
    expect(audits[0].n).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────
  // (c) + (d) — Manual mark-signed door
  // ────────────────────────────────────────────────────────────────────

  it('⭐ (c) manual mark-signed produces the IDENTICAL pin outcome via the shared path', async () => {
    const contractId = await insertContract({ status: 'APPROVED' });
    await seedClause(contractId, 'Wet-sign clause 1', 'manual door content A', 0);
    await seedClause(contractId, 'Wet-sign clause 2', 'manual door content B', 1);

    const result = await pinning.markAsSigned(contractId, ownerId, orgId);
    expect(result.pinned).toBe(true);
    expect(result.content_hash).toMatch(/^[0-9a-f]{64}$/);

    const row = await getContractRow(contractId);
    expect(row.signature_status).toBe('FULLY_EXECUTED');
    expect(row.status).toBe('ACTIVE');
    expect(row.executed_at).not.toBeNull();
    expect(row.pinned_version_id).toBe(result.pinned_version_id);
    expect(row.pinned_content_hash).toBe(result.content_hash);

    const versions = await getVersions(contractId);
    expect(versions).toHaveLength(1);
    expect(versions[0].event_type).toBe('EXECUTED');
    expect(versions[0].content_hash).toBe(result.content_hash);
    expect(versions[0].metadata.pin_door).toBe('MANUAL_MARK_SIGNED');

    const audits = await dataSource.query(
      `SELECT user_id, new_values FROM audit_logs WHERE entity_id = $1 AND action = 'contract.signed_state_pinned'`,
      [contractId],
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].user_id).toBe(ownerId); // manual door records the actor
    expect(audits[0].new_values.door).toBe('MANUAL_MARK_SIGNED');
  });

  it('⭐ (d) manual mark-signed IDEMPOTENCY: already-executed → no-op, no second snapshot', async () => {
    const contractId = await insertContract({ status: 'APPROVED' });
    await seedClause(contractId, 'Idem clause', 'idempotency content', 0);

    const first = await pinning.markAsSigned(contractId, ownerId, orgId);
    const second = await pinning.markAsSigned(contractId, ownerId, orgId);

    expect(first.pinned).toBe(true);
    expect(second.pinned).toBe(false);
    expect(second.already_pinned).toBe(true);
    expect(second.pinned_version_id).toBe(first.pinned_version_id);
    expect(second.content_hash).toBe(first.content_hash);
    expect(await getVersions(contractId)).toHaveLength(1);
  });

  it('(d2) mark-signed precondition: DRAFT is rejected; cross-org probe → 404 (no existence leak)', async () => {
    const draftId = await insertContract({ status: 'DRAFT' });
    await expect(pinning.markAsSigned(draftId, ownerId, orgId)).rejects.toThrow(
      BadRequestException,
    );
    // Nothing was pinned, no version was created.
    expect(await getVersions(draftId)).toHaveLength(0);
    expect((await getContractRow(draftId)).pinned_version_id).toBeNull();

    const approvedId = await insertContract({ status: 'APPROVED' });
    await expect(
      pinning.markAsSigned(approvedId, ownerId, otherOrgId),
    ).rejects.toThrow(NotFoundException);
  });

  // ────────────────────────────────────────────────────────────────────
  // (e) — void/decline guard
  // ────────────────────────────────────────────────────────────────────

  it('⭐ (e1) voided arriving AFTER completed does NOT un-execute: the pin survives', async () => {
    const envelopeId = `env-${randomUUID().slice(0, 12)}`;
    const contractId = await insertContract({
      status: 'SENT_TO_CONTRACTOR',
      signatureStatus: 'PENDING_SIGNATURE',
      envelopeId,
    });
    await seedClause(contractId, 'Guard clause', 'void-guard content', 0);

    await docusign.handleWebhook({ envelopeId, status: 'completed' });
    const pinnedRow = await getContractRow(contractId);

    // Late / replayed voided event after execution.
    await docusign.handleWebhook({
      envelopeId,
      status: 'voided',
      voidedReason: 'replayed stale void',
    });

    const after = await getContractRow(contractId);
    expect(after.signature_status).toBe('FULLY_EXECUTED'); // NOT reverted to null
    expect(after.status).toBe('ACTIVE');
    expect(after.pinned_version_id).toBe(pinnedRow.pinned_version_id);
    expect(after.pinned_content_hash).toBe(pinnedRow.pinned_content_hash);

    // The ignore is audited, not silent.
    const ignored = await dataSource.query(
      `SELECT count(*)::int n FROM audit_logs
        WHERE entity_id = $1 AND action = 'docusign.envelope.voided.ignored_after_execution'`,
      [contractId],
    );
    expect(ignored[0].n).toBe(1);

    // Same guard for declined.
    await docusign.handleWebhook({ envelopeId, status: 'declined' });
    expect((await getContractRow(contractId)).signature_status).toBe('FULLY_EXECUTED');
  });

  it('⭐ (e2) voided on a STILL-PENDING envelope still reverts (unchanged behaviour)', async () => {
    const envelopeId = `env-${randomUUID().slice(0, 12)}`;
    const contractId = await insertContract({
      status: 'SENT_TO_CONTRACTOR',
      signatureStatus: 'PENDING_SIGNATURE',
      envelopeId,
    });

    await docusign.handleWebhook({
      envelopeId,
      status: 'voided',
      voidedReason: 'sender voided before completion',
    });

    const row = await getContractRow(contractId);
    expect(row.signature_status).toBeNull(); // reverted
    expect(row.status).toBe('ACTIVE');
    expect(row.pinned_version_id).toBeNull(); // never pinned
  });

  // ────────────────────────────────────────────────────────────────────
  // (f) — hash determinism / canonical serializer
  // ────────────────────────────────────────────────────────────────────

  it('⭐ (f) hash determinism: pinned hash equals an INDEPENDENTLY-computed canonical hash of the stored payload, and any tamper changes it', async () => {
    const contractId = await insertContract({ status: 'APPROVED' });
    await seedClause(contractId, 'Hash clause 1', 'canonical content — بند عربي', 0);
    await seedClause(contractId, 'Hash clause 2', 'second canonical clause', 1);

    const result = await pinning.markAsSigned(contractId, ownerId, orgId);

    // Read the payload BACK through Postgres jsonb (key order normalized by
    // jsonb) and recompute with the test-local canonical serializer — proving
    // the hash derives from canonical serialization, not a jsonb round-trip.
    const [version] = await dataSource.query(
      `SELECT content_hash, metadata FROM contract_versions WHERE id = $1`,
      [result.pinned_version_id],
    );
    const payload = version.metadata.pin_payload;
    expect(independentHash(payload)).toBe(version.content_hash);
    expect(version.content_hash).toBe(result.content_hash);

    // Tamper detection — BOTH clause content and metadata perturbations
    // change the recomputed hash.
    const tamperedClause = JSON.parse(JSON.stringify(payload));
    tamperedClause.clauses[0].content = 'TAMPERED clause wording';
    expect(independentHash(tamperedClause)).not.toBe(version.content_hash);

    const tamperedMeta = JSON.parse(JSON.stringify(payload));
    tamperedMeta.metadata.contract_value = '9999999.99';
    expect(independentHash(tamperedMeta)).not.toBe(version.content_hash);
  });
});
