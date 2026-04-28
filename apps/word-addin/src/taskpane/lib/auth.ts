import type {
  AuthUser,
  LoginResponse,
  LoginSuccessResponse,
} from './types';

const KEY_ACCESS = 'sign.access_token';
const KEY_REFRESH = 'sign.refresh_token';
const KEY_EXP = 'sign.access_token_exp';
const KEY_USER = 'sign.user';

const REFRESH_BUFFER_SECONDS = 30;
const API_BASE: string =
  (process.env.SIGN_API_URL as string) || 'http://localhost:3000/api/v1';

export interface AuthState {
  accessToken: string;
  refreshToken: string;
  exp: number;
  user: AuthUser;
}

export class AuthRequiredError extends Error {
  constructor(message = 'Re-authentication required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class MfaRequiredError extends Error {
  constructor(
    public readonly email: string,
    public readonly method: 'totp' | 'email',
  ) {
    super(`MFA required (${method})`);
    this.name = 'MfaRequiredError';
  }
}

/* ─── Storage ───────────────────────────────────────────── */

export function getStoredAuth(): AuthState | null {
  const accessToken = localStorage.getItem(KEY_ACCESS);
  const refreshToken = localStorage.getItem(KEY_REFRESH);
  const expRaw = localStorage.getItem(KEY_EXP);
  const userRaw = localStorage.getItem(KEY_USER);
  if (!accessToken || !refreshToken || !expRaw || !userRaw) return null;
  return {
    accessToken,
    refreshToken,
    exp: parseInt(expRaw, 10),
    user: JSON.parse(userRaw) as AuthUser,
  };
}

export function clearStoredAuth(): void {
  localStorage.removeItem(KEY_ACCESS);
  localStorage.removeItem(KEY_REFRESH);
  localStorage.removeItem(KEY_EXP);
  localStorage.removeItem(KEY_USER);
}

function persistAuth(res: LoginSuccessResponse): AuthState {
  const exp = parseExpFromJwt(res.access_token);
  localStorage.setItem(KEY_ACCESS, res.access_token);
  localStorage.setItem(KEY_REFRESH, res.refresh_token);
  localStorage.setItem(KEY_EXP, String(exp));
  localStorage.setItem(KEY_USER, JSON.stringify(res.user));
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    exp,
    user: res.user,
  };
}

function parseExpFromJwt(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

/* ─── Login / MFA / Refresh ─────────────────────────────── */

export async function login(
  email: string,
  password: string,
): Promise<AuthState> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const body = (await res.json()) as LoginResponse;
  if ('requires_mfa' in body) {
    throw new MfaRequiredError(body.email, body.mfa_method);
  }
  return persistAuth(body);
}

export async function verifyMfa(
  email: string,
  code: string,
): Promise<AuthState> {
  const res = await fetch(`${API_BASE}/auth/verify-mfa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, totp_code: code }),
  });
  if (!res.ok) throw new Error(`MFA verification failed (${res.status})`);
  const body = (await res.json()) as LoginSuccessResponse;
  return persistAuth(body);
}

export async function refreshIfNeeded(): Promise<AuthState> {
  const state = getStoredAuth();
  if (!state) throw new AuthRequiredError('Not signed in');

  const now = Math.floor(Date.now() / 1000);
  if (now < state.exp - REFRESH_BUFFER_SECONDS) {
    return state;
  }

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: state.refreshToken }),
  });
  if (!res.ok) {
    clearStoredAuth();
    throw new AuthRequiredError(`Refresh failed (${res.status})`);
  }
  const body = (await res.json()) as LoginSuccessResponse;
  return persistAuth(body);
}

export async function logout(): Promise<void> {
  const state = getStoredAuth();
  if (!state) {
    clearStoredAuth();
    return;
  }
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.accessToken}` },
    });
  } catch {
    /* best-effort */
  }
  clearStoredAuth();
}
