import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Phase 7.18 — schema-assert for the guest portal spine.
 *
 * Mirrors the obligation-schema-check pattern. Verifies on bootstrap that
 * BOTH buckets 1a and 1b-i ran to completion:
 *
 *   Bucket 1a (authorization spine):
 *     1. user_role                  contains 'GUEST'
 *     2. users_account_type_enum    exists with MANAGING / GUEST / FREE
 *     3. guest_contract_access      table exists
 *
 *   Bucket 1b-i (invitations + pre-password viewer):
 *     4. guest_invitations_status_enum contains PENDING / ACCEPTED / REVOKED / EXPIRED
 *     5. guest_invitations          table exists
 *
 * NOTE — the `role` column's enum type is named `user_role` (singular,
 * no `_enum` suffix) because InitialSchema (1710000000000) created it
 * BEFORE the lesson #143 TypeORM-convention `<table>_<column>_enum` was
 * settled on. All NEW enum types (account_type, guest_invitations_status)
 * follow the modern `<table>_<column>_enum` name.
 *
 * Motivation: lessons #31 / #103 / #111 (silent EXCEPTION WHEN swallowing)
 * and #143 (TypeORM enum-naming). Any future migration regression that
 * disables guest auth is caught immediately at startup instead of becoming
 * a runtime security bug.
 */
@Injectable()
export class GuestPortalSchemaCheckService implements OnModuleInit {
  private readonly logger = new Logger(GuestPortalSchemaCheckService.name);

  private readonly REQUIRED_ROLE_VALUES = ['GUEST'] as const;
  private readonly REQUIRED_ACCOUNT_TYPE_VALUES = [
    'MANAGING',
    'GUEST',
    'FREE',
  ] as const;
  private readonly REQUIRED_INVITATION_STATUS_VALUES = [
    'PENDING',
    'ACCEPTED',
    'REVOKED',
    'EXPIRED',
  ] as const;

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      // 1. user_role has GUEST (NOT users_role_enum — see header note)
      const roleValues = await this.fetchEnumValues('user_role');
      const missingRoles = this.REQUIRED_ROLE_VALUES.filter(
        (v) => !roleValues.has(v),
      );

      // 2. users_account_type_enum exists with MANAGING / GUEST / FREE
      const accountTypeValues = await this.fetchEnumValues(
        'users_account_type_enum',
      );
      const missingAccountTypes = this.REQUIRED_ACCOUNT_TYPE_VALUES.filter(
        (v) => !accountTypeValues.has(v),
      );

      // 3. guest_contract_access table exists
      const guestAccessExists = await this.tableExists('guest_contract_access');

      // 4. guest_invitations_status_enum has all 4 lifecycle values
      const invitationStatusValues = await this.fetchEnumValues(
        'guest_invitations_status_enum',
      );
      const missingInvitationStatuses =
        this.REQUIRED_INVITATION_STATUS_VALUES.filter(
          (v) => !invitationStatusValues.has(v),
        );

      // 5. guest_invitations table exists
      const guestInvitationsExists = await this.tableExists('guest_invitations');

      if (
        missingRoles.length > 0 ||
        missingAccountTypes.length > 0 ||
        !guestAccessExists ||
        missingInvitationStatuses.length > 0 ||
        !guestInvitationsExists
      ) {
        const reasons: string[] = [];
        if (missingRoles.length > 0) {
          reasons.push(`user_role missing: ${missingRoles.join(', ')}`);
        }
        if (missingAccountTypes.length > 0) {
          reasons.push(
            `users_account_type_enum missing: ${missingAccountTypes.join(', ')}`,
          );
        }
        if (!guestAccessExists) {
          reasons.push('guest_contract_access table does not exist');
        }
        if (missingInvitationStatuses.length > 0) {
          reasons.push(
            `guest_invitations_status_enum missing: ${missingInvitationStatuses.join(', ')}`,
          );
        }
        if (!guestInvitationsExists) {
          reasons.push('guest_invitations table does not exist');
        }

        const banner =
          '══════════════════════════════════════════════════════════════\n' +
          '  FATAL: Guest portal schema is incomplete.\n' +
          reasons.map((r) => `    • ${r}`).join('\n') +
          '\n' +
          '  Guest-portal endpoints will fail at runtime.\n' +
          '  Run migrations immediately:\n' +
          '    docker-compose exec backend npm run migration:run\n' +
          '  or:\n' +
          '    npm run migration:run\n' +
          '══════════════════════════════════════════════════════════════';

        this.logger.error(banner);
        throw new Error(
          `Guest portal schema check failed: ${reasons.join('; ')}. Run: npm run migration:run`,
        );
      }

      this.logger.log(
        'Guest portal schema OK — user_role contains GUEST, ' +
          'users_account_type_enum has all required values, ' +
          'guest_contract_access table exists, ' +
          'guest_invitations_status_enum has all lifecycle values, ' +
          'guest_invitations table exists.',
      );
    } catch (error) {
      if (
        (error as Error).message?.startsWith(
          'Guest portal schema check failed',
        )
      ) {
        throw error;
      }
      // Unexpected DB error (connection not ready, etc.) — log loudly
      // but do not block startup, matching the obligation-schema-check
      // convention. The DB health check will catch a real outage.
      this.logger.error(
        `Could not verify guest portal schema (DB may not be ready): ${(error as Error).message}`,
      );
    }
  }

  private async tableExists(name: string): Promise<boolean> {
    const r = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [name],
    );
    return r[0]?.exists === true;
  }

  private async fetchEnumValues(typeName: string): Promise<Set<string>> {
    try {
      const rows = await this.dataSource.query<{ enumlabel: string }[]>(
        `SELECT enumlabel
         FROM pg_enum
         WHERE enumtypid = $1::regtype
         ORDER BY enumsortorder`,
        [typeName],
      );
      return new Set(rows.map((r) => r.enumlabel));
    } catch {
      // The cast to regtype throws if the type doesn't exist — treat
      // as "no values", which the caller will report as missing.
      return new Set();
    }
  }
}
