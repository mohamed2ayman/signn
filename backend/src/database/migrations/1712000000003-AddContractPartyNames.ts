import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContractPartyNames1712000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contracts"
      ADD COLUMN IF NOT EXISTS "party_first_name" varchar(500),
      ADD COLUMN IF NOT EXISTS "party_second_name" varchar(500);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "contracts"
      DROP COLUMN IF EXISTS "party_first_name",
      DROP COLUMN IF EXISTS "party_second_name";
    `);
  }
}
