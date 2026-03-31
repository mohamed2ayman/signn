import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatSessionsAndMessages1711000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_sessions" (
        "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
        "contract_id" uuid NULL,
        "user_id" uuid NOT NULL,
        "org_id" uuid NOT NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "PK_chat_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_sessions_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_chat_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_sessions_org" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_messages" (
        "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
        "session_id" uuid NOT NULL,
        "contract_id" uuid NULL,
        "user_id" uuid NOT NULL,
        "org_id" uuid NOT NULL,
        "role" varchar(20) NOT NULL,
        "content" text NOT NULL,
        "citations" jsonb NULL,
        "created_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_messages_session" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_chat_sessions_user" ON "chat_sessions" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_chat_sessions_contract" ON "chat_sessions" ("contract_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_chat_messages_session" ON "chat_messages" ("session_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_sessions"`);
  }
}
