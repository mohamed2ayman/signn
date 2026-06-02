import 'reflect-metadata';
import { instanceToPlain } from 'class-transformer';
import { User } from '../user.entity';

/**
 * Strategy 1 — global ClassSerializerInterceptor + @Exclude on User entity.
 *
 * These tests assert the contract at the class-transformer layer:
 * `instanceToPlain(user)` MUST drop the five sensitive columns marked
 * @Exclude() on user.entity.ts. The global ClassSerializerInterceptor
 * registered via APP_INTERCEPTOR in app.module.ts runs this exact transform
 * on every controller response that is a class instance, so anything that
 * passes this test will also be stripped on the wire.
 *
 * Pure unit tests — no Nest module, no repository, no HTTP. Run against the
 * class-transformer library directly.
 */
describe('User entity — @Exclude() sensitive-field stripping', () => {
  const SENSITIVE_FIELDS = [
    'password_hash',
    'mfa_secret',
    'mfa_totp_secret',
    'mfa_recovery_codes',
    'invitation_token',
  ] as const;

  function buildUserInstance(): User {
    // Construct a real class instance — NOT a plain object literal —
    // because @Exclude metadata only fires on instances.
    const u = new User();
    u.id = 'user-uuid';
    u.organization_id = 'org-uuid';
    u.email = 'test@example.com';
    u.first_name = 'Test';
    u.last_name = 'User';
    u.role = 'OWNER_ADMIN' as any;
    u.is_active = true;
    u.is_email_verified = true;
    u.mfa_enabled = false;
    // Sensitive — must be stripped
    u.password_hash = '$2b$10$REDACTED_BCRYPT_HASH';
    u.mfa_secret = 'mfa-secret-value';
    u.mfa_totp_secret = 'totp-secret-value';
    u.mfa_recovery_codes = ['code-1', 'code-2'];
    u.invitation_token = 'invite-token-value';
    return u;
  }

  it.each(SENSITIVE_FIELDS)(
    'strips %s from instanceToPlain(user)',
    (field) => {
      const user = buildUserInstance();
      const plain = instanceToPlain(user) as Record<string, unknown>;
      expect(plain[field]).toBeUndefined();
    },
  );

  it('preserves every non-sensitive field on instanceToPlain(user)', () => {
    const user = buildUserInstance();
    const plain = instanceToPlain(user) as Record<string, unknown>;
    expect(plain.id).toBe('user-uuid');
    expect(plain.organization_id).toBe('org-uuid');
    expect(plain.email).toBe('test@example.com');
    expect(plain.first_name).toBe('Test');
    expect(plain.last_name).toBe('User');
    expect(plain.role).toBe('OWNER_ADMIN');
    expect(plain.is_active).toBe(true);
    expect(plain.is_email_verified).toBe(true);
    expect(plain.mfa_enabled).toBe(false);
  });

  it('does NOT leak any sensitive field via JSON.stringify of the transformed plain object', () => {
    // Belt-and-braces: even after JSON serialization, the field names must
    // not appear anywhere in the body string. Catches accidental nested
    // exposure (e.g. via a relation array) if the field set is ever
    // refactored.
    const user = buildUserInstance();
    const wireString = JSON.stringify(instanceToPlain(user));
    for (const field of SENSITIVE_FIELDS) {
      expect(wireString.includes(field)).toBe(false);
    }
  });

  it('handles an array of users (interceptor recurses into arrays)', () => {
    const users = [buildUserInstance(), buildUserInstance()];
    const plain = instanceToPlain(users) as Array<Record<string, unknown>>;
    expect(Array.isArray(plain)).toBe(true);
    for (const u of plain) {
      for (const field of SENSITIVE_FIELDS) {
        expect(u[field]).toBeUndefined();
      }
      // Non-sensitive identity field still present
      expect(u.email).toBe('test@example.com');
    }
  });

  it('handles a nested User on a wrapping object (mirrors contract.creator shape)', () => {
    // Simulates the leak shape where a Contract response carries a User
    // instance under `.creator`. instanceToPlain must recurse into that
    // property when it is a class instance.
    const wrapper = {
      id: 'contract-uuid',
      name: 'Test Contract',
      creator: buildUserInstance(),
    };
    const plain = instanceToPlain(wrapper) as any;
    expect(plain.id).toBe('contract-uuid');
    expect(plain.creator).toBeDefined();
    for (const field of SENSITIVE_FIELDS) {
      expect(plain.creator[field]).toBeUndefined();
    }
    expect(plain.creator.email).toBe('test@example.com');
  });
});
