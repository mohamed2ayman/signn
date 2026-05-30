import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bull';
import { PortfolioExportCleanupProcessor } from './portfolio-export-cleanup.processor';
import { StorageService } from '../../storage/storage.service';
import { PortfolioExportJob } from '../entities/portfolio-export-job.entity';

/**
 * Phase 7.17 Prompt 2c Bucket 3 — cleanup processor unit tests.
 *
 * The CRITICAL test here is the query-shape assertion: the WHERE clause
 * MUST include `j.file_deleted = FALSE` (carry-forward from Bucket 1
 * review). The partial index
 *   idx_portfolio_export_jobs_expires_at
 *     ON portfolio_export_jobs (expires_at)
 *     WHERE file_deleted = FALSE
 * only matches a query whose WHERE predicate carries the SAME
 * `file_deleted = FALSE` clause. Drop it and the planner falls back to
 * seq scan — the #134/#135 index-shape-mismatch trap.
 *
 * EXPLAIN against representative data is a separate verification step
 * run against the live DB (see Bucket 3 commit body) — these unit tests
 * assert the query shape at compile/run time so a refactor that drops
 * the predicate is caught in CI, not at production scale.
 */

function makeRow(overrides: Partial<PortfolioExportJob> = {}): PortfolioExportJob {
  const row = new PortfolioExportJob();
  row.id = 'row-' + Math.floor(Math.random() * 1e9);
  row.user_id = 'user-id';
  row.org_id = 'org-id';
  row.project_id = null;
  row.period = '90d';
  row.status = 'COMPLETED' as any;
  row.file_path = `http://localhost:3000/uploads/portfolio-exports/${row.id}.pdf`;
  row.email = 'user@example.com';
  row.error = null;
  row.expires_at = new Date(Date.now() - 60_000);
  row.created_at = new Date();
  row.completed_at = new Date();
  row.file_deleted = false;
  return Object.assign(row, overrides);
}

interface QueryBuilderRecorder {
  whereClauses: string[];
  orderByCol: string | null;
  limitValue: number | null;
  selectFields: string[];
}

function makeQueryBuilder(rows: PortfolioExportJob[], recorder: QueryBuilderRecorder) {
  const qb: any = {
    where(clause: string) {
      recorder.whereClauses.push(clause);
      return qb;
    },
    andWhere(clause: string) {
      recorder.whereClauses.push(clause);
      return qb;
    },
    orderBy(col: string, _dir: 'ASC' | 'DESC') {
      recorder.orderByCol = col;
      return qb;
    },
    limit(n: number) {
      recorder.limitValue = n;
      return qb;
    },
    select(fields: string[]) {
      recorder.selectFields = fields;
      return qb;
    },
    async getMany() {
      return rows;
    },
  };
  return qb;
}

interface Mocks {
  createQB: jest.Mock;
  recorder: QueryBuilderRecorder;
  updateMock: jest.Mock;
  deleteFile: jest.Mock;
}

async function makeProcessor(input: {
  rows?: PortfolioExportJob[];
  deleteThrows?: boolean;
} = {}): Promise<{ processor: PortfolioExportCleanupProcessor; m: Mocks }> {
  const rows = input.rows ?? [];
  const recorder: QueryBuilderRecorder = {
    whereClauses: [],
    orderByCol: null,
    limitValue: null,
    selectFields: [],
  };
  const createQB = jest.fn(() => makeQueryBuilder(rows, recorder));
  const updateMock = jest.fn().mockResolvedValue({ affected: 1 });
  const deleteFile = input.deleteThrows
    ? jest.fn().mockRejectedValue(new Error('storage offline'))
    : jest.fn().mockResolvedValue(undefined);

  const moduleRef = await Test.createTestingModule({
    providers: [
      PortfolioExportCleanupProcessor,
      {
        provide: getRepositoryToken(PortfolioExportJob),
        useValue: {
          createQueryBuilder: createQB,
          update: updateMock,
        },
      },
      {
        provide: StorageService,
        useValue: { deleteFile },
      },
    ],
  }).compile();

  return {
    processor: moduleRef.get(PortfolioExportCleanupProcessor),
    m: { createQB, recorder, updateMock, deleteFile },
  };
}

function makeJob(): Job<Record<string, never>> {
  return { data: {} } as any;
}

