import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.27 — async chat: per-message status + job tracking.
 *
 * Chat moves from synchronous (backend holds the HTTP connection open while
 * polling the AI job ~30s) to asynchronous (sendMessage returns immediately
 * with a PENDING assistant message; the frontend polls GET
 * /chat/messages/:id/status which advances the row when the AI job finishes).
 *
 * Columns added to chat_messages:
 *   - status         : lifecycle (PENDING/PROCESSING/COMPLETED/FAILED). varchar
 *                      mirrors the existing `role` column (app-level enum, no
 *                      PG enum type — avoids the ALTER TYPE friction of #143).
 *                      Default 'COMPLETED' so every existing row + every USER
 *                      message is terminal with no backfill needed.
 *   - job_id         : the ai-backend Celery job id for the assistant turn.
 *   - error_message  : populated when status = FAILED.
 * And `content` becomes nullable so the placeholder assistant row can exist
 * before the AI response arrives.
 */
export class AddChatMessageAsyncStatus1755000000005 implements MigrationInterface {
  name = 'AddChatMessageAsyncStatus1755000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
        ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'COMPLETED';
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
        ADD COLUMN IF NOT EXISTS "job_id" VARCHAR(255) NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
        ADD COLUMN IF NOT EXISTS "error_message" TEXT NULL;
    `);
    // Placeholder assistant rows are created before content exists.
    await queryRunner.query(`
      ALTER TABLE "chat_messages" ALTER COLUMN "content" DROP NOT NULL;
    `);
    // Index for the advancer to find in-flight messages quickly.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_chat_messages_status"
        ON "chat_messages" ("status")
        WHERE "status" IN ('PENDING', 'PROCESSING');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chat_messages_status"`);
    // Restore NOT NULL: blank any null content first so the constraint holds.
    await queryRunner.query(`
      UPDATE "chat_messages" SET "content" = '' WHERE "content" IS NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_messages" ALTER COLUMN "content" SET NOT NULL;
    `);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "error_message"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "job_id"`);
    await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "status"`);
  }
}
