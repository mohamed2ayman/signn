import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole, Organization } from '../entities';

/**
 * Admin Users Seed
 *
 * Idempotent seed for the well-known SYSTEM_ADMIN accounts the platform
 * requires to exist in any environment (dev, staging, fresh DB resets).
 *
 * Passwords are NEVER hardcoded — they MUST come from environment variables
 * SEED_ADMIN_PASSWORD_1, SEED_ADMIN_PASSWORD_2, SEED_ADMIN_PASSWORD_3.
 * If any of those are missing or shorter than 12 chars, the seed throws.
 *
 * On every run:
 *   - Creates the user if missing (with hashed password).
 *   - If user EXISTS: only updates role + clears lock state. NEVER overwrites password.
 *   - Ensures an organization exists for the OWNER_ADMIN user.
 */

export function requireSeedPassword(varName: string): string {
  const value = process.env[varName];
  if (!value || value.trim().length < 12) {
    throw new Error(
      `\n` +
        `╔════════════════════════════════════════════════════╗\n` +
        `║          SEED CONFIGURATION ERROR                  ║\n` +
        `╠════════════════════════════════════════════════════╣\n` +
        `║  ${varName} is required to run seeds.` +
        `\n║  Minimum 12 characters required.` +
        `\n║` +
        `\n║  Add to your .env file:` +
        `\n║  ${varName}=YourSecurePassword@2026` +
        `\n║` +
        `\n║  Then restart: docker-compose up --build backend` +
        `\n╚════════════════════════════════════════════════════╝`,
    );
  }
  return value.trim();
}

interface AdminSeed {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  organization_name?: string; // only for non-system-admin
}

function buildAdminUsers(): AdminSeed[] {
  return [
    {
      email: 'youssef141162@gmail.com',
      password: requireSeedPassword('SEED_ADMIN_PASSWORD_1'),
      first_name: 'Youssef',
      last_name: 'Mabrouk',
      role: UserRole.SYSTEM_ADMIN,
    },
    {
      email: 'admin@sign.com',
      password: requireSeedPassword('SEED_ADMIN_PASSWORD_2'),
      first_name: 'System',
      last_name: 'Admin',
      role: UserRole.SYSTEM_ADMIN,
    },
    {
      email: 'mohameddaaymande@gmail.com',
      password: requireSeedPassword('SEED_ADMIN_PASSWORD_3'),
      first_name: 'Mohamed',
      last_name: 'Ayman',
      role: UserRole.SYSTEM_ADMIN,
    },
  ];
}

export async function seedAdminUsers(dataSource: DataSource): Promise<void> {
  const ADMIN_USERS = buildAdminUsers();
  const userRepo = dataSource.getRepository(User);
  const orgRepo = dataSource.getRepository(Organization);

  for (const seed of ADMIN_USERS) {
    let organizationId: string | null = null;
    if (seed.organization_name) {
      let org = await orgRepo.findOne({ where: { name: seed.organization_name } });
      if (!org) {
        org = orgRepo.create({ name: seed.organization_name });
        org = await orgRepo.save(org);
      }
      organizationId = org.id;
    }

    const existing = await userRepo.findOne({ where: { email: seed.email } });

    if (existing) {
      // NEVER overwrite password — user may have changed it manually.
      // Only update role (in case it drifted) and clear any lock state.
      existing.role = seed.role;
      existing.is_active = true;
      existing.is_email_verified = true;
      existing.failed_login_attempts = 0;
      existing.locked_until = null as any;
      if (organizationId && !existing.organization_id) {
        existing.organization_id = organizationId;
      }
      await userRepo.save(existing);
      console.log(`[seed] Ensured admin user (password preserved): ${seed.email}`);
    } else {
      // New user — hash and insert with seed password as the initial password.
      const passwordHash = await bcrypt.hash(seed.password, 10);
      const user = userRepo.create({
        email: seed.email,
        password_hash: passwordHash,
        first_name: seed.first_name,
        last_name: seed.last_name,
        role: seed.role,
        is_active: true,
        is_email_verified: true,
        organization_id: organizationId as any,
      });
      await userRepo.save(user);
      console.log(`[seed] Created admin user: ${seed.email}`);
    }
  }
}
