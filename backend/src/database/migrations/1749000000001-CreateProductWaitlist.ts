import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6.9 — Create product_waitlist table.
 *
 * Stores email sign-ups from the MANAGEX landing page "Notify Me" forms
 * on the 5 Coming Soon product cards (VENDRIX, SPANTEC, CLAIMX, GUARDIA, DOXEN).
 *
 * Design decisions:
 * - UNIQUE(email, product_name): same email can sign up for multiple products,
 *   but submitting the same email+product twice is silently deduplicated.
 *   The unique constraint is named so it can be caught by code (error code 23505).
 * - No EXCEPTION WHEN blocks — use IF NOT EXISTS for idempotency (lessons #31, #103).
 * - No transaction = false needed — no ALTER TYPE here (lesson #109 does not apply).
 */
export class CreateProductWaitlist1749000000001 implements MigrationInterface {
  name = 'CreateProductWaitlist1749000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS product_waitlist (
        id           UUID        NOT NULL DEFAULT uuid_generate_v4(),
        email        VARCHAR(255) NOT NULL,
        product_name VARCHAR(50)  NOT NULL,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        CONSTRAINT pk_product_waitlist PRIMARY KEY (id),
        CONSTRAINT uq_product_waitlist_email_product UNIQUE (email, product_name)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_waitlist_product_name
        ON product_waitlist (product_name)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_waitlist_created_at
        ON product_waitlist (created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS product_waitlist`);
  }
}
