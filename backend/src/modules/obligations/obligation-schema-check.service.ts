import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * ObligationSchemaCheckService
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs once on NestJS bootstrap. Verifies that the obligation_status PostgreSQL
 * enum contains all values the application code depends on.
 *
 * Motivation: Migration 1718000000002 silently failed to add MET and WAIVED
 * to obligation_status for months (wrong type name + silent catch). This check
 * ensures a future migration regression is caught immediately at startup
 * rather than discovered via a runtime 500 when a user tries to mark an
 * obligation as met.
 *
 * Phase 7.2-E fix.
 */
@Injectable()
export class ObligationSchemaCheckService implements OnModuleInit {
  private readonly logger = new Logger(ObligationSchemaCheckService.name);

  private readonly REQUIRED_VALUES = ['MET', 'WAIVED'] as const;

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      const result = await this.dataSource.query<{ enumlabel: string }[]>(
        `SELECT enumlabel
         FROM pg_enum
         WHERE enumtypid = 'obligation_status'::regtype
         ORDER BY enumsortorder`,
      );

      const present = new Set(result.map((r) => r.enumlabel));
      const missing = this.REQUIRED_VALUES.filter((v) => !present.has(v));

      if (missing.length > 0) {
        this.logger.error(
          '══════════════════════════════════════════════════════════════\n' +
            `  FATAL: obligation_status enum is missing values: ${missing.join(', ')}\n` +
            '  The mark-as-met and waived endpoints will fail at runtime.\n' +
            '  Run migrations immediately:\n' +
            '    docker-compose exec backend npm run migration:run\n' +
            '  or:\n' +
            '    npm run migration:run\n' +
            '══════════════════════════════════════════════════════════════',
        );
        // Throw so the process exits non-zero and the issue is unmissable
        // in both local logs and any CI/CD startup health checks.
        throw new Error(
          `obligation_status enum is missing required values: ${missing.join(', ')}. ` +
            `Run: npm run migration:run`,
        );
      }

      this.logger.log(
        `obligation_status enum OK — all required values present: ${[...present].join(', ')}`,
      );
    } catch (error) {
      // Re-throw our own deliberately thrown errors (missing enum values)
      if (error.message?.startsWith('obligation_status enum is missing')) {
        throw error;
      }
      // For unexpected DB errors (e.g. connection not ready), log loudly
      // but do not block startup — the DB health check will catch the outage.
      this.logger.error(
        `Could not verify obligation_status enum (DB may not be ready): ${(error as Error).message}`,
      );
    }
  }
}
