import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds confidence_score + source columns to knowledge_assets to support
 * the Operations Review Queue (AI-detected asset triage).
 *
 *   confidence_score : decimal(5,2) NULL — 0.00 to 100.00, AI detection confidence
 *   source           : varchar(30) NULL — e.g. 'MANUAL', 'AI_EXTRACTED', 'AI_DRAFTED'
 */
export class AddKnowledgeAssetReviewFields1715000000001
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "knowledge_assets"
        ADD COLUMN IF NOT EXISTS "confidence_score" DECIMAL(5,2) NULL,
        ADD COLUMN IF NOT EXISTS "source"           VARCHAR(30)  NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_knowledge_assets_source"
        ON "knowledge_assets" ("source")
        WHERE "source" IS NOT NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_knowledge_assets_source";`,
    );
    await queryRunner.query(`
      ALTER TABLE "knowledge_assets"
        DROP COLUMN IF EXISTS "confidence_score",
        DROP COLUMN IF EXISTS "source";
    `);
  }
}
