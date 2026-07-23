import { describe, it, expect, beforeEach } from 'vitest';
import {
  GUEST_SESSION_KEY,
  clearGuestSession,
  getGuestSession,
  saveGuestSession,
} from './guestSession';

// #8c Part 1 — the load-bearing storage-posture constraints:
//   • sessionStorage, GUEST-ONLY key — never localStorage, never the shared
//     managing slots ('access_token' / 'refresh_token').
//   • ACCESS TOKEN ONLY — the API cannot persist a refresh token at all.
//   • Expired/corrupt sessions read as absent (and are cleared).

const USER = {
  id: 'g-1',
  email: 'g@external.test',
  first_name: 'Gee',
  last_name: 'Guest',
};

const jwtWithExp = (expSecFromNow: number) =>
  `hdr.${btoa(
    JSON.stringify({ sub: USER.id, role: 'GUEST', exp: Math.floor(Date.now() / 1000) + expSecFromNow }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.sig`;

describe('guestSession — sessionStorage-only, access-token-only guest store', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('saves to sessionStorage under the guest key — and NOTHING touches localStorage or the shared managing slots', () => {
    saveGuestSession(jwtWithExp(3600), USER as never);

    // Present where it should be…
    const raw = sessionStorage.getItem(GUEST_SESSION_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.token).toContain('hdr.');
    expect(parsed.user.email).toBe(USER.email);

    // …and NOWHERE else (both directions of the isolation claim).
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(sessionStorage.getItem('refresh_token')).toBeNull();
  });

  it('never persists a refresh token — the stored shape has no refresh field at all', () => {
    saveGuestSession(jwtWithExp(3600), USER as never);
    const raw = sessionStorage.getItem(GUEST_SESSION_KEY) as string;
    expect(raw).not.toContain('refresh');
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(['expires_at', 'token', 'user']);
  });

  it('reads back a live session; expires_at comes from the JWT exp claim', () => {
    const token = jwtWithExp(3600);
    saveGuestSession(token, USER as never);
    const s = getGuestSession();
    expect(s?.token).toBe(token);
    expect(s?.user.id).toBe(USER.id);
    // exp claim (≈now+1h), not a client-side guess.
    expect(Math.abs((s?.expires_at ?? 0) - (Date.now() + 3600_000))).toBeLessThan(5_000);
  });

  it('an EXPIRED session reads as null and is cleared', () => {
    saveGuestSession(jwtWithExp(-10), USER as never);
    expect(getGuestSession()).toBeNull();
    expect(sessionStorage.getItem(GUEST_SESSION_KEY)).toBeNull();
  });

  it('a CORRUPT value reads as null and is cleared (never throws)', () => {
    sessionStorage.setItem(GUEST_SESSION_KEY, '{not-json');
    expect(getGuestSession()).toBeNull();
    expect(sessionStorage.getItem(GUEST_SESSION_KEY)).toBeNull();

    sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify({ token: '', user: {} }));
    expect(getGuestSession()).toBeNull();
  });

  it('an undecodable token still saves, with the 1h fallback expiry', () => {
    saveGuestSession('not-a-jwt', USER as never);
    const s = getGuestSession();
    expect(s?.token).toBe('not-a-jwt');
    expect(Math.abs((s?.expires_at ?? 0) - (Date.now() + 3600_000))).toBeLessThan(5_000);
  });

  it('clearGuestSession removes the session', () => {
    saveGuestSession(jwtWithExp(3600), USER as never);
    clearGuestSession();
    expect(getGuestSession()).toBeNull();
  });
});
