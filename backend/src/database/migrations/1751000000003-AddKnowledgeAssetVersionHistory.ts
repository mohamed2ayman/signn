import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKnowledgeAssetVersionHistory1751000000003
  implements MigrationInterface
{
  name = 'AddKnowledgeAssetVersionHistory1751000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Add version column to knowledge_assets ──────────────────────────
    await queryRunner.query(`
      ALTER TABLE knowledge_assets
        ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1
    `);

    // ── 2. Create knowledge_asset_versions table ───────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS knowledge_asset_versions (
        id              UUID        NOT NULL DEFAULT gen_random_uuid(),
        asset_id        UUID        NOT NULL,
        version_number  INT         NOT NULL,
        snapshot_data   JSONB       NOT NULL,
        changed_by      UUID,
        change_summary  VARCHAR(500),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_knowledge_asset_versions PRIMARY KEY (id),
        CONSTRAINT fk_kav_asset
          FOREIGN KEY (asset_id)
          REFERENCES knowledge_assets(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_kav_changed_by
          FOREIGN KEY (changed_by)
          REFERENCES users(id)
          ON DELETE SET NULL,
        CONSTRAINT uq_kav_asset_version
          UNIQUE (asset_id, version_number)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kav_asset_id
        ON knowledge_asset_versions (asset_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS knowledge_asset_versions`,
    );
    await queryRunner.query(`
      ALTER TABLE knowledge_assets
        DROP COLUMN IF EXISTS version
    `);
  }
}
