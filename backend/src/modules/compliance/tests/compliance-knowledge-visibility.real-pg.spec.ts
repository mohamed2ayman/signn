import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

import { KnowledgeAsset } from '../../../database/entities';
import { ComplianceKnowledgeService } from '../services/compliance-knowledge.service';

/**
 * Knowledge-asset visibility SQL — operator-precedence regression guard.
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * `queryByTags` / `queryByJurisdictionAndTags` build their org/project
 * visibility tier with a RAW-STRING `andWhere()` containing a top-level `OR`.
 * TypeORM (0.3.28 here) only wraps a raw-string condition in parentheses when
 * the `isolateWhereStatements` DataSource option is enabled — it is not set
 * anywhere in this repo — so the string is concatenated verbatim:
 *
 *   WHERE review_status IN (...) AND tags @> ... AND (org IS NULL AND proj IS NULL)
 *      OR (org = :orgId AND proj IS NULL)
 *      OR (org = :orgId AND proj = :projectId)
 *
 * SQL binds AND tighter than OR, so the org-scoped branches become TOP-LEVEL
 * disjuncts and escape the review_status and tag filters entirely. The effect
 * is a WITHIN-TENANT filter bypass: `:orgId` stays bound in every branch, so no
 * other organisation's rows are reachable, but the caller's own unapproved /
 * wrong-tagged assets are returned and fed to the compliance AI.
 *
 * The existing compliance-knowledge specs mock the repository at the
 * QueryBuilder seam, so they are structurally incapable of catching this — the
 * SQL is never executed. Hence a real-Postgres spec (lesson #140).
 *
 * RED→GREEN: against the pre-fix grouping the four "must NOT appear"
 * assertions fail (the poison rows come back). With the outer parens added they
 * pass, and the "must still appear" assertions confirm the fix did not
 * over-restrict.
 *
 * COVERAGE — all five raw-string OR sites are reached through `buildContext`:
 *   1. queryByTags 3-tier + projectId          (standard bucket, projectId set)
 *   2. queryByTags 2-tier, no projectId        (standard bucket, projectId null)
 *   3. queryByTags orgOnly + projectId         (playbook bucket)
 *   4. queryByJurisdictionAndTags 3-tier       (jurisdiction bucket, projectId set)
 *   5. queryByJurisdictionAndTags 2-tier       (jurisdiction bucket, projectId null)
 */

// Real-Postgres bootstrap (TypeOrmModule.forRoot + entity graph) exceeds
// Jest's 5s default; matches the convention in the guest-* real-pg specs.
jest.setTimeout(120_000);

const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[compliance-knowledge-visibility] SKIPPING real-Postgres spec: DATABASE_URL ' +
      'unset. This spec MUST run against Postgres — the bug it guards is in the ' +
      'generated SQL, which a mocked repository never executes. CI green here ' +
      'does NOT prove the grouping is correct.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

