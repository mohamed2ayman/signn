import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.28 — ERP Integration (Part 1: backend + endpoints).
 *
 * Neutral, vendor-agnostic data model:
 *   erp_connections    — per-org connection config (encrypted credentials)
 *   erp_field_mappings — per-connection ERP-field → SIGN-neutral-field config
 *   erp_sync_jobs      — one row per sync run (status-guarded state machine)
 *   erp_cost_records   — neutral imported actual-cost rows (READ-SOURCE for
 *                        claims/variation analysis; never overwrites claims)
 * plus an additive nullable obligations.external_activity_ref (schedule
 * linkage — stores a REFERENCE only).
 *
 * `vendor` is a plain VARCHAR validated against the connector registry, NOT a DB
 * enum — adding a future adapter must not need a migration (locked decision 1).
 * The closed sets that belong to the CORE (direction / domain / job + connection
 * status) ARE enums, `_enum`-suffixed per lesson #143.
 *
 * Idempotency: every block uses `IF NOT EXISTS` guards, NO `EXCEPTION WHEN`
 * swallowing (lessons #31/#103/#111). PK + created_at/updated_at carry DB
 * defaults so the engine's raw INSERTs (which omit those columns) work.
 */
export class AddErpIntegration1757000000001 implements MigrationInterface {
  name = 'AddErpIntegration1757000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── 1. Core closed-set enums ─────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'erp_connection_status_enum') THEN
          CREATE TYPE erp_connection_status_enum AS ENUM (
            'configured', 'active', 'error', 'disabled'
          );
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'erp_sync_direction_enum') THEN
          CREATE TYPE erp_sync_direction_enum AS ENUM ('import', 'export');
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'erp_sync_domain_enum') THEN
          CREATE TYPE erp_sync_domain_enum AS ENUM (
            'cost', 'schedule', 'milestones', 'payment_terms'
          );
        END IF;
      END $$
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'erp_sync_job_status_enum') THEN
          CREATE TYPE erp_sync_job_status_enum AS ENUM (
            'pending', 'running', 'success', 'partial', 'failed'
          );
        END IF;
      END $$
    `);

    // ─── 2. erp_connections ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS erp_connections (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id       UUID NOT NULL
          REFERENCES organizations(id) ON DELETE CASCADE,
        vendor                VARCHAR(50) NOT NULL,
        name                  VARCHAR(255) NOT NULL,
        base_url              VARCHAR(500) NULL,
        credentials_encrypted TEXT NULL,
        capabilities_snapshot JSONB NULL,
        enabled               BOOLEAN NOT NULL DEFAULT TRUE,
        status                erp_connection_status_enum NOT NULL DEFAULT 'configured',
        last_sync_at          TIMESTAMPTZ NULL,
        error_message         TEXT NULL,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_connections_org
        ON erp_connections (organization_id)
    `);

    // ─── 3. erp_field_mappings ────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS erp_field_mappings (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id UUID NOT NULL
          REFERENCES erp_connections(id) ON DELETE CASCADE,
        source_field  VARCHAR(255) NOT NULL,
        target_field  VARCHAR(255) NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_field_mappings_connection
        ON erp_field_mappings (connection_id)
    `);

    // ─── 4. erp_sync_jobs ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS erp_sync_jobs (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id     UUID NOT NULL
          REFERENCES erp_connections(id) ON DELETE CASCADE,
        organization_id   UUID NOT NULL,
        direction         erp_sync_direction_enum NOT NULL,
        domain            erp_sync_domain_enum NOT NULL,
        status            erp_sync_job_status_enum NOT NULL DEFAULT 'pending',
        idempotency_key   VARCHAR(128) NOT NULL,
        records_processed INTEGER NOT NULL DEFAULT 0,
        records_imported  INTEGER NOT NULL DEFAULT 0,
        records_failed    INTEGER NOT NULL DEFAULT 0,
        error             TEXT NULL,
        started_at        TIMESTAMPTZ NULL,
        finished_at       TIMESTAMPTZ NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_erp_sync_jobs_connection_idem
          UNIQUE (connection_id, idempotency_key)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_sync_jobs_connection
        ON erp_sync_jobs (connection_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_sync_jobs_org
        ON erp_sync_jobs (organization_id)
    `);

    // ─── 5. erp_cost_records ──────────────────────────────────────────────
    // Idempotent upsert anchor: UNIQUE(connection_id, external_ref).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS erp_cost_records (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL
          REFERENCES organizations(id) ON DELETE CASCADE,
        connection_id   UUID NOT NULL
          REFERENCES erp_connections(id) ON DELETE CASCADE,
        sync_job_id     UUID NULL
          REFERENCES erp_sync_jobs(id) ON DELETE SET NULL,
        external_ref    VARCHAR(255) NOT NULL,
        cost_code       VARCHAR(100) NOT NULL,
        wbs_ref         VARCHAR(255) NULL,
        period          VARCHAR(50) NULL,
        amount          NUMERIC(15,2) NOT NULL,
        currency        VARCHAR(3) NOT NULL,
        description     TEXT NULL,
        contract_id     UUID NULL
          REFERENCES contracts(id) ON DELETE SET NULL,
        project_id      UUID NULL
          REFERENCES projects(id) ON DELETE SET NULL,
        imported_at     TIMESTAMPTZ NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_erp_cost_records_connection_extref
          UNIQUE (connection_id, external_ref)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_cost_records_org
        ON erp_cost_records (organization_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_erp_cost_records_connection
        ON erp_cost_records (connection_id)
    `);

    // ─── 6. obligations.external_activity_ref (schedule linkage) ───────────
    await queryRunner.query(`
      ALTER TABLE obligations
        ADD COLUMN IF NOT EXISTS external_activity_ref VARCHAR(255) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE obligations DROP COLUMN IF EXISTS external_activity_ref
    `);

    // Drop tables in reverse FK order.
    await queryRunner.query(`DROP TABLE IF EXISTS erp_cost_records`);
    await queryRunner.query(`DROP TABLE IF EXISTS erp_sync_jobs`);
    await queryRunner.query(`DROP TABLE IF EXISTS erp_field_mappings`);
    await queryRunner.query(`DROP TABLE IF EXISTS erp_connections`);

    // Drop enums last.
    await queryRunner.query(`DROP TYPE IF EXISTS erp_sync_job_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS erp_sync_domain_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS erp_sync_direction_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS erp_connection_status_enum`);
  }
}
