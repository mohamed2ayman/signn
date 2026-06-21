import * as fs from 'fs';
import * as path from 'path';
import { requireSeedPassword, buildAdminUsers } from '../admin-users.seed';
import { UserRole } from '../../entities';

describe('Phase 4.3 — Seed & DATABASE_URL Validation', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe('requireSeedPassword()', () => {
    it('TEST 1 — throws when env var is missing', () => {
      delete process.env.SEED_ADMIN_PASSWORD_1;

      let thrown: Error | null = null;
      try {
        requireSeedPassword('SEED_ADMIN_PASSWORD_1');
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown!.message).toContain('SEED_ADMIN_PASSWORD_1');
      expect(thrown!.message).toContain('required');
      expect(thrown!.message).toContain('.env');
    });

    it('TEST 2 — throws when password is under 12 chars', () => {
      process.env.SEED_ADMIN_PASSWORD_1 = 'short';

      let thrown: Error | null = null;
      try {
        requireSeedPassword('SEED_ADMIN_PASSWORD_1');
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown!.message).toContain('12');
    });

    it('TEST 3 — returns the trimmed value when valid', () => {
      process.env.SEED_ADMIN_PASSWORD_1 = 'ValidPassword@2026';

      const result = requireSeedPassword('SEED_ADMIN_PASSWORD_1');

      expect(result).toBe('ValidPassword@2026');
    });
  });

  describe('buildAdminUsers() — opt-in OWNER_ADMIN seed', () => {
    // Synthetic ≥12-char fixtures — NOT real credentials; only exercise the
    // min-12 validation + opt-in branching. The real seed password lives only
    // in the developer's local .env.
    const DUMMY = 'seed-spec-dummy-credential';

    beforeEach(() => {
      // The 3 SYSTEM_ADMIN entries are always built and call requireSeedPassword,
      // so give them valid values to isolate the OWNER_ADMIN opt-in behaviour.
      process.env.SEED_ADMIN_PASSWORD_1 = DUMMY;
      process.env.SEED_ADMIN_PASSWORD_2 = DUMMY;
      process.env.SEED_ADMIN_PASSWORD_3 = DUMMY;
    });

    it('TEST 6 — without SEED_OWNER_ADMIN_PASSWORD: only the 3 SYSTEM_ADMINs are built', () => {
      delete process.env.SEED_OWNER_ADMIN_PASSWORD;

      const users = buildAdminUsers();

      expect(users).toHaveLength(3);
      expect(users.every((u) => u.role === UserRole.SYSTEM_ADMIN)).toBe(true);
      expect(users.find((u) => u.email === 'owner@sign.com')).toBeUndefined();
      expect(users.some((u) => u.organization_name)).toBe(false);
    });

    it('TEST 7 — an empty SEED_OWNER_ADMIN_PASSWORD is treated as unset (no OWNER_ADMIN, no throw)', () => {
      process.env.SEED_OWNER_ADMIN_PASSWORD = '';

      const users = buildAdminUsers();

      expect(users).toHaveLength(3);
      expect(users.find((u) => u.email === 'owner@sign.com')).toBeUndefined();
    });

    it('TEST 8 — with a valid SEED_OWNER_ADMIN_PASSWORD: the OWNER_ADMIN test user is appended', () => {
      process.env.SEED_OWNER_ADMIN_PASSWORD = DUMMY;

      const users = buildAdminUsers();

      expect(users).toHaveLength(4);
      const owner = users.find((u) => u.email === 'owner@sign.com');
      expect(owner).toBeDefined();
      expect(owner!.role).toBe(UserRole.OWNER_ADMIN);
      expect(owner!.organization_name).toBe('SIGN Test Organization');
      expect(owner!.first_name).toBe('Owner');
      expect(owner!.last_name).toBe('Admin');
      // The 3 SYSTEM_ADMIN entries are untouched.
      expect(
        users.filter((u) => u.role === UserRole.SYSTEM_ADMIN),
      ).toHaveLength(3);
    });

    it('TEST 9 — a present-but-too-short SEED_OWNER_ADMIN_PASSWORD still fails min-12 validation', () => {
      process.env.SEED_OWNER_ADMIN_PASSWORD = 'short';

      expect(() => buildAdminUsers()).toThrow(/SEED_OWNER_ADMIN_PASSWORD/);
    });
  });

  describe('data-source DATABASE_URL guard', () => {
    it('TEST 4 — throws when DATABASE_URL is missing', async () => {
      let thrown: Error | null = null;
      jest.isolateModules(() => {
        // Stub dotenv so it doesn't re-populate DATABASE_URL from backend/.env
        // when data-source.ts is freshly required.
        jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
        delete process.env.DATABASE_URL;
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../../../config/data-source');
        } catch (e) {
          thrown = e as Error;
        }
      });
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown!.message).toContain('DATABASE_URL');
    });
  });

  describe('obligation-token.service.ts hardening', () => {
    it('TEST 5 — does not contain a weak literal JWT secret fallback', () => {
      const filePath = path.resolve(
        __dirname,
        '../../../modules/compliance/services/obligation-token.service.ts',
      );
      const source = fs.readFileSync(filePath, 'utf-8');

      // Build the forbidden literal at runtime so this test file itself
      // doesn't trip the Phase 4.3 DOD grep.
      const forbidden = ['dev', 'jwt', 'secret'].join('-');
      expect(source.includes(forbidden)).toBe(false);
    });
  });
});
