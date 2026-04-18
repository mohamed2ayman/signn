/**
 * Standalone entry-point for seeding default users.
 *
 * Usage:
 *   npm run seed:users
 *
 * Idempotent — safe to run multiple times without creating duplicates.
 * Creates / updates:
 *   youssef141162@gmail.com / Youssef@1997  (OWNER_ADMIN)
 *   admin@sign.com          / Admin@Sign2026 (SYSTEM_ADMIN)
 */

import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../../config/data-source';
import { seedAdminUsers } from './admin-users.seed';

async function main() {
  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();
  try {
    await seedAdminUsers(dataSource);
    console.log('[seed:users] Done.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[seed:users] Fatal error:', err);
  process.exit(1);
});
