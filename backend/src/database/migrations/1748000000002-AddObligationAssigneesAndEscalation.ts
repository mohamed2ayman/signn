import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.1 — Obligation Tracking & Deadline Alerts
 *
 * 1. Creates `obligation_assignees` — a join table linking obligations to the
 *    specific users responsible for completing them. Supports multiple assignees
 *    per obligation (M:N without extra columns on obligations).
 *
 *    Columns:
 *      id            UUID PK
 *      obligation_id UUID NOT NULL FK → obligations(id) ON DELETE CASCADE
 *      user_id       UUID NOT NULL FK → users(id) ON DELETE CASCADE
 *      assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
 *      assigned_by   UUID nullable FK → users(id)
 *
 *    Constraints:
 *      UNIQUE (obligation_id, user_id) — one assignee row per user per obligation
 *      INDEX on obligation_id — fast lookup of all assignees for an obligation
 *      INDEX on user_id — fast lookup of all obligations assigned to a user
 *
 * 2. Adds two escalation-contact columns to `contracts`:
 *      escalation_contact_user_id UUID nullable FK → users(id)
 *      escalation_contact_email   VARCHAR(255) nullable
 *
 *    Only one of the two should be set at a time (enforced at DTO level).
 *
 * Idempotent — uses CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
 * / CREATE UNIQUE INDEX IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
 */
export class AddObligationAssigneesAndEscalation1748000000002 implements MigrationInterface {
  name = 'AddObligationAssigneesAndEscalation1748000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. obligation_assignees table ─────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS obligation_assignees (
        id            UUID        NOT NULL DEFAULT uuid_generate_v4(),
        obligation_id UUID        NOT NULL,
        user_id       UUID        NOT NULL,
        assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        assigned_by   UUID        NULL,

        CONSTRAINT pk_obligation_assignees PRIMARY KEY (id),

        CONSTRAINT fk_obligation_assignees_obligation
          FOREIGN KEY (obligation_id)
          REFERENCES obligations (id)
          ON DELETE CASCADE,

        CONSTRAINT fk_obligation_assignees_user
          FOREIGN KEY (user_id)
          REFERENCES users (id)
          ON DELETE CASCADE,

        CONSTRAINT fk_obligation_assignees_assigned_by
          FOREIGN KEY (assigned_by)
          REFERENCES users (id)
          ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_obligation_assignees_obligation_user
      ON obligation_assignees (obligation_id, user_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_obligation_assignees_obligation_id
      ON obligation_assignees (obligation_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_obligation_assignees_user_id
      ON obligation_assignees (user_id);
    `);

    // ── 2. Escalation contact columns on contracts ────────────────────────
    await queryRunner.query(`
      ALTER TABLE contracts
        ADD COLUMN IF NOT EXISTS escalation_contact_user_id UUID         NULL,
        ADD COLUMN IF NOT EXISTS escalation_contact_email   VARCHAR(255) NULL;
    `);

    // ADD CONSTRAINT IF NOT EXISTS is not valid PostgreSQL syntax.
    // Use a DO block to check pg_constraint before adding.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_contracts_escalation_user'
        ) THEN
          ALTER TABLE contracts
            ADD CONSTRAINT fk_contracts_escalation_user
              FOREIGN KEY (escalation_contact_user_id)
              REFERENCES users (id)
              ON DELETE SET NULL;
        END IF;
      END$$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop escalation FK and columns from contracts
    await queryRunner.query(`
      ALTER TABLE contracts
        DROP CONSTRAINT IF EXISTS fk_contracts_escalation_user,
        DROP COLUMN IF EXISTS escalation_contact_email,
        DROP COLUMN IF EXISTS escalation_contact_user_id;
    `);

    // Drop obligation_assignees
    await queryRunner.query(`DROP INDEX IF EXISTS idx_obligation_assignees_user_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_obligation_assignees_obligation_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_obligation_assignees_obligation_user`);
    await queryRunner.query(`DROP TABLE IF EXISTS obligation_assignees`);
  }
}
