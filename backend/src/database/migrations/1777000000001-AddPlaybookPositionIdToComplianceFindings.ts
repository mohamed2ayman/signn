import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 7.22 Item 4 — finding provenance.
 *
 * Adds a nullable playbook_position_id to compliance_findings + FK →
 * playbook_positions(id) ON DELETE SET NULL. SET NULL follows the
 * knowledge_asset_ref / actor-ref precedent (lesson #233): deleting a playbook
 * position must not delete the finding, only drop the link. NULL = a
 * non-playbook finding, or a playbook finding whose echoed id was absent /
 * invalid (nulled in persistFindings before insert, so the FK never dangles).
 *
 * Additive, no backfill. Idempotent: ADD COLUMN IF NOT EXISTS + DO $$ IF NOT
 * EXISTS pg_constraint $$ for the FK (Postgres has no ADD CONSTRAINT IF NOT
 * EXISTS) + partial index — never EXCEPTION WHEN (lessons #31/#103/#111). No
 * ALTER TYPE → no transaction=false needed. down↔up verified.
 */
export class AddPlaybookPositionIdToComplianceFindings1777000000001
  implements MigrationInterface
{
  name = 'AddPlaybookPositionIdToComplianceFindings1777000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE compliance_findings
      ADD COLUMN IF NOT EXISTS "playbook_position_id" uuid NULL
    `);

    // FK → playbook_positions(id), ON DELETE SET NULL.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_compliance_findings_playbook_position'
        ) THEN
          ALTER TABLE compliance_findings
          ADD CONSTRAINT "FK_compliance_findings_playbook_position"
          FOREIGN KEY ("playbook_position_id")
          REFERENCES "playbook_positions"("id")
          ON DELETE SET NULL;
        END IF;
      END$$;
    `);

    // Partial index — only the linked rows (the column is mostly NULL).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_compliance_findings_playbook_position_id"
      ON compliance_findings ("playbook_position_id")
      WHERE "playbook_position_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_compliance_findings_playbook_position_id"
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_compliance_findings_playbook_position'
        ) THEN
          ALTER TABLE compliance_findings
          DROP CONSTRAINT "FK_compliance_findings_playbook_position";
        END IF;
      END$$;
    `);
    await queryRunner.query(`
      ALTER TABLE compliance_findings DROP COLUMN IF EXISTS "playbook_position_id"
    `);
  }
}
