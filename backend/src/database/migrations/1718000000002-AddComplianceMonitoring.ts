import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3.4 — Compliance Monitoring
 *
 * Idempotent migration that:
 *   1. Creates 4 new tables: compliance_checks, compliance_findings,
 *      obligation_reminder_logs, compliance_report_jobs
 *   2. Extends the existing `obligations` table with compliance-aware
 *      fields (project_id, compliance_check_id, obligation_type,
 *      clause_ref, duration, timeframe_description, amount, currency,
 *      is_critical, next_reminder_date, last_reminder_sent_at,
 *      mark_met_token, mark_met_token_expires_at)
 *   3. Adds MET + WAIVED to the obligations status enum
 *   4. Backfills obligations.project_id from contracts.project_id
 *   5. Adds users.email_digest_opt_out (boolean default false)
 */
export class AddComplianceMonitoring1718000000002 implements MigrationInterface {
  name = 'AddComplianceMonitoring1718000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── Enums ───────────────────────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE compliance_overall_status_enum AS ENUM
          ('PENDING', 'COMPLIANT', 'PARTIALLY_COMPLIANT', 'NON_COMPLIANT', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE compliance_extraction_status_enum AS ENUM
          ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE compliance_finding_layer_enum AS ENUM
          ('STANDARD', 'JURISDICTION', 'PLAYBOOK', 'CONFLICT');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE compliance_finding_type_enum AS ENUM
          ('MISSING_CLAUSE', 'DEVIATION', 'CONFLICT',
           'JURISDICTION_OVERRIDE', 'PLAYBOOK_DEVIATION');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE compliance_finding_severity_enum AS ENUM
          ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE compliance_finding_status_enum AS ENUM
          ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'WAIVED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE obligation_reminder_type_enum AS ENUM
          ('DAYS_30', 'DAYS_14', 'DAYS_7', 'DAYS_1',
           'DUE_TODAY', 'OVERDUE', 'WEEKLY_DIGEST');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE obligation_reminder_email_status_enum AS ENUM
          ('SENT', 'FAILED', 'BOUNCED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE compliance_report_type_enum AS ENUM
          ('COMPLIANCE_SUMMARY', 'OBLIGATIONS_REPORT', 'JURISDICTION_CONFLICT');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE compliance_report_status_enum AS ENUM
          ('PENDING', 'RENDERING', 'EMAILED', 'FAILED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE obligation_type_enum AS ENUM (
          'NOTICE_PERIOD', 'PAYMENT', 'PERFORMANCE_BOND', 'INSURANCE',
          'MILESTONE', 'DEFECTS_LIABILITY', 'DISPUTE_RESOLUTION',
          'REPORTING', 'EMPLOYER_OBLIGATION', 'CONTRACTOR_OBLIGATION',
          'ENGINEER_OBLIGATION', 'OTHER'
        );
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // Extend existing obligation_status with MET + WAIVED.
    // NOTE: The original code here used the wrong type name `obligations_status_enum`
    // (plural with _enum suffix) instead of `obligation_status`. The silent
    // EXCEPTION WHEN undefined_object catch swallowed the failure on every existing
    // environment, leaving MET and WAIVED permanently absent. Fixed 2026-05-25.
    // This file is now correct for fresh rebuilds from scratch.
    // Existing environments are fixed by corrective migration 1748000000004.
    // ADD VALUE IF NOT EXISTS is idempotent — no catch block needed.
    await queryRunner.query(`ALTER TYPE obligation_status ADD VALUE IF NOT EXISTS 'MET'`);
    await queryRunner.query(`ALTER TYPE obligation_status ADD VALUE IF NOT EXISTS 'WAIVED'`);

    // ─── compliance_checks ───────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS compliance_checks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        project_id uuid NOT NULL REFERENCES projects(id),
        jurisdiction varchar(10),
        contract_type varchar(50),
        overall_status compliance_overall_status_enum NOT NULL DEFAULT 'PENDING',
        knowledge_assets_used jsonb,
        findings_summary jsonb,
        obligation_extraction_status compliance_extraction_status_enum NOT NULL DEFAULT 'PENDING',
        ai_job_id varchar(64),
        obligation_job_id varchar(64),
        created_by uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_compliance_checks_contract_created
       ON compliance_checks (contract_id, created_at DESC);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_compliance_checks_project_status
       ON compliance_checks (project_id, overall_status);`,
    );

    // ─── compliance_findings ────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS compliance_findings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        compliance_check_id uuid NOT NULL REFERENCES compliance_checks(id) ON DELETE CASCADE,
        layer compliance_finding_layer_enum NOT NULL,
        clause_ref varchar(100),
        finding_type compliance_finding_type_enum NOT NULL,
        severity compliance_finding_severity_enum NOT NULL,
        requirement text NOT NULL,
        actual_text text,
        recommendation text,
        knowledge_asset_ref varchar(255),
        status compliance_finding_status_enum NOT NULL DEFAULT 'OPEN',
        acknowledged_by uuid REFERENCES users(id),
        acknowledged_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_compliance_findings_check_layer
       ON compliance_findings (compliance_check_id, layer);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_compliance_findings_check_severity
       ON compliance_findings (compliance_check_id, severity, status);`,
    );

    // ─── obligation_reminder_logs ───────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS obligation_reminder_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        obligation_id uuid NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
        reminder_type obligation_reminder_type_enum NOT NULL,
        sent_to varchar(255) NOT NULL,
        sent_at timestamptz NOT NULL DEFAULT now(),
        email_status obligation_reminder_email_status_enum NOT NULL DEFAULT 'SENT'
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_obligation_reminder_logs_oblig_type
       ON obligation_reminder_logs (obligation_id, reminder_type);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_obligation_reminder_logs_sent_at
       ON obligation_reminder_logs (sent_at DESC);`,
    );

    // ─── compliance_report_jobs ─────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS compliance_report_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        compliance_check_id uuid NOT NULL REFERENCES compliance_checks(id) ON DELETE CASCADE,
        report_type compliance_report_type_enum NOT NULL,
        status compliance_report_status_enum NOT NULL DEFAULT 'PENDING',
        file_path varchar(500),
        download_token varchar(64),
        expires_at timestamptz,
        requested_by uuid REFERENCES users(id),
        emailed_at timestamptz,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_compliance_report_jobs_token
       ON compliance_report_jobs (download_token) WHERE download_token IS NOT NULL;`,
    );

