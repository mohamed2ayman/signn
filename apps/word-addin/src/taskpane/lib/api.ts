import { refreshIfNeeded, AuthRequiredError } from './auth';

const API_BASE: string =
  (process.env.SIGN_API_URL as string) || 'http://localhost:3000/api/v1';

export interface ApiOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  headers?: Record<string, string>;
  multipart?: FormData;
}

/**
 * Makes an authenticated request to the SIGN API.
 *
 * Proactively checks JWT expiry before sending (refreshing via
 * /auth/refresh when within 30s of expiry) per Decision 1. Never
 * waits for a reactive 401.
 *
 * Throws AuthRequiredError when the refresh token is also expired —
 * caller (taskpane root) should display the inline re-login prompt
 * without losing the rest of the taskpane state.
 */
export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const auth = await refreshIfNeeded();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    'X-Client': 'word-addin',
    ...(options.headers ?? {}),
  };

  let body: BodyInit | undefined;
  if (options.multipart) {
    body = options.multipart;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body,
  });

  if (res.status === 401) {
    throw new AuthRequiredError(
      'Server rejected token; please sign in again.',
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiBase = API_BASE;
