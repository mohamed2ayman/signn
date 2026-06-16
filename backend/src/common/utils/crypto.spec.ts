import { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto';

/**
 * CryptoService unit tests (Phase 7.28 prerequisite).
 *
 * Coverage:
 *   - round-trip: encrypt → decrypt returns the original (incl. unicode/empty)
 *   - distinct ciphertext for the same plaintext (random IV per call)
 *   - tampered-payload rejection (GCM auth-tag failure not swallowed)
 *   - malformed-payload rejection (bad format / version / lengths)
 *   - wrong-key failure (encrypt with key A, decrypt with key B)
 *   - missing-key error (clear, var-naming) on encrypt AND decrypt
 *   - too-short-key error
 */

// Both keys are >= 32 chars (the defensive floor).
const KEY_A = 'crypto-test-master-key-AAAAAAAAAA-0123456789';
const KEY_B = 'crypto-test-master-key-BBBBBBBBBB-9876543210';

/** Build a CryptoService whose ConfigService returns `key` for the env var. */
function makeService(key: string | undefined): CryptoService {
  const config = {
    get: jest.fn((name: string) =>
      name === 'ERP_CREDENTIAL_ENC_KEY' ? key : undefined,
    ),
  } as unknown as ConfigService;
  return new CryptoService(config);
}

/** Flip one base64url char in the ciphertext segment without changing its length. */
function tamperCiphertext(payload: string): string {
  const parts = payload.split('.');
  const ct = parts[3];
  const replacement = ct[0] === 'A' ? 'B' : 'A';
  parts[3] = replacement + ct.slice(1);
  return parts.join('.');
}

describe('CryptoService', () => {
  describe('round-trip', () => {
    it('decrypts back to the original plaintext', () => {
      const svc = makeService(KEY_A);
      const secret = 'sap-api-key-12345!@#';
      expect(svc.decrypt(svc.encrypt(secret))).toBe(secret);
    });

    it('handles unicode and empty strings', () => {
      const svc = makeService(KEY_A);
      const unicode = 'مفتاح-السر — clé secrète 🔐';
      expect(svc.decrypt(svc.encrypt(unicode))).toBe(unicode);
      expect(svc.decrypt(svc.encrypt(''))).toBe('');
    });

    it('produces a v1 payload with a random IV (distinct ciphertext per call)', () => {
      const svc = makeService(KEY_A);
      const a = svc.encrypt('same-input');
      const b = svc.encrypt('same-input');
      expect(a).not.toBe(b); // random IV ⇒ different payloads
      expect(a.startsWith('v1.')).toBe(true);
      expect(a.split('.')).toHaveLength(4);
      expect(svc.decrypt(a)).toBe('same-input');
      expect(svc.decrypt(b)).toBe('same-input');
    });
  });

  describe('tampering & malformed payloads — must throw, never swallow', () => {
    it('rejects a tampered ciphertext (auth-tag verification fails)', () => {
      const svc = makeService(KEY_A);
      const tampered = tamperCiphertext(svc.encrypt('do-not-tamper'));
      expect(() => svc.decrypt(tampered)).toThrow(/authentication failed/i);
    });

    it('rejects malformed payloads', () => {
      const svc = makeService(KEY_A);
      expect(() => svc.decrypt('')).toThrow(/malformed/i);
      expect(() => svc.decrypt('garbage')).toThrow(/malformed/i);
      expect(() => svc.decrypt('v2.a.b.c')).toThrow(/malformed/i); // wrong version
      expect(() => svc.decrypt('v1.a.b')).toThrow(/malformed/i); // too few parts
      expect(() => svc.decrypt('v1.AA.BB.CC')).toThrow(/malformed/i); // bad iv/tag length
    });
  });

  describe('wrong key', () => {
    it('fails to decrypt a payload produced with a different key', () => {
      const enc = makeService(KEY_A);
      const dec = makeService(KEY_B);
      const payload = enc.encrypt('cross-key-secret');
      expect(() => dec.decrypt(payload)).toThrow(/authentication failed/i);
    });
  });

  describe('key configuration', () => {
    it('throws a clear, var-naming error when the key is missing', () => {
      // A well-formed payload (made with a real key) so decrypt reaches the
      // key precondition rather than short-circuiting on payload structure.
      const payload = makeService(KEY_A).encrypt('x');
      const svc = makeService(undefined);
      expect(() => svc.encrypt('x')).toThrow(/ERP_CREDENTIAL_ENC_KEY/);
      expect(() => svc.decrypt(payload)).toThrow(/ERP_CREDENTIAL_ENC_KEY/);
    });

    it('throws when the key is below the 32-char floor', () => {
      const svc = makeService('too-short');
      expect(() => svc.encrypt('x')).toThrow(/at least 32/i);
    });

    it('rejects a non-string plaintext on encrypt', () => {
      const svc = makeService(KEY_A);
      // @ts-expect-error — deliberately wrong type
      expect(() => svc.encrypt(undefined)).toThrow(/must be a string/i);
    });
  });
});
