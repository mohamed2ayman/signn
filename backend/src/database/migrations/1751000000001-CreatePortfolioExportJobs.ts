import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 Prompt 2c — Create portfolio_export_jobs table.
 *
 * Backs the OWNER_ADMIN "Export PDF" flow on /app/portfolio:
 *   POST /portfolio-exports queues a render job → email with a token-gated
 *   download link → GET /portfolio-exports/download serves the PDF.
 *
 * Design decisions (locked at plan review):
 *   - 1h TTL (see portfolio-export.constants.ts → PORTFOLIO_EXPORT_TTL_HOURS).
 *     Both the token's signed expires_at and the cleanup cron read from that
 *     single constant — file-deletability tracks token-unreachability.
 *   - file_path stays NULL until the processor uploads via StorageService.
 *   - email is captured at request time (NOT NULL) — prevents the
 *     "user changes email between request and dispatch" race.
 *   - user_id nullable + ON DELETE SET NULL — audit row survives a user
 *     delete; download still fails because the verifier requires the
 *     payload-vs-row user_id match.
 *   - org_id NOT NULL + ON DELETE CASCADE — org deletion takes its rows.
 *   - project_id nullable + ON DELETE SET NULL — project deletion does not
 *     orphan the audit history.
 *
 * Idempotency (lessons #103, #111, Phase 7.9):
 *   - CREATE TYPE … inside DO block with pg_type IF NOT EXISTS — no
 *     EXCEPTION WHEN anywhere. The anti-pattern is the root cause #138
 *     guards against; this migration does not reintroduce it.
 *   - CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS for the rest.
 *   - down() is full reverse: DROP TABLE IF EXISTS + DROP TYPE IF EXISTS.
 */
export class CreatePortfolioExportJobs1751000000001 implements MigrationInterface {
  name = 'CreatePortfolioExportJobs1751000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'portfolio_export_status_enum'
        ) THEN
          CREATE TYPE portfolio_export_status_enum AS ENUM (
            'PENDING',
            'RUNNING',
            'COMPLETED',
            'FAILED'
          );
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS portfolio_export_jobs (
        id            UUID                          NOT NULL DEFAULT uuid_generate_v4(),
        user_id       UUID                          NULL,
        org_id        UUID                          NOT NULL,
        project_id    UUID                          NULL,
        period        VARCHAR(10)                   NOT NULL,
        status        portfolio_export_status_enum  NOT NULL DEFAULT 'PENDING',
        file_path     VARCHAR(500)                  NULL,
        email         VARCHAR(255)                  NOT NULL,
        error         TEXT                          NULL,
        expires_at    TIMESTAMPTZ                   NULL,
        created_at    TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
        completed_at  TIMESTAMPTZ                   NULL,
        file_deleted  BOOLEAN                       NOT NULL DEFAULT FALSE,
        CONSTRAINT pk_portfolio_export_jobs PRIMARY KEY (id),
        CONSTRAINT fk_portfolio_export_jobs_user
          FOREIGN KEY (user_id)    REFERENCES users (id)         ON DELETE SET NULL,
        CONSTRAINT fk_portfolio_export_jobs_org
          FOREIGN KEY (org_id)     REFERENCES organizations (id) ON DELETE CASCADE,
        CONSTRAINT fk_portfolio_export_jobs_project
          FOREIGN KEY (project_id) REFERENCES projects (id)      ON DELETE SET NULL
      )
    `);

    // Cleanup cron (Bucket 3) scans by expires_at; partial index keeps it
    // cheap by excluding rows whose file has already been swept.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_portfolio_export_jobs_expires_at
        ON portfolio_export_jobs (expires_at)
        WHERE file_deleted = FALSE
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_portfolio_export_jobs_user_id
        ON portfolio_export_jobs (user_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_portfolio_export_jobs_org_id
        ON portfolio_export_jobs (org_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_portfolio_export_jobs_status
        ON portfolio_export_jobs (status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS portfolio_export_jobs`);
    await queryRunner.query(`DROP TYPE  IF EXISTS portfolio_export_status_enum`);
  }
}
