import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';

import { Clause, ClauseReviewStatus, ClauseSource } from '../../../database/entities';
import { applyClauseTypeEdit } from '../clause-type-correction.util';

/**
 * Clause-type correction tracking (Step 2) against REAL Postgres. Proves what a
 * mocked repo cannot (lesson #140): the 3 additive columns persist, the write-shape
 * captures the AI original, a correction via a real save flips the flag + preserves
 * the snapshot, and the retrain export is org-scoped (tenant-isolated).
 */
const SKIP_REAL_PG = !process.env.DATABASE_URL;
if (SKIP_REAL_PG) {
  // eslint-disable-next-line no-console
  console.warn(
    '[clause-type-tracking] SKIPPING real-Postgres spec: DATABASE_URL unset — this ' +
      'MUST run against Postgres to prove the migration is additive, the columns ' +
      'persist, and the export is org-scoped. CI green here does NOT prove it.',
  );
}
const describeReal = SKIP_REAL_PG ? describe.skip : describe;

describeReal('clause-type correction tracking (real Postgres)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let clauses: Repository<Clause>;

  const orgA = randomUUID();
  const orgB = randomUUID();

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
    clauses = dataSource.getRepository(Clause);
    await dataSource.query(`INSERT INTO organizations (id, name) VALUES ($1,$2),($3,$4)`, [
      orgA, `ctt-A-${orgA.slice(0, 8)}`, orgB, `ctt-B-${orgB.slice(0, 8)}`,
    ]);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM clauses WHERE organization_id = ANY($1)`, [[orgA, orgB]]);
      await dataSource.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgA, orgB]]);
    }
    await moduleRef?.close();
  });

  // Simulate writeClausesInTx's AI write (inline provider): clause_type = AI label,
  // original_ai_clause_type = same, source recorded, edit flag false.
  const writeAiClause = (org: string, type: string) =>
    clauses.save(
      clauses.create({
        organization_id: org,
        title: 'seed',
        content: `clause of type ${type}`,
        clause_type: type,
        original_ai_clause_type: type,
        clause_type_source: 'sonnet-inline',
        is_type_edited_by_user: false,
        source: ClauseSource.AI_EXTRACTED,
        review_status: ClauseReviewStatus.PENDING_REVIEW,
      }),
    );

  it('write-shape: the 3 tracking columns persist through a real save', async () => {
    const saved = await writeAiClause(orgA, 'general');
    const row = await clauses.findOneByOrFail({ id: saved.id });
    expect(row.original_ai_clause_type).toBe('general');
    expect(row.clause_type_source).toBe('sonnet-inline');
    expect(row.is_type_edited_by_user).toBe(false);
    expect(row.clause_type).toBe('general'); // inline = byte-unchanged
  });

  it('a real correction flips the flag + preserves the AI original (queryable pair)', async () => {
    const saved = await writeAiClause(orgA, 'general');
    const clause = await clauses.findOneByOrFail({ id: saved.id });
    applyClauseTypeEdit(clause, 'payment'); // human corrects general -> payment
    await clauses.save(clause);

    const row = await clauses.findOneByOrFail({ id: saved.id });
    expect(row.clause_type).toBe('payment'); // human label
    expect(row.original_ai_clause_type).toBe('general'); // AI label preserved
    expect(row.is_type_edited_by_user).toBe(true);
  });

  it('a no-op edit does NOT flip the flag (through a real save)', async () => {
    const saved = await writeAiClause(orgA, 'time');
    const clause = await clauses.findOneByOrFail({ id: saved.id });
    applyClauseTypeEdit(clause, 'time'); // same value
    await clauses.save(clause);
    const row = await clauses.findOneByOrFail({ id: saved.id });
    expect(row.is_type_edited_by_user).toBe(false);
  });

  it('the retrain export query is ORG-SCOPED (tenant-isolated)', async () => {
    // org B also has a corrected clause; the org-A export must NOT return it.
    const bSaved = await writeAiClause(orgB, 'general');
    const bClause = await clauses.findOneByOrFail({ id: bSaved.id });
    applyClauseTypeEdit(bClause, 'liability');
    await clauses.save(bClause);

    const exportRows = await dataSource.query(
      `SELECT id, clause_type, original_ai_clause_type, clause_type_source
         FROM clauses
        WHERE organization_id = $1 AND is_type_edited_by_user = true`,
      [orgA],
    );
    // every returned row is a real org-A correction with the AI vs human pair
    expect(exportRows.length).toBeGreaterThanOrEqual(1);
    for (const r of exportRows) {
      expect(r.original_ai_clause_type).toBeTruthy();
      expect(r.clause_type).not.toBe(r.original_ai_clause_type);
    }
    // org B's corrected clause is NOT in org A's export
    expect(exportRows.some((r: { id: string }) => r.id === bSaved.id)).toBe(false);
  });
});
