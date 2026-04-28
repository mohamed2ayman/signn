import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Live Chat Support — adds 5 tables to power real-time human-to-human
 * support chat between users and the operations team:
 *
 *   - support_chats           : chat lifecycle row (WAITING -> ACTIVE -> CLOSED)
 *   - support_chat_messages   : transcript (user / ops / system messages)
 *   - support_chat_notes      : ops-only internal notes per chat
 *   - canned_responses        : ops shortcuts (e.g. /refund -> body)
 *   - ops_availability        : per-ops ONLINE / AWAY / OFFLINE flag
 *
 * The existing `support_tickets.category` column is a varchar(50) (no Postgres
 * enum), so allowing the new `live_chat` value requires no schema change here
 * — it's enforced at the DTO level instead.
 */
export class AddLiveChatSupport1717000000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // -------------------------------------------------------------------- chats
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_chats" (
        "id"                   UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id"              UUID         NOT NULL,
        "organization_id"      UUID         NULL,
        "status"               VARCHAR(20)  NOT NULL DEFAULT 'WAITING',
        "topic"                VARCHAR(500) NOT NULL,
        "assigned_ops_id"      UUID         NULL,
        "previous_ops_id"      UUID         NULL,
        "closed_by"            UUID         NULL,
        "closed_reason"        VARCHAR(50)  NULL,
        "csat_rating"          SMALLINT     NULL,
        "csat_comment"         TEXT         NULL,
        "converted_ticket_id"  UUID         NULL,
        "queued_at"            TIMESTAMPTZ  NULL,
        "assigned_at"          TIMESTAMPTZ  NULL,
        "closed_at"            TIMESTAMPTZ  NULL,
        "created_at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_support_chats_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_support_chats_org"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_support_chats_assigned_ops"
          FOREIGN KEY ("assigned_ops_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_support_chats_ticket"
          FOREIGN KEY ("converted_ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL,
        CONSTRAINT "ck_support_chats_status"
          CHECK ("status" IN ('WAITING', 'ACTIVE', 'TRANSFERRED', 'CLOSED')),
        CONSTRAINT "ck_support_chats_csat_rating"
          CHECK ("csat_rating" IS NULL OR ("csat_rating" >= 1 AND "csat_rating" <= 5))
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_chats_status_created"
        ON "support_chats" ("status", "created_at");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_chats_assigned_status"
        ON "support_chats" ("assigned_ops_id", "status");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_chats_org_status"
        ON "support_chats" ("organization_id", "status");
    `);

    // ----------------------------------------------------------------- messages
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_chat_messages" (
        "id"               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "chat_id"          UUID         NOT NULL,
        "sender_id"        UUID         NULL,
        "sender_role"      VARCHAR(20)  NOT NULL,
        "body"             TEXT         NOT NULL DEFAULT '',
        "attachment_url"   VARCHAR(1000) NULL,
        "attachment_name"  VARCHAR(500) NULL,
        "attachment_mime"  VARCHAR(200) NULL,
        "attachment_size"  INTEGER      NULL,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_support_chat_messages_chat"
          FOREIGN KEY ("chat_id") REFERENCES "support_chats"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_support_chat_messages_sender"
          FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "ck_support_chat_messages_sender_role"
          CHECK ("sender_role" IN ('USER', 'OPS', 'SYSTEM'))
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_chat_messages_chat_created"
        ON "support_chat_messages" ("chat_id", "created_at");
    `);

    // -------------------------------------------------------------------- notes
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_chat_notes" (
        "id"          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "chat_id"     UUID         NOT NULL,
        "ops_id"      UUID         NOT NULL,
        "body"        TEXT         NOT NULL,
        "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_support_chat_notes_chat"
          FOREIGN KEY ("chat_id") REFERENCES "support_chats"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_support_chat_notes_ops"
          FOREIGN KEY ("ops_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_support_chat_notes_chat_created"
        ON "support_chat_notes" ("chat_id", "created_at");
    `);

    // -------------------------------------------------------- canned responses
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "canned_responses" (
        "id"               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
        "organization_id"  UUID         NULL,
        "shortcut"         VARCHAR(64)  NOT NULL,
        "title"            VARCHAR(200) NOT NULL,
        "body"             TEXT         NOT NULL,
        "created_by"       UUID         NOT NULL,
        "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_canned_responses_org"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_canned_responses_creator"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);
    // Partial unique indexes — Postgres treats NULL as distinct in regular
    // unique constraints, so we split global vs org-scoped uniqueness.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_canned_responses_global_shortcut"
        ON "canned_responses" ("shortcut")
        WHERE "organization_id" IS NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_canned_responses_org_shortcut"
        ON "canned_responses" ("organization_id", "shortcut")
        WHERE "organization_id" IS NOT NULL;
    `);

    // ------------------------------------------------------------ ops availability
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ops_availability" (
        "ops_id"            UUID         PRIMARY KEY,
        "status"            VARCHAR(20)  NOT NULL DEFAULT 'OFFLINE',
        "last_changed_at"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "fk_ops_availability_ops"
          FOREIGN KEY ("ops_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "ck_ops_availability_status"
          CHECK ("status" IN ('ONLINE', 'AWAY', 'OFFLINE'))
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ops_availability";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_canned_responses_org_shortcut";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_canned_responses_global_shortcut";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "canned_responses";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_chat_notes_chat_created";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "support_chat_notes";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_chat_messages_chat_created";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "support_chat_messages";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_chats_org_status";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_chats_assigned_status";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_support_chats_status_created";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "support_chats";`);
  }
}
