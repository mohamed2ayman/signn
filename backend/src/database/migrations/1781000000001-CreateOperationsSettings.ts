import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * S3/AWS-readiness follow-up — move the ops-review AI confidence threshold off
 * an on-disk JSON file into the database.
 *
 * The old path (operations-review.service.ts) persisted the single threshold to
 * path.resolve(__dirname, '../../config/operations-config.json'). On ECS that
 * breaks twice: ephemeral disk loses the value on every redeploy (silently
 * reverting to the 90 default), and multiple replicas each keep their own disk
 * copy so the value diverges depending on load-balancer routing. Some ECS images
 * also run a read-only filesystem, where the write simply throws.
 *
 * `operations_settings` is a singleton table mirroring `security_policies`
 * (id='global', one seeded row) — the DB is now the single source of truth.
 *
 * Idempotent: CREATE TABLE IF NOT EXISTS + seed via INSERT ... ON CONFLICT DO
 * NOTHING (the security_policies recipe; no EXCEPTION WHEN blocks).
 */
export class CreateOperationsSettings1781000000001
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "operations_settings" (
        "id"                   VARCHAR(20) PRIMARY KEY,
        "confidence_threshold" INTEGER     NOT NULL DEFAULT 90,
        "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Seed singleton row (idempotent)
    await queryRunner.query(`
      INSERT INTO "operations_settings" ("id") VALUES ('global')
        ON CONFLICT ("id") DO NOTHING;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "operations_settings";`);
  }
}
