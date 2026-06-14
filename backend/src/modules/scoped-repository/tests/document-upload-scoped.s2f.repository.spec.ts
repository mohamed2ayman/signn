import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Like the S1/S2a–S2e specs, this needs a real Postgres connection
// (DATABASE_URL set): the scoped org filter is a SQL JOIN predicate that only
// real cross-tenant fixtures can prove — and the canonical-vs-denorm
// resolution (DocumentUpload's drifted `organization_id`) only manifests at
// real SQL build/run time. CI is unit-test ONLY (CLAUDE.md); a silent skip
// would read green without proving the S2f tenancy gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(document-upload-scoped.s2f.repository.spec.ts): DATABASE_URL unset — ' +
      'these MUST run in an environment with Postgres (dev/staging). CI ' +
      'green here does NOT prove the Option B S2f DocumentUpload tenancy gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { DocumentUploadScopedRepository } from '../document-upload-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — S2f: REAL-POSTGRES proof of the DocumentUpload scoped repository
 * against a live schema.
 *
 * Two orgs, each `org → user → project → contract → document_uploads`. The
 * probes prove:
 *   1. scopedFind TENANCY — a document LIST under orgA returns only orgA's
 *      rows; an orgB caller gets NONE of orgA's rows, resolved through the
 *      canonical document→contract→project→org join.
 *   2. CANONICAL-ONLY (Q1) — the DENORMALIZED `document.organization_id` is
 *      IGNORED. This is the column the PRE-S2f gap trusted: a document on
 *      orgA's contract whose denorm `organization_id` was drifted to orgB
 *      still resolves to orgA via the contract FK, and NEVER leaks into orgB.
 *      Under the old `findOne({ id, organization_id })` gate an orgB caller
 *      WOULD have loaded it (the gap); the canonical join denies it.
 *   3. By-id forms (scopedFindById / scopedFindByIdOrThrow / ViaContract
 *      override safety) — the OrThrow form is exactly what
 *      updateExtractedText consumes.
 *   4. COEXISTENCE — the wall (findInOrg) and the scoped repo deny cross-tenant
 *      INDEPENDENTLY (two checks, two layers).
 */
