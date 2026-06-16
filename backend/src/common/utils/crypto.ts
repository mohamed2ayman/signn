import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * AES-256-GCM encryption-at-rest primitive.
 *
 * This is the FIRST encryption-at-rest helper in the codebase. Its first
 * consumer is ERP credential storage (Phase 7.28) — hence the key env var name
 * `ERP_CREDENTIAL_ENC_KEY` — but the utility itself is GENERIC: it encrypts and
 * decrypts any string. Future consumers that currently store secrets in
 * plaintext (e.g. `users.mfa_totp_secret`, the DocuSign RSA private key) could
 * be migrated onto this util — that retrofit is intentionally OUT OF SCOPE here
 * and is noted only as a future direction.
 *
 * Payload format (self-contained — decryption needs only the stored value + key):
 *
 *   v1.<base64url(iv)>.<base64url(authTag)>.<base64url(ciphertext)>
 *
 * The `v1.` version prefix is deliberate: it lets a future algorithm rotation
 * coexist with already-stored `v1` payloads without ambiguity. The IV and the
 * GCM auth tag travel inside the payload, so the only out-of-band input needed
 * to decrypt is the key.
 *
 * Key handling (secrets policy):
 *   - The key is read from `ERP_CREDENTIAL_ENC_KEY` via ConfigService — never
 *     `process.env` directly, never a hardcoded fallback secret.
 *   - The var is OPTIONAL at boot (the app starts without it, like the other
 *     optional integration vars), so the key is resolved LAZILY on each
 *     encrypt/decrypt call. If the key is missing or below the 32-char floor at
 *     the moment of use, we throw a clear error rather than degrading silently.
 *   - The configured string is run through SHA-256 to derive exactly 32 bytes
 *     for AES-256. This guarantees a valid key length regardless of the exact
 *     byte length of the configured secret. SHA-256 (rather than a salted KDF)
 *     is appropriate here because the input is a high-entropy machine secret,
 *     not a human password; `min(32)` is enforced as a defensive entropy floor.
 *
 * Failure behavior:
 *   - decrypt() throws LOUDLY on a tampered or malformed payload. GCM auth-tag
 *     verification (inside `decipher.final()`) is never swallowed — a tampered
 *     ciphertext/tag or a wrong key surfaces as a thrown error. Error messages
 *     are generic and never include key material or plaintext.
 */

const KEY_ENV = 'ERP_CREDENTIAL_ENC_KEY';
const MIN_KEY_LENGTH = 32;

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_LENGTH = 12; // 96-bit IV — the recommended size for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128-bit GCM auth tag

@Injectable()
export class CryptoService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Encrypt a plaintext string into a self-contained `v1.iv.tag.ciphertext`
   * payload. Safe to store as-is; decrypt() needs only this value + the key.
   *
   * @throws if the plaintext is not a string, or the key is missing/too short.
   */
  encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string') {
      throw new Error('CryptoService.encrypt: plaintext must be a string');
    }

    const key = this.deriveKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      VERSION,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /**
   * Decrypt a payload produced by encrypt() back to the original plaintext.
   *
   * @throws if the payload is malformed, if the key is missing/too short, or if
   *   the GCM auth tag fails to verify (payload tampered with, or wrong key).
   *   This NEVER returns silently on failure.
   */
  decrypt(payload: string): string {
    if (typeof payload !== 'string' || payload.length === 0) {
      throw new Error(
        'CryptoService.decrypt: payload is malformed (empty or not a string)',
      );
    }

    // Resolve the key first — it is a precondition for decryption, so a missing
    // or too-short key is reported before any structural parsing.
    const key = this.deriveKey();

    const parts = payload.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error(
        'CryptoService.decrypt: payload is malformed (unexpected format or version)',
      );
    }

    const iv = Buffer.from(parts[1], 'base64url');
    const authTag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(
        'CryptoService.decrypt: payload is malformed (invalid IV or auth tag length)',
      );
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(), // throws if the auth tag does not verify
      ]);
      return plaintext.toString('utf8');
    } catch {
      // GCM authentication failed: the payload was tampered with, or the key is
      // wrong. Rethrow loudly with a generic message — never leak key/plaintext,
      // never swallow.
      throw new Error(
        'CryptoService.decrypt: authentication failed (payload tampered or wrong key)',
      );
    }
  }

  /**
   * Resolve the configured secret and derive a 32-byte AES-256 key from it.
   * Throws a clear, var-naming error if the key is absent or below the floor.
   */
  private deriveKey(): Buffer {
    const raw = this.config.get<string>(KEY_ENV);
    if (!raw || raw.trim().length === 0) {
      throw new Error(
        `${KEY_ENV} is not configured — cannot encrypt or decrypt. ` +
          `Set ${KEY_ENV} (min ${MIN_KEY_LENGTH} chars) in the environment.`,
      );
    }
    if (raw.length < MIN_KEY_LENGTH) {
      throw new Error(
        `${KEY_ENV} is too short — must be at least ${MIN_KEY_LENGTH} characters.`,
      );
    }
    return createHash('sha256').update(raw, 'utf8').digest();
  }
}
