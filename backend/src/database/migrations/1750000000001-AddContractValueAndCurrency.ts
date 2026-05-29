import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7.17 — Prompt 2a
 *
 * Adds the two monetary columns the Portfolio Analytics dashboard needs for
 * its "total contract value per currency" widget:
 *
 *   contract_value  NUMERIC(15, 2) NULL   (mirrors sub_contracts.contract_value)
 *   currency        VARCHAR(3)     NULL   (ISO-4217 code, app-layer regex validated)
 *
 * Both are NULL-allowed by design — existing contracts have no recorded value
 * and must NOT be backfilled (there is no source of truth for it). The pairing
 * rule "currency is required when contract_value is set" is enforced at the DTO
 * layer (CreateContractDto / UpdateContractDto), not by a DB constraint, so that
 * value-less rows stay valid and the rule can evolve without a migration.
 *
 * Idempotent: ADD COLUMN IF NOT EXISTS. Reversible and data-lossless on down().
 */
export class AddContractValueAndCurrency1750000000001
  implements MigrationInterface
{
  name = 'AddContractValueAndCurrency1750000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts
        ADD COLUMN IF NOT EXISTS contract_value NUMERIC(15, 2) NULL,
        ADD COLUMN IF NOT EXISTS currency       VARCHAR(3)     NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contracts
        DROP COLUMN IF EXISTS currency,
        DROP COLUMN IF EXISTS contract_value;
    `);
  }
}
