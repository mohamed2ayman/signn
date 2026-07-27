import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import axios from 'axios';
import { isGuestAccessToken } from './guestTokenGuard';

// #8c Part 1 — the ENFORCED frontend no-renewal guard. Two layers proven here:
//   1. the classifier itself (isGuestAccessToken);
//   2. the shared api client's 401 interceptor: a GUEST token never triggers
//      the silent refresh POST, while a managing token still does — asserted
//      on the interceptor's real rejected-handler, not on write-site behavior.

const mkToken = (payload: Record<string, unknown>) =>
  `hdr.${btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}.sig`;

describe('isGuestAccessToken — positive role=GUEST classifier', () => {
  it('true for a pure-guest access token (role GUEST)', () => {
    expect(isGuestAccessToken(mkToken({ sub: 'u1', role: 'GUEST', jti: 'j' }))).toBe(true);
  });

  it('false for managing roles (managing-as-guest keeps its real role and MAY refresh)', () => {
    expect(isGuestAccessToken(mkToken({ sub: 'u1', role: 'OWNER_ADMIN' }))).toBe(false);
    expect(isGuestAccessToken(mkToken({ sub: 'u1', role: 'PROJECT_MANAGER' }))).toBe(false);
  });

  it('false (never throws) for null / empty / malformed / non-JSON tokens', () => {
    expect(isGuestAccessToken(null)).toBe(false);
    expect(isGuestAccessToken(undefined)).toBe(false);
    expect(isGuestAccessToken('')).toBe(false);
    expect(isGuestAccessToken('no-dots-here')).toBe(false);
    expect(isGuestAccessToken('a.!!!notbase64!!!.c')).toBe(false);
    expect(isGuestAccessToken(`a.${btoa('"just-a-string"')}.c`)).toBe(false);
  });

  it('handles base64url payloads (- and _ chars)', () => {
    // Payload chosen so the base64 encoding contains + and / before the
    // url-safe replacement — the decoder must map them back.
    const t = mkToken({ role: 'GUEST', pad: '~~~???>>>' });
    expect(isGuestAccessToken(t)).toBe(true);
  });
});

describe('shared api client 401 interceptor — guest tokens never silently renew', () => {
  // Import inside the suite so the interceptor registers on the mocked-free
  // real module; we drive its REJECTED handler directly.
  let rejectedHandler: (err: unknown) => Promise<unknown>;
  let postSpy: MockInstance;

  beforeEach(async () => {
    localStorage.clear();
    const { default: api } = await import('./axios');
    // axios v1 keeps registered interceptor pairs on .handlers.
    const handlers = (
      api.interceptors.response as unknown as {
        handlers: Array<{ rejected: (e: unknown) => Promise<unknown> }>;
      }
    ).handlers;
    rejectedHandler = handlers[handlers.length - 1].rejected;
    postSpy = vi.spyOn(axios, 'post');
  });

  afterEach(() => {
    postSpy.mockRestore();
  });

  const make401 = (bearer: string) => ({
    config: { headers: { Authorization: `Bearer ${bearer}` }, _retry: undefined },
    response: { status: 401 },
  });

  it('GUEST token + available refresh token → NO refresh POST, error rejected as-is', async () => {
    // A refresh token IS available — proving the guard (not its absence) is
    // what blocks the renewal.
    localStorage.setItem('refresh_token', 'some-refresh-token');
    const err = make401(mkToken({ sub: 'g1', role: 'GUEST', jti: 'j' }));

    await expect(rejectedHandler(err)).rejects.toBe(err);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('MANAGING token → the interceptor DOES attempt the refresh POST (contrast)', async () => {
    localStorage.setItem('refresh_token', 'some-refresh-token');
    postSpy.mockRejectedValue(new Error('refresh endpoint unreachable in test'));
    const err = make401(mkToken({ sub: 'm1', role: 'OWNER_ADMIN', jti: 'j' }));

    await expect(rejectedHandler(err)).rejects.toBeTruthy();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(String(postSpy.mock.calls[0][0])).toContain('/auth/refresh');
  });
});
