import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRBACPermissionLevels1711000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add job_title column to users table
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "job_title" varchar(100) NULL
    `);

    // Add permission_level column to project_members table
    await queryRunner.query(`
      ALTER TABLE "project_members"
      ADD COLUMN IF NOT EXISTS "permission_level" varchar(20) NULL
    `);

    // Create permission_defaults table for admin-configurable defaults
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "permission_defaults" (
        "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
        "job_title" varchar(100) NOT NULL UNIQUE,
        "permission_level" varchar(20) NOT NULL,
        "updated_at" timestamptz DEFAULT now() NOT NULL,
        CONSTRAINT "PK_permission_defaults" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "permission_defaults"`);
    await queryRunner.query(`ALTER TABLE "project_members" DROP COLUMN IF EXISTS "permission_level"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "job_title"`);
  }
}
