import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnowledgeAssetProcessingFields1714000000002
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "knowledge_assets"
        ADD COLUMN IF NOT EXISTS "file_hash"          VARCHAR(64)  NULL,
        ADD COLUMN IF NOT EXISTS "ocr_status"         VARCHAR(50)  NOT NULL DEFAULT 'PENDING',
        ADD COLUMN IF NOT EXISTS "detected_languages" JSONB        NULL;
    `);

    // Index for fast duplicate detection by hash
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_knowledge_assets_file_hash"
        ON "knowledge_assets" ("file_hash")
        WHERE "file_hash" IS NOT NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_knowledge_assets_file_hash";`,
    );
    await queryRunner.query(`
      ALTER TABLE "knowledge_assets"
        DROP COLUMN IF EXISTS "file_hash",
        DROP COLUMN IF EXISTS "ocr_status",
        DROP COLUMN IF EXISTS "detected_languages";
    `);
  }
}
