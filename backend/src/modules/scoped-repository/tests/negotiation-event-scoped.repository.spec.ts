import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

// ─── CI-skip guard (LOUD) ─────────────────────────────────────────────────
// Like the S1/S2a-S2f scoped specs, this needs a real Postgres connection
// (DATABASE_URL set): the scoped org filter is a SQL JOIN predicate that only
// real cross-tenant fixtures can prove. CI is unit-test ONLY (CLAUDE.md); a
// silent skip would read green without proving the negotiation tenancy gate.
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[scoped-repository] SKIPPING real-Postgres specs ' +
      '(negotiation-event-scoped.repository.spec.ts): DATABASE_URL unset — ' +
      'these MUST run in an environment with Postgres (dev/staging). CI green ' +
      'here does NOT prove the Option B negotiation tenancy gate.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

import { Contract, GuestContractAccess } from '../../../database/entities';
import { ScopedRepositoryModule } from '../scoped-repository.module';
import { NegotiationEventScopedRepository } from '../negotiation-event-scoped.repository';
import { ContractAccessService } from '../../contracts/services/contract-access.service';

/**
 * Option B — Chokepoint migration (negotiation, 1 of 4): REAL-POSTGRES proof of
 * the NegotiationEvent scoped repository against a live schema.
 *
 * Two orgs, each `org → user → project → contract → negotiation_events`. The
 * probes prove:
 *   1. scopedFindAndCount TENANCY — a history LIST under orgA returns only
 *      orgA's rows AND a total that counts only orgA's rows; an orgB caller gets
 *      NONE of orgA's rows (and total 0), resolved through the canonical
 *      event→contract→project→org join.
 *   2. PAGINATION + COUNT — take/skip page the rows while `total` stays the full
 *      org-scoped count BEFORE pagination (the gate bounds the count too).
 *   3. clause_ref FILTER — the optional second allowlisted key narrows correctly,
 *      still org-bounded.
 *   4. RELATION HYDRATION coexists with the org gate — `relations: ['performer']`
 *      (what findHistory requests) hydrates without colliding with the gate join.
 *   5. By-id — the faithful base contract (negotiation has no by-id caller today,
 *      but the gate must still deny cross-tenant by-id with the no-leak 404).
 *   6. COEXISTENCE — the independent wall (here exercised via findInOrg, the
 *      generic primitive that enforces the SAME gate as the inline
 *      assertContractInOrg) and the scoped path deny cross-tenant INDEPENDENTLY.
 *
 * NO DRIFT PROBE: unlike Notice/Claim/SubContract, NegotiationEvent carries NO
 * denormalized org column — there is no drift surface to test. The `contract_id`
 * FK is the sole tenancy truth and the canonical join is the only resolution
 * path.
 */
