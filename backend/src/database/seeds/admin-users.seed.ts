import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole, Organization } from '../entities';

/**
 * Admin Users Seed
 *
 * Idempotent seed for the two well-known accounts the platform requires
 * to exist in any environment (dev, staging, fresh DB resets).
 *
 * - youssef141162@gmail.com / Youssef@1997  (SYSTEM_ADMIN)
 * - admin@sign.com          / Admin@Sign2026 (SYSTEM_ADMIN)
 *
 * On every run:
 *   - Creates the user if missing.
 *   - Updates password_hash + clears lock state if user exists.
 *   - Ensures an organization exists for the OWNER_ADMIN user.
 */

interface AdminSeed {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  organization_name?: string; // only for non-system-admin
}

const ADMIN_USERS: AdminSeed[] = [
  {
    email: 'youssef141162@gmail.com',
    password: 'Youssef@1997',
    first_name: 'Youssef',
    last_name: 'Mabrouk',
    role: UserRole.SYSTEM_ADMIN,
  },
  {
    email: 'admin@sign.com',
    password: 'Admin@Sign2026',
    first_name: 'System',
    last_name: 'Admin',
    role: UserRole.SYSTEM_ADMIN,
  },
];

export async function seedAdminUsers(dataSource: DataSource): Promise<void> {
  const userRepo = dataSource.getRepository(User);
  const orgRepo = dataSource.getRepository(Organization);

  for (const seed of ADMIN_USERS) {
    const passwordHash = await bcrypt.hash(seed.password, 10);

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
      existing.password_hash = passwordHash;
      existing.is_active = true;
      existing.is_email_verified = true;
      existing.failed_login_attempts = 0;
      existing.locked_until = null as any;
      existing.role = seed.role;
      if (organizationId && !existing.organization_id) {
        existing.organization_id = organizationId;
      }
      await userRepo.save(existing);
      console.log(`[seed] Updated admin user: ${seed.email}`);
    } else {
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