describeReal('compliance knowledge visibility — OR grouping (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let knowledge: ComplianceKnowledgeService;

  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const ownerId = randomUUID();
  const projectId = randomUUID();

  // ── Assets that MUST be selected ────────────────────────────────
  const PLATFORM_OK = randomUUID(); // platform, approved, right tag
  const ORG_OK = randomUUID(); // org-wide, approved, right tag
  const ORG_PROJ_OK = randomUUID(); // project-scoped, approved, right tag
  const JUR_OK = randomUUID(); // org-wide, approved, jurisdiction + law tag

  // ── Poison: same org, but fails an ANDed filter. The un-grouped SQL
  //    returns these because the org branch escapes the AND chain. ──
  const ORG_BAD_STATUS = randomUUID(); // right tag, PENDING_REVIEW
  const ORG_BAD_TAG = randomUUID(); // approved, irrelevant tag
  const ORG_PROJ_BAD = randomUUID(); // project-scoped, PENDING_REVIEW + playbook tag
  const JUR_BAD_TAG = randomUUID(); // approved, right jurisdiction, irrelevant tag

  // ── Control: a different org entirely. Must never appear either way
  //    (proves this is a within-tenant bypass, not a cross-org leak). ──
  const OTHER_ORG_ASSET = randomUUID();

  const ALL_IDS = [
    PLATFORM_OK,
    ORG_OK,
    ORG_PROJ_OK,
    JUR_OK,
    ORG_BAD_STATUS,
    ORG_BAD_TAG,
    ORG_PROJ_BAD,
    JUR_BAD_TAG,
    OTHER_ORG_ASSET,
  ];

  const seedAsset = async (a: {
    id: string;
    organization_id: string | null;
    project_id: string | null;
    review_status: string;
    tags: string[];
    jurisdiction?: string | null;
  }) =>
    dataSource.query(
      `INSERT INTO knowledge_assets
         (id, organization_id, project_id, title, description, asset_type,
          review_status, jurisdiction, tags)
       VALUES ($1,$2,$3,$4,$5,'KNOWLEDGE',$6,$7,$8::jsonb)`,
      [
        a.id,
        a.organization_id,
        a.project_id,
        `or-grouping-${a.id.slice(0, 8)}`,
        `body-${a.id.slice(0, 8)}`,
        a.review_status,
        a.jurisdiction ?? null,
        JSON.stringify(a.tags),
      ],
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

    // Real asset repository (the SUT is its SQL); the playbook resolver is
    // stubbed — structured positions are a different channel and are proven
    // in playbook-resolver.real-pg.spec.ts.
    knowledge = new ComplianceKnowledgeService(
      dataSource.getRepository(KnowledgeAsset),
      { resolveEffectivePositions: async () => [] } as any,
    );

    for (const [id, name] of [
      [orgId, 'or-grouping-org'],
      [otherOrgId, 'or-grouping-other-org'],
    ] as const) {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2)`, [
        id,
        `${name}-${id.slice(0, 8)}`,
      ]);
    }

    await dataSource.query(
      `INSERT INTO users (
         id, email, password_hash, first_name, last_name, role, account_type,
         organization_id, is_active, is_email_verified, mfa_enabled,
         preferred_language, failed_login_attempts, onboarding_completed,
         onboarding_level, email_digest_opt_out, marketing_email_opt_in,
         ai_training_opt_in
       ) VALUES ($1,$2,$3,'OrGrouping','Test','OWNER_ADMIN','MANAGING',$4,
                 TRUE,TRUE,FALSE,'en',0,TRUE,'none',FALSE,FALSE,FALSE)`,
      [
        ownerId,
        `or-grouping-${ownerId.slice(0, 8)}@test.local`,
        '$2a$10$dummy.hash.or.grouping.test',
        orgId,
      ],
    );

    await dataSource.query(
      `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1,$2,'or-grouping-project',$3)`,
      [projectId, orgId, ownerId],
    );

    // ── must be selected ──
    await seedAsset({
      id: PLATFORM_OK,
      organization_id: null,
      project_id: null,
      review_status: 'APPROVED',
      tags: ['type:STANDARD'],
    });
    await seedAsset({
      id: ORG_OK,
      organization_id: orgId,
      project_id: null,
      review_status: 'APPROVED',
      tags: ['type:STANDARD'],
    });
    await seedAsset({
      id: ORG_PROJ_OK,
      organization_id: orgId,
      project_id: projectId,
      review_status: 'AUTO_APPROVED',
      tags: ['type:STANDARD'],
    });
    await seedAsset({
      id: JUR_OK,
      organization_id: orgId,
      project_id: null,
      review_status: 'APPROVED',
      jurisdiction: 'EG',
      tags: ['type:MANDATORY_LAW'],
    });

    // ── poison ──
    await seedAsset({
      id: ORG_BAD_STATUS,
      organization_id: orgId,
      project_id: null,
      review_status: 'PENDING_REVIEW',
      tags: ['type:STANDARD'],
    });
    await seedAsset({
      id: ORG_BAD_TAG,
      organization_id: orgId,
      project_id: null,
      review_status: 'APPROVED',
      tags: ['type:TOTALLY_IRRELEVANT'],
    });
    await seedAsset({
      id: ORG_PROJ_BAD,
      organization_id: orgId,
      project_id: projectId,
      review_status: 'PENDING_REVIEW',
      tags: ['type:PLAYBOOK'],
    });
    await seedAsset({
      id: JUR_BAD_TAG,
      organization_id: orgId,
      project_id: null,
      review_status: 'APPROVED',
      jurisdiction: 'EG',
      tags: ['type:TOTALLY_IRRELEVANT'],
    });

    // ── control ──
    await seedAsset({
      id: OTHER_ORG_ASSET,
      organization_id: otherOrgId,
      project_id: null,
      review_status: 'APPROVED',
      tags: ['type:STANDARD'],
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM knowledge_assets WHERE id = ANY($1::uuid[])`, [ALL_IDS]);
      await dataSource.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
      await dataSource.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [
        [orgId, otherOrgId],
      ]);
    }
    await moduleRef?.close();
  });

  it('3-tier + project scope: unapproved / wrong-tagged org assets are EXCLUDED, valid tiers kept', async () => {
    const ctx = await knowledge.buildContext({
      orgId,
      jurisdiction: 'EG',
      contractType: null,
      projectId,
    });
    const ids = ctx.asset_ids;

    // The bug returned every org-owned row here regardless of status/tags.
    expect(ids).not.toContain(ORG_BAD_STATUS);
    expect(ids).not.toContain(ORG_BAD_TAG);
    expect(ids).not.toContain(ORG_PROJ_BAD);
    expect(ids).not.toContain(JUR_BAD_TAG);

    // ...without over-restricting the legitimate three tiers.
    expect(ids).toContain(PLATFORM_OK);
    expect(ids).toContain(ORG_OK);
    expect(ids).toContain(ORG_PROJ_OK);
    expect(ids).toContain(JUR_OK);
  });

  it('2-tier (no projectId): org-wide poison EXCLUDED, project-scoped assets not visible', async () => {
    const ctx = await knowledge.buildContext({
      orgId,
      jurisdiction: 'EG',
      contractType: null,
      projectId: null,
    });
    const ids = ctx.asset_ids;

    expect(ids).not.toContain(ORG_BAD_STATUS);
    expect(ids).not.toContain(ORG_BAD_TAG);
    expect(ids).not.toContain(JUR_BAD_TAG);

    // Two-tier means project-scoped rows are out of scope by design.
    expect(ids).not.toContain(ORG_PROJ_OK);
    expect(ids).not.toContain(ORG_PROJ_BAD);

    expect(ids).toContain(PLATFORM_OK);
    expect(ids).toContain(ORG_OK);
    expect(ids).toContain(JUR_OK);
  });

  it('no other organisation is reachable in either grouping (within-tenant bypass, not a leak)', async () => {
    for (const projectScope of [projectId, null]) {
      const ctx = await knowledge.buildContext({
        orgId,
        jurisdiction: 'EG',
        contractType: null,
        projectId: projectScope,
      });
      expect(ctx.asset_ids).not.toContain(OTHER_ORG_ASSET);
    }
  });

  it('platform-only context (no orgId) returns platform assets and no org-owned rows', async () => {
    const ctx = await knowledge.buildContext({
      orgId: null,
      jurisdiction: 'EG',
      contractType: null,
      projectId: null,
    });
    const ids = ctx.asset_ids;

    expect(ids).toContain(PLATFORM_OK);
    for (const owned of [
      ORG_OK,
      ORG_PROJ_OK,
      JUR_OK,
      ORG_BAD_STATUS,
      ORG_BAD_TAG,
      ORG_PROJ_BAD,
      JUR_BAD_TAG,
      OTHER_ORG_ASSET,
    ]) {
      expect(ids).not.toContain(owned);
    }
  });
});
