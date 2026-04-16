import 'reflect-metadata';
import dataSource from '../../config/data-source';
import { seedAdminUsers } from './admin-users.seed';

/**
 * Seed runner — invoked after `migration:run` so the well-known admin
 * accounts always exist after a fresh DB reset.
 *
 * Add additional seeds below as needed.
 */
async function main() {
  await dataSource.initialize();
  try {
    await seedAdminUsers(dataSource);
    console.log('[seed] All seeds completed.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