describe('PortfolioExportCleanupProcessor', () => {
  describe('query shape MUST include `j.file_deleted = FALSE` (carry-forward — match the partial index)', () => {
    it('builds a query with WHERE expires_at < NOW() AND file_deleted = FALSE', async () => {
      const { processor, m } = await makeProcessor({ rows: [] });

      await processor.handleCleanupExpired(makeJob());

      // First WHERE: expires_at filter
      expect(m.recorder.whereClauses).toContain('j.expires_at < NOW()');
      // Second WHERE: the partial-index-matching predicate. WITHOUT this
      // the partial index is not used and the planner falls back to
      // seq scan (#134/#135). This test makes the property a tested
      // invariant.
      expect(m.recorder.whereClauses).toContain('j.file_deleted = FALSE');
    });

    it('orders by expires_at ASC (oldest first) and batches', async () => {
      const { processor, m } = await makeProcessor({ rows: [] });

      await processor.handleCleanupExpired(makeJob());

      expect(m.recorder.orderByCol).toBe('j.expires_at');
      expect(m.recorder.limitValue).toBeGreaterThan(0);
    });

    it('selects only id + file_path (no need to hydrate other columns for cleanup)', async () => {
      const { processor, m } = await makeProcessor({ rows: [] });

      await processor.handleCleanupExpired(makeJob());

      expect(m.recorder.selectFields).toEqual(['j.id', 'j.file_path']);
    });
  });

  describe('happy path', () => {
    it('deletes each file via StorageService, then marks file_deleted=true on each row', async () => {
      const r1 = makeRow();
      const r2 = makeRow();
      const r3 = makeRow();
      const { processor, m } = await makeProcessor({ rows: [r1, r2, r3] });

      await processor.handleCleanupExpired(makeJob());

      expect(m.deleteFile).toHaveBeenCalledTimes(3);
      expect(m.deleteFile).toHaveBeenCalledWith(r1.file_path);
      expect(m.deleteFile).toHaveBeenCalledWith(r2.file_path);
      expect(m.deleteFile).toHaveBeenCalledWith(r3.file_path);

      // Each row gets a file_deleted=true update.
      expect(m.updateMock).toHaveBeenCalledTimes(3);
      expect(m.updateMock).toHaveBeenCalledWith(r1.id, { file_deleted: true });
      expect(m.updateMock).toHaveBeenCalledWith(r2.id, { file_deleted: true });
      expect(m.updateMock).toHaveBeenCalledWith(r3.id, { file_deleted: true });
    });

    it('skips storage.deleteFile when file_path is null but still marks file_deleted', async () => {
      const row = makeRow({ file_path: null });
      const { processor, m } = await makeProcessor({ rows: [row] });

      await processor.handleCleanupExpired(makeJob());

      expect(m.deleteFile).not.toHaveBeenCalled();
      expect(m.updateMock).toHaveBeenCalledWith(row.id, { file_deleted: true });
    });
  });

  describe('empty result', () => {
    it('no-ops cleanly when there are no expired files', async () => {
      const { processor, m } = await makeProcessor({ rows: [] });

      await processor.handleCleanupExpired(makeJob());

      expect(m.deleteFile).not.toHaveBeenCalled();
      expect(m.updateMock).not.toHaveBeenCalled();
    });
  });

  describe('storage failure resilience', () => {
    it('still marks file_deleted=true on the row even when deleteFile throws', async () => {
      // The property: a row gets dropped from the partial index even if
      // the storage cleanup itself failed. Without this, a transient
      // storage failure would leave the row in the active index forever,
      // causing the cleanup cron to re-scan it on every 30-min tick.
      const row = makeRow();
      const { processor, m } = await makeProcessor({
        rows: [row],
        deleteThrows: true,
      });

      await processor.handleCleanupExpired(makeJob());

      // deleteFile was attempted
      expect(m.deleteFile).toHaveBeenCalledTimes(1);
      // Even though it threw, the row was still updated.
      expect(m.updateMock).toHaveBeenCalledWith(row.id, { file_deleted: true });
    });

    it('continues processing remaining rows after one storage failure', async () => {
      const r1 = makeRow();
      const r2 = makeRow();
      const r3 = makeRow();
      const { processor, m } = await makeProcessor({
        rows: [r1, r2, r3],
        deleteThrows: true,
      });

      await processor.handleCleanupExpired(makeJob());

      // All 3 rows attempted (the loop didn't bail on the first failure).
      expect(m.deleteFile).toHaveBeenCalledTimes(3);
      expect(m.updateMock).toHaveBeenCalledTimes(3);
    });
  });
});
