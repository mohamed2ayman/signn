import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserOnboarding1711000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "onboarding_completed" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "onboarding_level" varchar(20) NOT NULL DEFAULT 'none'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "onboarding_level"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "onboarding_completed"`);
  }
}
