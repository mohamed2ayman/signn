import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-tier trunk — Slice T0b (parent linking).
 *
 * Adds a self-referential parent link to contracts: a child contract
 * (SUBCONTRACT / NOMINATED_SUB / … per the registry's parent_link_rule +
 * allowed_parent_types) points to its parent (currently always a MAIN). This
 * is purely ADDITIVE to FULL contracts and is ORTHOGONAL to the legacy
 * lightweight `sub_contracts` table, which T0b does NOT touch (COEXIST — the
 * REPLACE of that module is a separate future slice).
 *
 * Design (locked at T0b recon):
 *  - contracts.parent_contract_id — uuid NULL. NULL = no parent (MAIN /
 *    USUFRUCT, or an optional-parent type left unlinked). Existing rows are
 *    never backfilled.
 *  - Self-referential FK contracts.parent_contract_id → contracts.id, with
 *    ON DELETE **RESTRICT** — a parent that has children must NOT be silently
 *    orphaned; deletion is blocked at the DB. This DELIBERATELY DIFFERS from
 *    the LegalDocument.parent_law_id template (which uses SET NULL): a legal
 *    document losing its parent-law pointer is harmless, but a child contract
 *    losing its parent link would silently break the delivery-chain hierarchy.
 *  - Partial index on (parent_contract_id) WHERE parent_contract_id IS NOT NULL
 *    — only the linked rows, mirroring the legal_documents pattern (no sparse
 *    index bloat over the mostly-NULL column).
 *
 * Validation (rule / allowed_parent_types / org wall / self+cycle guards) lives
 * in ContractsService.create() at CREATE time — see that method. Parent is
 * create-time-only in v1 (deliberately absent from UpdateContractDto).
 *
 * Additive only, no backfill. Idempotent: ADD COLUMN IF NOT EXISTS +
 * DO $$ IF NOT EXISTS pg_constraint $$ for the FK (Postgres has no
 * ADD CONSTRAINT IF NOT EXISTS) + CREATE INDEX IF NOT EXISTS — never
 * EXCEPTION WHEN (lessons #31/#103/#111). No ALTER TYPE — no
 * `transaction = false` needed. down↔up verified.
 */
export class AddContractParentLinking1769000000001 implements MigrationInterface {
  name = 'AddContractParentLinking1769000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The self-referential parent column. NULL = no parent (default for MAIN /
    // USUFRUCT and any optional-parent type left unlinked).
    await queryRunner.query(`
      ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS "parent_contract_id" uuid NULL
    `);

    // Self-referential FK. ON DELETE RESTRICT — differs from the LegalDocument
    // SET NULL template ON PURPOSE (a parent with children cannot be deleted).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_contracts_parent_contract'
        ) THEN
          ALTER TABLE contracts
          ADD CONSTRAINT "FK_contracts_parent_contract"
          FOREIGN KEY ("parent_contract_id")
          REFERENCES "contracts"("id")
          ON DELETE RESTRICT;
        END IF;
      END$$;
    `);

    // Partial index — only the linked rows (the column is mostly NULL).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contracts_parent_contract_id"
      ON "contracts" ("parent_contract_id")
      WHERE "parent_contract_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_contracts_parent_contract_id"
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_contracts_parent_contract'
        ) THEN
          ALTER TABLE contracts DROP CONSTRAINT "FK_contracts_parent_contract";
        END IF;
      END$$;
    `);
    await queryRunner.query(`
      ALTER TABLE contracts DROP COLUMN IF EXISTS "parent_contract_id"
    `);
  }
}
