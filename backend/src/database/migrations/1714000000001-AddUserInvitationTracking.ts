import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserInvitationTracking1714000000001 implements MigrationInterface {
  name = 'AddUserInvitationTracking1714000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // invitation_sent_at: records exactly when an admin-dispatched invitation email
    // was last sent. Used server-side to compute PENDING/EXPIRED status dynamically.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "invitation_sent_at" TIMESTAMPTZ NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "invitation_sent_at";
    `);
  }
}
