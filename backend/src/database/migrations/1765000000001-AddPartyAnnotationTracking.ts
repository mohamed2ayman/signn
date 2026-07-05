import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Party annotation tracking — permanent product feature.
 *
 * Additive-only. Adds AI-original capture + a human-edited flag to `contracts`
 * so a human correction/swap of the First/Second party preserves the ORIGINAL
 * AI-extracted party names (original-vs-corrected), mirroring the risk
 * annotation's `original_*` / `is_edited_by_user` columns.
 *
 * SAFETY: every column is `IF NOT EXISTS`; there is NO backfill / UPDATE — every
 * existing contract row is untouched (`is_parties_edited_by_user` defaults false;
 * `original_party_*` stay NULL). No `ALTER TYPE`, so no `transaction = false`.
 */
export class AddPartyAnnotationTracking1765000000001
  implements MigrationInterface
{
  name = 'AddPartyAnnotationTracking1765000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contracts"
        ADD COLUMN IF NOT EXISTS "original_party_first_name"  VARCHAR(500) NULL,
        ADD COLUMN IF NOT EXISTS "original_party_second_name" VARCHAR(500) NULL,
        ADD COLUMN IF NOT EXISTS "is_parties_edited_by_user"  BOOLEAN NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contracts"
        DROP COLUMN IF EXISTS "original_party_first_name",
        DROP COLUMN IF EXISTS "original_party_second_name",
        DROP COLUMN IF EXISTS "is_parties_edited_by_user"
    `);
  }
}
