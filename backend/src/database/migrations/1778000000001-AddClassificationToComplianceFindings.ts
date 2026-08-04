import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 7.22 Item 2 — per-finding PLAYBOOK deviation classification.
 *
 * Adds a nullable `classification` (MINOR | MAJOR | NON_STANDARD) to
 * compliance_findings — set ONLY on PLAYBOOK-layer findings (MINOR/MAJOR when the
 * finding references a structured position; NON_STANDARD when no position covers
 * the clause type). A DB CHECK enforces the PLAYBOOK-only invariant so a
 * classification can never attach to a legal-layer finding, independent of app code.
 *
 * Additive, no backfill. Idempotent: guarded CREATE TYPE (DO $$ IF NOT EXISTS
 * pg_type $$ — never EXCEPTION WHEN, lessons #31/#103/#111) + ADD COLUMN IF NOT
 * EXISTS + guarded ADD CONSTRAINT (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
 * CREATE TYPE (not ALTER TYPE ADD VALUE) → no transaction=false needed. down↔up verified.
 */
export class AddClassificationToComplianceFindings1778000000001
  implements MigrationInterface
{
  name = 'AddClassificationToComplianceFindings1778000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type
          WHERE typname = 'compliance_finding_classification_enum'
        ) THEN
          CREATE TYPE "compliance_finding_classification_enum" AS ENUM
            ('MINOR', 'MAJOR', 'NON_STANDARD');
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      ALTER TABLE compliance_findings
      ADD COLUMN IF NOT EXISTS "classification"
        "compliance_finding_classification_enum" NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chk_classification_playbook_only'
        ) THEN
          ALTER TABLE compliance_findings
          ADD CONSTRAINT "chk_classification_playbook_only"
          CHECK (
            classification IS NULL
            OR layer = 'PLAYBOOK'::"compliance_finding_layer_enum"
          );
        END IF;
      END$$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chk_classification_playbook_only'
        ) THEN
          ALTER TABLE compliance_findings
          DROP CONSTRAINT "chk_classification_playbook_only";
        END IF;
      END$$;
    `);
    await queryRunner.query(`
      ALTER TABLE compliance_findings DROP COLUMN IF EXISTS "classification"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "compliance_finding_classification_enum"
    `);
  }
}
