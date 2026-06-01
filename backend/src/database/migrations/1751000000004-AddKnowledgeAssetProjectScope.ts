import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.24e — Project Scoping for Knowledge Assets
 *
 * Adds a nullable `project_id` FK to `knowledge_assets` so assets can be
 * scoped to a specific project (narrower than org-wide).
 *
 * Three-tier visibility after this migration:
 *   - Platform assets:  organization_id IS NULL  AND project_id IS NULL
 *   - Org assets:       organization_id = :orgId AND project_id IS NULL
 *   - Project assets:   organization_id = :orgId AND project_id = :projectId
 *
 * No EXCEPTION WHEN blocks (lessons #31, #103, #111).
 */
export class AddKnowledgeAssetProjectScope1751000000004
  implements MigrationInterface
{
  name = 'AddKnowledgeAssetProjectScope1751000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE knowledge_assets
        ADD COLUMN IF NOT EXISTS project_id UUID
          REFERENCES projects(id) ON DELETE SET NULL
    `);
    // Index to support the project_id = :projectId filter efficiently.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_assets_project_id
        ON knowledge_assets (project_id)
        WHERE project_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_knowledge_assets_project_id`,
    );
    await queryRunner.query(
      `ALTER TABLE knowledge_assets DROP COLUMN IF EXISTS project_id`,
    );
  }
}