describeReal('Option B chokepoint — NegotiationEvent scoped repository (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let negotiationScoped: NegotiationEventScopedRepository;
  let wall: ContractAccessService;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const contractA = randomUUID(); // belongs to orgA
  const contractB = randomUUID(); // belongs to orgB
  // 3 events on contractA (orgA): A1/A2 on clause CL-1, A3 on clause CL-2,
  // with ascending created_at so DESC order is [A3, A2, A1].
  const eventA1 = randomUUID();
  const eventA2 = randomUUID();
  const eventA3 = randomUUID();
  // 1 event on contractB (orgB).
  const eventB1 = randomUUID();

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
    negotiationScoped = moduleRef.get(NegotiationEventScopedRepository);
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
        `neg-${tag}-${orgId.slice(0, 8)}`,
      ]);
      await dataSource.query(
        `INSERT INTO users (
           id, email, password_hash, first_name, last_name, role, account_type,
           is_active, is_email_verified, mfa_enabled, preferred_language,
           failed_login_attempts, onboarding_completed, onboarding_level,
           email_digest_opt_out, marketing_email_opt_in, ai_training_opt_in,
           organization_id
         )
         VALUES ($1, $2, $3, 'Neg', 'RepoTest', 'OWNER_ADMIN', 'MANAGING',
                 TRUE, TRUE, FALSE, 'en', 0, TRUE, 'none', FALSE, FALSE, FALSE, $4)`,
        [
          userId,
          `neg-${tag}-${userId.slice(0, 8)}@test.local`,
          '$2a$10$dummy.bcrypt.hash.placeholder.value.for.neg.repo.test.xx',
          orgId,
        ],
      );
      await dataSource.query(
        `INSERT INTO projects (id, organization_id, name, created_by) VALUES ($1, $2, $3, $4)`,
        [projectId, orgId, `neg-project-${tag}`, userId],
      );
      await dataSource.query(
        `INSERT INTO contracts (id, project_id, name, contract_type, created_by)
         VALUES ($1, $2, $3, 'FIDIC_RED_BOOK', $4)`,
        [contractId, projectId, `neg-contract-${tag}`, userId],
      );
    };

    await seedOrg(orgA, userA, projectA, contractA, 'a');
    await seedOrg(orgB, userB, projectB, contractB, 'b');

    const seedEvent = async (
      id: string,
      contractId: string,
      performedBy: string,
      clauseRef: string,
      createdAt: string,
    ) =>
      dataSource.query(
        `INSERT INTO negotiation_events
           (id, contract_id, clause_ref, event_type, performed_by, source, created_at)
         VALUES ($1, $2, $3, 'CLAUSE_FLAGGED', $4, 'WEB_APP', $5)`,
        [id, contractId, clauseRef, performedBy, createdAt],
      );

    await seedEvent(eventA1, contractA, userA, 'CL-1', '2026-01-01T00:00:00Z');
    await seedEvent(eventA2, contractA, userA, 'CL-1', '2026-01-02T00:00:00Z');
    await seedEvent(eventA3, contractA, userA, 'CL-2', '2026-01-03T00:00:00Z');
    await seedEvent(eventB1, contractB, userB, 'CL-1', '2026-01-01T00:00:00Z');
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM negotiation_events WHERE id IN ($1,$2,$3,$4)`, [
      eventA1,
      eventA2,
      eventA3,
      eventB1,
    ]);
    await dataSource.query(`DELETE FROM contracts WHERE id IN ($1,$2)`, [contractA, contractB]);
    await dataSource.query(`DELETE FROM projects WHERE id IN ($1,$2)`, [projectA, projectB]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1,$2)`, [userA, userB]);
    await dataSource.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
    await moduleRef.close();
  });

  // 1. scopedFindAndCount TENANCY — the lead probe (the wired findHistory path).
  describe('scopedFindAndCount tenancy (canonical event→contract→org)', () => {
    it('in-org: orgA lists ONLY orgA events for its contract, with the org-scoped total', async () => {
      const [rows, total] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractA },
        orgA,
      );
      expect(rows.map((r) => r.id).sort()).toEqual([eventA1, eventA2, eventA3].sort());
      expect(total).toBe(3);
    });

    it('cross-org: orgB caller gets NONE of orgA events — even filtering orgA contract (total 0)', async () => {
      const [rows, total] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractA },
        orgB,
      );
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });

    it('foreign-contract filter cannot widen: orgA caller filtering orgB contract → empty', async () => {
      const [rows, total] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractB },
        orgA,
      );
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });

    it('broad list is org-scoped: orgA list contains orgA events but NEVER orgB events', async () => {
      const [rows, total] = await negotiationScoped.scopedFindAndCount({}, orgA);
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([eventA1, eventA2, eventA3]));
      expect(ids).not.toContain(eventB1);
      expect(total).toBe(3);
    });
  });

  // 2. PAGINATION + COUNT — total stays the pre-pagination org-scoped count.
  describe('pagination + count (take/skip page the rows; total is the full org count)', () => {
    it('order DESC + take:2/skip:0 → first page [A3, A2], total still 3', async () => {
      const [rows, total] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractA },
        orgA,
        { order: { created_at: 'DESC' }, take: 2, skip: 0 },
      );
      expect(rows.map((r) => r.id)).toEqual([eventA3, eventA2]);
      expect(total).toBe(3);
    });

    it('order DESC + take:2/skip:2 → second page [A1], total still 3', async () => {
      const [rows, total] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractA },
        orgA,
        { order: { created_at: 'DESC' }, take: 2, skip: 2 },
      );
      expect(rows.map((r) => r.id)).toEqual([eventA1]);
      expect(total).toBe(3);
    });
  });

  // 3. clause_ref FILTER — the optional second allowlisted key narrows correctly.
  describe('clause_ref filter (second allowlisted key)', () => {
    it('orgA + clause CL-1 → only A1/A2, total 2', async () => {
      const [rows, total] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractA, clause_ref: 'CL-1' },
        orgA,
      );
      expect(rows.map((r) => r.id).sort()).toEqual([eventA1, eventA2].sort());
      expect(total).toBe(2);
    });

    it('cross-org + clause CL-1 still empty (gate beats the filter)', async () => {
      const [rows, total] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractA, clause_ref: 'CL-1' },
        orgB,
      );
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });
  });

  // 4. RELATION HYDRATION — the exact shape findHistory uses.
  describe("relations: ['performer'] — gate join and hydration coexist", () => {
    it('hydrates event.performer for in-org rows', async () => {
      const [rows] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractA },
        orgA,
        { relations: ['performer'], order: { created_at: 'DESC' } },
      );
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.performer).toBeDefined();
        expect(row.performer!.id).toBe(userA);
      }
    });

    it('cross-org with relations is still empty (gate unaffected by hydration)', async () => {
      const [rows, total] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractA },
        orgB,
        { relations: ['performer'] },
      );
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    });
  });

  // 5. By-id — the faithful base contract (no negotiation caller today).
  describe('by-id (faithful base contract; no-existence-leak gate)', () => {
    it('in-org: scopedFindById returns the row', async () => {
      const row = await negotiationScoped.scopedFindById(eventA1, orgA);
      expect(row?.id).toBe(eventA1);
    });

    it('cross-org: scopedFindById returns null (no leak)', async () => {
      const row = await negotiationScoped.scopedFindById(eventA1, orgB);
      expect(row).toBeNull();
    });

    it("cross-org: scopedFindByIdOrThrow throws the no-existence-leak 404 ('Negotiation event not found')", async () => {
      await expect(
        negotiationScoped.scopedFindByIdOrThrow(eventA1, orgB),
      ).rejects.toMatchObject({ status: 404, message: 'Negotiation event not found' });
    });
  });

  // 6. COEXISTENCE — the wall and the scoped path deny INDEPENDENTLY.
  describe('coexistence with the independent contract-access wall', () => {
    it('cross-tenant: the WALL 404s on the parent contract AND scopedFindAndCount returns [[], 0]', async () => {
      await expect(wall.findInOrg(contractB, orgA)).rejects.toBeTruthy();
      await expect(
        negotiationScoped.scopedFindAndCount({ contract_id: contractB }, orgA),
      ).resolves.toEqual([[], 0]);
    });

    it('in-org: the WALL returns the contract AND scopedFindAndCount returns the rows', async () => {
      await expect(wall.findInOrg(contractA, orgA)).resolves.toMatchObject({ id: contractA });
      const [rows, total] = await negotiationScoped.scopedFindAndCount(
        { contract_id: contractA },
        orgA,
      );
      expect(rows).toHaveLength(3);
      expect(total).toBe(3);
    });
  });
});
