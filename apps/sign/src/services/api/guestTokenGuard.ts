/**
 * #8c Part 1 — the frontend half of the ENFORCED no-renewal guard.
 *
 * "Guests can't refresh" must not depend on which call site stored a token —
 * this is a POSITIVE check on the token itself, applied by the shared axios
 * client's 401 interceptor BEFORE any refresh attempt. A pure-guest access
 * token carries `role: "GUEST"` (the JWT has no account_type claim; role is
 * the guest-identifying claim it does carry — every pure-guest row is minted
 * with role GUEST, and a managing-as-guest keeps its real role, which is
 * correct: real accounts refresh normally).
 *
 * Defense-in-depth only — the AUTHORITATIVE guard is the backend
 * /auth/refresh rejection of GUEST account_type. Blocking here just stops the
 * client from even attempting silent renewal with a guest token.
 */
export function isGuestAccessToken(token: string | null | undefined): boolean {
  if (!token) return false;
  try {
    const seg = token.split('.')[1];
    if (!seg) return false;
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64)) as { role?: unknown };
    return payload?.role === 'GUEST';
  } catch {
    return false;
  }
}
