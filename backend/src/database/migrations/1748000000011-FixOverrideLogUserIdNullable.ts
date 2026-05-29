import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 — Prompt 1, B.5 (Migration 2 of 2).
 *
 * State-aware corrective migration for `risk_analysis_override_log.user_id`.
 *
 * ── The drift ───────────────────────────────────────────────────────────
 * The S.4 migration (`CreateRiskAnalysisOverrideLog1748000000008`) is
 * recorded as run in the `migrations` table. A later S.* correction edited
 * the file on disk to make `user_id` nullable with `ON DELETE SET NULL` —
 * but an already-run migration does NOT re-apply when its file changes.
 * Result:
 *   - Fresh environments (migrate from scratch) get the CORRECT schema.
 *   - Already-migrated environments are stuck with the WRONG live schema:
 *       user_id = NOT NULL  and  fk_..._user = NO ACTION.
 * That blocks user-deletion for any user with override-log rows and makes
 * the GDPR-friendly SET-NULL path (and B.5's "deleted user" null-display)
 * unreachable. Same class of bug as lessons #103 / #109.
 *
 * ── The fix ─────────────────────────────────────────────────────────────
 * Both steps are guarded so this migration is idempotent in BOTH
 * directions: a no-op on a fresh DB that's already correct, a fix on an
 * existing DB that's wrong. Safe to run on every environment.
 */
export class FixOverrideLogUserIdNullable1748000000011
  implements MigrationInterface
{
  name = 'FixOverrideLogUserIdNullable1748000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Step 1: DROP NOT NULL on user_id — ONLY if it's currently NOT
    //    NULL. On a fresh DB (corrected 1748000000008 already ran) the
    //    column is already nullable → the guard skips → no-op.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_attribute
          WHERE attrelid = 'risk_analysis_override_log'::regclass
            AND attname  = 'user_id'
            AND attnotnull = true
            AND attnum > 0
            AND NOT attisdropped
        ) THEN
          ALTER TABLE risk_analysis_override_log
            ALTER COLUMN user_id DROP NOT NULL;
        END IF;
      END$$;
    `);

    // ── Step 2: fix the FK delete rule to SET NULL — ONLY if it's not
    //    already SET NULL. confdeltype codes: a=NO ACTION, r=RESTRICT,
    //    c=CASCADE, n=SET NULL, d=SET DEFAULT.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'fk_risk_analysis_override_log_user'
            AND confdeltype <> 'n'
        ) THEN
          ALTER TABLE risk_analysis_override_log
            DROP CONSTRAINT fk_risk_analysis_override_log_user;
          ALTER TABLE risk_analysis_override_log
            ADD CONSTRAINT fk_risk_analysis_override_log_user
              FOREIGN KEY (user_id)
              REFERENCES users (id)
              ON DELETE SET NULL;
        END IF;
      END$$;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op intentional. Reverting this corrective migration would
    // re-introduce the NOT NULL + NO ACTION drift — the exact bug it
    // fixes. Worse, if any user has been deleted since the fix (user_id
    // now NULL on those rows), restoring NOT NULL would fail on existing
    // NULL data. Same no-op-down precedent as
    // 1748000000004-FixObligationStatusEnum.
  }
}
