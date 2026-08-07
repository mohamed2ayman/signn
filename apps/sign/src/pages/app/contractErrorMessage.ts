/**
 * ONE error-discrimination path for every write on ContractDetailPage.
 *
 * The page had 13 mutations whose catch blocks were `console.error` only, so a
 * failed action was indistinguishable from a click that never registered. This
 * maps a thrown request error onto an i18n KEY, following the house pattern
 * established by GuestComments (`toast.error(t('<ns>.errors.<case>'))`,
 * discriminated by HTTP status — see GuestComments.tsx:100-109).
 *
 * Why a helper rather than 13 inline if/else ladders: the discrimination is
 * identical everywhere (locked / forbidden / offline / everything-else), and
 * only the *fallback* differs per action. Keeping it in one place means a new
 * backend error code is wired once.
 *
 * Keys are returned, never messages — the caller runs them through `t()` so the
 * string resolves in the user's locale (en/ar/fr). Never hand a raw server
 * message to the UI: it is unlocalized and can leak internals.
 */

/** Shape we read off an axios-style rejection without importing axios. */
type RequestErrorish = {
  response?: { status?: number; data?: { error?: string } };
};

export const CONTRACT_ERROR_KEYS = {
  // Shared across every handler — the discrimination below picks these.
  generic: 'contract.errors.generic',
  permission: 'contract.errors.permission',
  locked: 'contract.errors.locked',
  network: 'contract.errors.network',
  // Action-specific fallbacks. Deliberately only FOUR: added solely where the
  // generic "something went wrong" would leave the user unable to tell what
  // state they are now in, or unable to act. Everything else reuses `generic`
  // rather than shipping thirteen near-duplicate strings to three locales.
  shareFailed: 'contract.errors.shareFailed',
  revokeFailed: 'contract.errors.revokeFailed',
  signatureFailed: 'contract.errors.signatureFailed',
  exportFailed: 'contract.errors.exportFailed',
} as const;

/**
 * Map a caught error to the i18n key that should be shown to the user.
 *
 * @param err      the caught value (unknown — never assume it is an Error)
 * @param fallback key to use when nothing more specific applies. Pass an
 *                 action-specific key only where "something went wrong" would
 *                 leave the user genuinely stuck (share, revoke, signature,
 *                 export); otherwise let it default to the generic message.
 */
export function contractErrorKey(
  err: unknown,
  fallback: string = CONTRACT_ERROR_KEYS.generic,
): string {
  const res = (err as RequestErrorish | null | undefined)?.response;

  // No response at all = the request never reached the server (offline, DNS,
  // CORS, timeout). Telling the user to check their connection is actionable;
  // "something went wrong" is not.
  if (!res) return CONTRACT_ERROR_KEYS.network;

  // Signed-state pinning (409 CONTRACT_PINNED). Key on the machine-readable
  // CODE, never the message — lesson #220, same as handleMarkSigned.
  if (res.data?.error === 'CONTRACT_PINNED') return CONTRACT_ERROR_KEYS.locked;

  if (res.status === 401 || res.status === 403) {
    return CONTRACT_ERROR_KEYS.permission;
  }

  return fallback;
}
