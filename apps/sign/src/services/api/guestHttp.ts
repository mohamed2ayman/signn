import axios from 'axios';

const API_BASE_URL =
  import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

/**
 * Bare axios instance for the PUBLIC Guest Portal flows (exchange,
 * establish-identity, viewer read, guest comment).
 *
 * CRITICAL — this instance is DELIBERATELY isolated from the app's shared
 * `@/services/api/axios` client:
 *   • It has NO request interceptor, so it NEVER attaches the managing-user
 *     Redux Bearer token to a guest/viewer call.
 *   • It has NO 401 response interceptor, so a viewer-credential expiry
 *     (15-min TTL) NEVER triggers the app's refresh-token rotation or the
 *     `window.location.href = '/auth/login'` redirect that lives on the
 *     shared client.
 *
 * Every guest/viewer credential is passed EXPLICITLY per request via the
 * `Authorization` header (`Viewer <viewer_token>` or `Bearer <guest_jwt>`),
 * so no credential can leak onto a normal API call and no normal credential
 * can leak onto a guest call. See `viewerService.ts` / `guestService.ts`.
 */
export const guestHttp = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

export const GUEST_API_BASE_URL = API_BASE_URL;