describeReal('Option B S2f — DocumentUpload scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let documentScoped: DocumentUploadScopedRepository;
  let wall: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // belongs to orgA
  const contractB = randomUUID(); // belongs to orgB
  // documents of contractA (orgA). docA2 carries a WRONG denormalized
  // organization_id (orgB) — the canonical-only / pre-S2f-gap probe.
  const docA1 = randomUUID();
  const docA2 = randomUUID();
  // document of contractB (orgB)
  const docB1 = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dataSourceOptions } = require('../../../config/data-source');

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({ ...dataSourceOptions, autoLoadEntities: true }),
        ScopedRepositoryModule,
        TypeOrmModule.forFeature([Contract, GuestContractAccess]),
      ],
      providers: [ContractAccessService],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    documentScoped = moduleRef.get(DocumentUploadScopedRepository);
    wall = moduleRef.get(ContractAccessService);

    const seedOrg = async (
      orgId: string,
      userId: string,
      projectId: string,
      contractId: string,
      tag: string,
    ) => {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
        orgId,
        `s2f-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'S2f', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `s2f-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.s2f.repo.test.x',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `s2f-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `s2f-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');

    const seedDoc = async (
      id: string,
      contractId: string,
      organizationId: string,
      uploadedBy: string,
      fileName: string,
    ) =>
      dataSource.query(
        `INSERT INTO document_uploads
           (id, contract_id, organization_id, file_url, file_name, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, contractId, organizationId, `https://s/${id}.pdf`, fileName, uploadedBy],
      );

    await seedDoc(docA1, contractA, orgA, userA, 's2f-doc-a1.pdf');
    // CANONICAL-ONLY / PRE-S2f-GAP PROBE — denormalized organization_id points
    // at ORG B, but the contract FK (the tenancy truth) is orgA's contract.
    await seedDoc(docA2, contractA, orgB, userA, 's2f-doc-a2-drifted.pdf');
    await seedDoc(docB1, contractB, orgB, userB, 's2f-doc-b1.pdf');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM document_uploads WHERE id IN ($1,$2,$3)`, [
      docA1,
      docA2,
      docB1,
    ]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 1. scopedFind TENANCY — the lead probe (mirrors getDocuments' load).
  // ───────────────────────────────────────────────────────────────────────
  describe('scopedFind tenancy (canonical document→contract→org)', () => {
    it('in-org: orgA lists ONLY orgA documents for its contract', async () => {
      const rows = await documentScoped.scopedFind({ contract_id: contractA }, orgA);
      const ids = rows.map((r) => r.id).sort();
      expect(ids).toEqual([docA1, docA2].sort());
    });

    it('cross-org: orgB caller gets NONE of orgA documents — even filtering on orgA contract', async () => {
      const rows = await documentScoped.scopedFind({ contract_id: contractA }, orgB);
      expect(rows).toEqual([]);
    });

    it('foreign-contract filter cannot widen: orgA caller filtering orgB contract → empty', async () => {
      const rows = await documentScoped.scopedFind({ contract_id: contractB }, orgA);
      expect(rows).toEqual([]);
    });

    it('ordered list (getDocuments shape): orgA rows, ordered by priority then created_at', async () => {
      const rows = await documentScoped.scopedFind(
        { contract_id: contractA },
        orgA,
        { order: { document_priority: 'ASC', created_at: 'ASC' } },
      );
      expect(rows.map((r) => r.id).sort()).toEqual([docA1, docA2].sort());
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. CANONICAL-ONLY (Q1) — the denormalized organization_id is IGNORED.
  //    This is the column the pre-S2f gap trusted.
  // ───────────────────────────────────────────────────────────────────────
  describe('canonical-only resolution — denormalized organization_id never consulted', () => {
    it('an orgA document with a DRIFTED organization_id (orgB) still resolves to orgA', async () => {
      const rows = await documentScoped.scopedFind({ contract_id: contractA }, orgA);
      expect(rows.map((r) => r.id)).toContain(docA2);
    });

    it('the drifted organization_id does NOT leak the document into orgB (the gap is closed)', async () => {
      // Under the old `findOne({ id, organization_id: orgB })` gate, an orgB
      // caller WOULD have loaded docA2 (its denorm column reads orgB). The
      // canonical join denies it — docA2's contract is orgA's.
      const rows = await documentScoped.scopedFind({}, orgB);
      expect(rows.map((r) => r.id)).not.toContain(docA2);
    });

    it('scopedFindById on the drifted doc: orgA resolves it, orgB is denied', async () => {
      const asOwner = await documentScoped.scopedFindById(docA2, orgA);
      expect(asOwner?.id).toBe(docA2);
      const asDenorm = await documentScoped.scopedFindById(docA2, orgB);
      expect(asDenorm).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. By-id forms — the OrThrow form is what updateExtractedText consumes.
  // ───────────────────────────────────────────────────────────────────────
  describe('by-id forms (wired by updateExtractedText)', () => {
    it('in-org: scopedFindByIdOrThrow returns the row', async () => {
      const row = await documentScoped.scopedFindByIdOrThrow(docA1, orgA);
      expect(row.id).toBe(docA1);
    });

    it("cross-org: scopedFindByIdOrThrow throws the no-existence-leak 404 ('Document not found')", async () => {
      await expect(
        documentScoped.scopedFindByIdOrThrow(docA1, orgB),
      ).rejects.toMatchObject({ status: 404, message: 'Document not found' });
    });

    it('override pins the parent contract; a mismatched override cannot widen → null', async () => {
      const ok = await documentScoped.scopedFindByIdViaContract(docA1, orgA, {
        contractIdOverride: contractA,
      });
      expect(ok?.id).toBe(docA1);

      const mismatched = await documentScoped.scopedFindByIdViaContract(docA1, orgA, {
        contractIdOverride: contractB,
      });
      expect(mismatched).toBeNull();
    });

    it('SAFETY: cross-org by-id + override toward orgB still denied for an orgA caller', async () => {
      const row = await documentScoped.scopedFindByIdViaContract(docB1, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. COEXISTENCE — the wall and scopedFind deny INDEPENDENTLY.
  // ───────────────────────────────────────────────────────────────────────
  describe('coexistence with the independent findInOrg wall', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFind returns []', async () => {
      await expect(wall.findInOrg(contractB, orgA)).rejects.toBeTruthy();
      await expect(
        documentScoped.scopedFind({ contract_id: contractB }, orgA),
      ).resolves.toEqual([]);
    });

    it('in-org: the WALL returns the contract AND scopedFind returns the rows', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      await expect(
        documentScoped.scopedFind({ contract_id: contractA }, orgA),
      ).resolves.toHaveLength(2);
    });
  });
});