    // ─── Extend obligations table ───────────────────────────────
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS project_id uuid;`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS compliance_check_id uuid;`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS obligation_type obligation_type_enum DEFAULT 'OTHER';`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS clause_ref varchar(100);`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS duration varchar(100);`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS timeframe_description text;`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS amount decimal(15,2);`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS currency varchar(3);`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS is_critical boolean NOT NULL DEFAULT false;`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS next_reminder_date date;`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz;`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS mark_met_token varchar(64);`);
    await queryRunner.query(`ALTER TABLE obligations ADD COLUMN IF NOT EXISTS mark_met_token_expires_at timestamptz;`);

    // FKs (idempotent — drop & re-add only if missing)
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE obligations
          ADD CONSTRAINT fk_obligations_project
          FOREIGN KEY (project_id) REFERENCES projects(id);
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE obligations
          ADD CONSTRAINT fk_obligations_compliance_check
          FOREIGN KEY (compliance_check_id) REFERENCES compliance_checks(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // Backfill obligations.project_id from contracts.project_id
    await queryRunner.query(`
      UPDATE obligations o
      SET project_id = c.project_id
      FROM contracts c
      WHERE o.contract_id = c.id AND o.project_id IS NULL;
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_obligations_project_status
       ON obligations (project_id, status, due_date);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_obligations_critical_due
       ON obligations (is_critical, due_date) WHERE is_critical = true;`,
    );

    // ─── users.email_digest_opt_out ─────────────────────────────
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_digest_opt_out boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Phase 3.4 rollback intentionally not implemented — the migration is
    // additive and safe to leave in place if rolled back.
  }
}
