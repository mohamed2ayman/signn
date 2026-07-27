import type { User } from '@/types';

/**
 * #8c Part 1 — the pure-guest session store.
 *
 * STRUCTURAL ISOLATION (CTO-approved posture): the guest access token lives in
 * sessionStorage under a GUEST-SPECIFIC key — NOT localStorage, and NOT the
 * shared managing-token slot (`access_token` / redux auth). Guest/managing
 * token isolation is therefore a property of WHERE the token lives, not of
 * call-site discipline:
 *   • the shared `api` client reads redux (never this store), so a guest
 *     token can never ride a managing call or its refresh rotation;
 *   • sessionStorage is session-scoped by definition — survives a page
 *     refresh, dies with the tab — which is the intended guest posture.
 *
 * ACCESS TOKEN ONLY. A refresh token is NEVER stored or wired for a guest:
 * the session ends when the (guest-scoped, ~1h) token expires, and the guest
 * returns by re-clicking their invitation link — never a link-less login.
 * (Enforced independently on both refresh paths: the axios interceptor's
 * guest-token check and the backend /auth/refresh GUEST rejection.)
 */

const GUEST_SESSION_KEY = 'sign_guest_session:v1';

export interface GuestSessionUser {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
}

export interface GuestSession {
  token: string;
  user: GuestSessionUser;
  /** Epoch ms — read from the JWT `exp` claim at save time. */
  expires_at: number;
}

/** Decode a JWT's payload without verifying (display/expiry hints only). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const seg = token.split('.')[1];
    if (!seg) return null;
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Persist a guest session (ACCESS TOKEN ONLY — the signature takes no refresh
 * token so a future call site cannot even pass one). `expires_at` comes from
 * the token's own `exp` claim; if the payload is undecodable we fall back to
 * one hour, matching the backend's JWT_GUEST_ACCESS_EXPIRES_IN default.
 */
export function saveGuestSession(token: string, user: User | GuestSessionUser): void {
  const payload = decodeJwtPayload(token);
  const expMs =
    typeof payload?.exp === 'number'
      ? (payload.exp as number) * 1000
      : Date.now() + 60 * 60 * 1000;
  const session: GuestSession = {
    token,
    user: {
      id: user.id,
      email: user.email,
      first_name: (user as GuestSessionUser).first_name ?? null,
      last_name: (user as GuestSessionUser).last_name ?? null,
    },
    expires_at: expMs,
  };
  sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session));
}

/**
 * Read the guest session. Returns null when absent, corrupt, or EXPIRED —
 * an expired session is cleared on read so the UI can't render a doomed
 * "signed-in" state against a token the backend will 401.
 */
export function getGuestSession(): GuestSession | null {
  try {
    const raw = sessionStorage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestSession;
    if (
      typeof parsed?.token !== 'string' ||
      !parsed.token ||
      typeof parsed?.expires_at !== 'number' ||
      !parsed?.user?.id
    ) {
      sessionStorage.removeItem(GUEST_SESSION_KEY);
      return null;
    }
    if (parsed.expires_at <= Date.now()) {
      sessionStorage.removeItem(GUEST_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(GUEST_SESSION_KEY);
    return null;
  }
}

export function clearGuestSession(): void {
  sessionStorage.removeItem(GUEST_SESSION_KEY);
}

export { GUEST_SESSION_KEY };
