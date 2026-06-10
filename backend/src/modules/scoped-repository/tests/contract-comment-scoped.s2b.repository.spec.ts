import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Like the S1/S2a specs, this needs a real Postgres connection (DATABASE_URL
// set): the by-id org gate is a SQL JOIN predicate that only real cross-tenant
// fixtures can prove. CI is unit-test ONLY (CLAUDE.md); a silent skip would
// read green without proving the S2b tenancy gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(contract-comment-scoped.s2b.repository.spec.ts): DATABASE_URL unset — ' +
      'these MUST run in an environment with Postgres (dev/staging). CI green ' +
      'here does NOT prove the Option B S2b ContractComment tenancy gate is verified.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { ContractCommentScopedRepository } from '../contract-comment-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — S2b: REAL-POSTGRES proof of the ContractComment scoped repository
 * (the by-id MUTATION-path chokepoint) against a live schema.
 *
 * Two orgs, each `org → user → project → contract → comment`. The probes prove:
 *   1. by-id TENANCY (led) — a comment resolves under its OWN org and is null
 *      cross-org, via the canonical comment→contract→project→org join
 *      (canonical-only: ContractComment has no denormalized org column).
 *   2. OrThrow honours the no-existence-leak convention ('Comment not found').
 *   3. The child override (`contractIdOverride`) only NARROWS to the parent
 *      contract; a mismatched/foreign override can never widen the org → null.
 *      This is the override path S2b actually wires on the mutation routes.
 *   4. COEXISTENCE — the wall (findInOrg) and the scoped load deny cross-tenant
 *      INDEPENDENTLY (both layers fire).
 */
describeReal('Option B S2b — ContractComment scoped repo (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let commentScoped: ContractCommentScopedRepository;
  let wall: ContractAccessService;

  // Fixture refs.
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // belongs to orgA
  const contractB = randomUUID(); // belongs to orgB
  const commentA = randomUUID(); // on contractA, authored by userA
  const commentB = randomUUID(); // on contractB, authored by userB

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
    commentScoped = moduleRef.get(ContractCommentScopedRepository);
    wall = moduleRef.get(ContractAccessService);

    const seedOrg = async (
      orgId: string,
      userId: string,
      projectId: string,
      contractId: string,
      commentId: string,
      tag: string,
    ) => {
      await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [
        orgId,
        `s2b-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'S2b', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `s2b-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.s2b.repo.test.xy',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `s2b-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `s2b-contract-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contract_comments (id, contract_id, user_id, content)
         VALUES ($1, $2, $3, $4)`,
        [commentId, contractId, userId, `s2b-comment-${tag}`],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, commentA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, commentB, 'b');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM contract_comments WHERE id IN ($1,$2)`, [commentA, commentB]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 1. by-id TENANCY — the lead. A comment resolves under its OWN org and is
  //    null cross-org, via the canonical comment→contract→project→org join.
  // ───────────────────────────────────────────────────────────────────────
  describe('scopedFindById tenancy (canonical comment→contract→org)', () => {
    it('in-org: scopedFindById resolves the comment via its own parent contract→org', async () => {
      const row = await commentScoped.scopedFindById(commentA, orgA);
      expect(row?.id).toBe(commentA);
    });

    it('cross-org: scopedFindById returns null (canonical resolution denies)', async () => {
      const row = await commentScoped.scopedFindById(commentA, orgB);
      expect(row).toBeNull();
    });

    it('broad probe: orgB cannot reach orgA comment and vice-versa', async () => {
      await expect(commentScoped.scopedFindById(commentB, orgA)).resolves.toBeNull();
      await expect(commentScoped.scopedFindById(commentB, orgB)).resolves.toMatchObject({
        id: commentB,
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. OrThrow — wall-matching 404 ('Comment not found'), no existence leak.
  // ───────────────────────────────────────────────────────────────────────
  describe('OrThrow no-existence-leak convention', () => {
    it('in-org: scopedFindByIdOrThrow returns the comment', async () => {
      await expect(commentScoped.scopedFindByIdOrThrow(commentA, orgA)).resolves.toMatchObject({
        id: commentA,
      });
    });

    it('cross-org: scopedFindByIdOrThrow throws NotFound("Comment not found")', async () => {
      await expect(commentScoped.scopedFindByIdOrThrow(commentA, orgB)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(commentScoped.scopedFindByIdOrThrow(commentA, orgB)).rejects.toThrow(
        'Comment not found',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. Child by-id + override — the path S2b WIRES on the mutation routes
  //    (scopedFindByIdViaContractOrThrow with contractIdOverride = URL contract).
  // ───────────────────────────────────────────────────────────────────────
  describe('child scopedFindByIdViaContract + override (the wired mutation path)', () => {
    it('auto: resolves the comment via its own parent contract→org', async () => {
      const row = await commentScoped.scopedFindByIdViaContract(commentA, orgA);
      expect(row?.id).toBe(commentA);
    });

    it('CORRECT override: pinning the comment OWN parent contract resolves the row', async () => {
      const row = await commentScoped.scopedFindByIdViaContract(commentA, orgA, {
        contractIdOverride: contractA,
      });
      expect(row?.id).toBe(commentA);
    });

    it('SAFETY: a mismatched override (foreign parent contract) cannot widen → null', async () => {
      const row = await commentScoped.scopedFindByIdViaContract(commentA, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });

    it('SAFETY: cross-org child + override toward orgB still denied for an orgA caller', async () => {
      const row = await commentScoped.scopedFindByIdViaContract(commentB, orgA, {
        contractIdOverride: contractB,
      });
      expect(row).toBeNull();
    });

    it('OrThrow + mismatched override → throws (the mutation route 404 on wrong URL contract)', async () => {
      await expect(
        commentScoped.scopedFindByIdViaContractOrThrow(commentA, orgA, {
          contractIdOverride: contractB,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('OrThrow + correct override → returns (the mutation route happy path)', async () => {
      await expect(
        commentScoped.scopedFindByIdViaContractOrThrow(commentA, orgA, {
          contractIdOverride: contractA,
        }),
      ).resolves.toMatchObject({ id: commentA });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. COEXISTENCE — the wall and the scoped load deny cross-tenant
  //    INDEPENDENTLY (both layers fire — CLAUDE.md Option B).
  // ───────────────────────────────────────────────────────────────────────
  describe('coexistence with the independent findInOrg wall', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND the scoped load is null', async () => {
      await expect(wall.findInOrg(contractB, orgA)).rejects.toBeTruthy();
      await expect(
        commentScoped.scopedFindByIdViaContract(commentB, orgA, { contractIdOverride: contractB }),
      ).resolves.toBeNull();
    });

    it('in-org: the WALL returns the contract AND the scoped load returns the comment', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      await expect(
        commentScoped.scopedFindByIdViaContract(commentA, orgA, { contractIdOverride: contractA }),
      ).resolves.toMatchObject({ id: commentA });
    });
  });
});
