import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 7.19 Slice 2 — the negotiation status lane.
 *
 * Adds `contracts.negotiation_status` — a SEPARATE, ORTHOGONAL status from the
 * lifecycle `status` (pg enum) and the signing `signature_status` (varchar).
 * Stored varchar (the SignatureStatus / RedlineStatus convention — adding a
 * value later is code-only, no ALTER TYPE):
 *
 *   DRAFT → SHARED → UNDER_REVIEW → AGREED → READY_TO_SIGN
 *
 * NOT NULL DEFAULT 'DRAFT' — the DEFAULT backfills every existing row to
 * DRAFT in the same statement (Postgres 11+ fills a non-volatile default
 * without a table rewrite), and new rows start at DRAFT.
 *
 * No index: no shipped query filters on negotiation_status alone (reads are
 * by-id through the access walls); add one WITH the first status-filtered
 * list query, not speculatively (the 2a covering-index precedent).
 *
 * Additive only. Idempotent: ADD COLUMN IF NOT EXISTS — never EXCEPTION WHEN
 * (lessons #31/#103/#111). No ALTER TYPE — no `transaction = false` needed.
 * Timestamp 1772000000002 — verified free in the SHARED dev DB migrations
 * table (lesson #276; 1771000000001 = guest-sign-slips, 1772000000001 =
 * clause_redlines).
 */
export class AddNegotiationStatus1772000000002 implements MigrationInterface {
  name = 'AddNegotiationStatus1772000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts
        ADD COLUMN IF NOT EXISTS negotiation_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts DROP COLUMN IF EXISTS negotiation_status
    `);
  }
}
