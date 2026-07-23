import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import axios from 'axios';
import { Eye, EyeOff } from 'lucide-react';
import ModalShell from '@/components/obligations/ModalShell';
import {
  establishGuestIdentity,
  type GuestIdentity,
} from '@/services/api/guestService';

// Canonical SIGN password rule (mirrors RegisterPage.tsx + the backend DTO):
// ≥12 chars, ≥1 uppercase, ≥1 digit, ≥1 special character.
const PASSWORD_RE =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{12,}$/;

/**
 * Progressive-identity step, in two modes driven by exchange's
 * `account_exists` (#8c Part 1):
 *
 * CREATE (returning=false): a first-time guest SETS a password to gain a
 * durable (restricted) identity — name fields, password + confirm, the
 * complexity hint, autoComplete="new-password".
 *
 * RETURNING (returning=true): the invited email already has a SIGN account —
 * prompt for the EXISTING password only (no names, no confirm, no complexity
 * pre-check: the account's password already satisfied policy when it was set),
 * autoComplete="current-password". A 401 here means WRONG PASSWORD and is
 * recoverable inline — unlike create mode, where a 401 is a terminal token
 * failure (the invitation itself is unusable).
 *
 * On success the caller receives the GUEST JWT pair; the page hydrates the
 * shared auth store (access token only) and routes returning guests to the
 * dashboard while first-timers stay on the contract.
 */
export default function EstablishIdentityModal({
  isOpen,
  onClose,
  token,
  invitedEmail,
  returning = false,
  onEstablished,
  onUnusable,
}: {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  invitedEmail?: string | null;
  /** The invited email already has a SIGN account (exchange `account_exists`). */
  returning?: boolean;
  onEstablished: (identity: GuestIdentity) => void;
  /**
   * Fired when establish-identity reports a TERMINAL token failure (the
   * invitation can no longer be used to set up access — already used,
   * expired, or revoked). The page uses this to swap the "Set a password
   * to comment" CTA for a friendly note so the doomed form can't be
   * re-opened. Never fired for a returning guest's wrong password — that
   * is recoverable inline.
   */
  onUnusable?: () => void;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Terminal state: the invitation can no longer establish identity. The
  // form is replaced by a friendly, no-leak message and submit is removed —
  // a form that cannot possibly succeed must not stay fillable/submittable.
  const [blocked, setBlocked] = useState(false);
  // Unified membership: the invited email belongs to an existing SIGN account
  // WITH MFA — the binding was attached, but no session is minted here. The
  // user signs in through the normal login (MFA honoured); their account now
  // has access to this contract.
  const [linked, setLinked] = useState(false);

  const reset = () => {
    setFirstName('');
    setLastName('');
    setPassword('');
    setConfirm('');
    setShowPassword(false);
    setShowConfirm(false);
    setError('');
    setSubmitting(false);
    setBlocked(false);
    setLinked(false);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = async () => {
    setError('');
    if (returning) {
      // Their password already exists — the only client-side gate is presence.
      // Re-running the complexity regex against an EXISTING password would
      // block legitimate sign-ins for nothing (the server verifies the hash).
      if (!password) {
        setError(t('guest.identity.errors.wrongPassword'));
        return;
      }
    } else {
      if (!PASSWORD_RE.test(password)) {
        setError(t('guest.identity.errors.weakPassword'));
        return;
      }
      if (password !== confirm) {
        setError(t('guest.identity.errors.mismatch'));
        return;
      }
    }
    setSubmitting(true);
    try {
      const identity = await establishGuestIdentity({
        token,
        password,
        // Names are only meaningful when CREATING the identity — the backend
        // ignores them for an existing account.
        first_name: returning ? undefined : firstName.trim() || undefined,
        last_name: returning ? undefined : lastName.trim() || undefined,
      });
      if (identity.requires_login || !identity.access_token) {
        // Unified membership — existing account with MFA: the binding is
        // attached but no tokens are issued here. Show the "linked" state;
        // the user signs in with their real account to access the contract.
        setSubmitting(false);
        setLinked(true);
        return;
      }
      toast.success(
        t(returning ? 'guest.identity.returning.success' : 'guest.identity.success'),
      );
      reset();
      onEstablished(identity);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 401 && returning) {
        // RETURNING mode: exchange just proved this email HAS an account, so a
        // 401 here overwhelmingly means "wrong password" — recoverable. Keep
        // the form so the guest can retype (the shared account lockout still
        // caps attempts at 5; a lockout surfaces as 403 below).
        setError(t('guest.identity.errors.wrongPassword'));
        setSubmitting(false);
        return;
      }
      if (status === 401 || status === 404) {
        // TERMINAL (create mode). The backend returns a single generic 401
        // for every "this invitation can't establish identity" axis
        // (invalid/expired/revoked token). We can't tell them apart — and
        // must not — so we stop the form here instead of letting the user
        // re-submit into the same wall. The page swaps the CTA too.
        setBlocked(true);
        setError('');
        setSubmitting(false);
        onUnusable?.();
        return;
      }
      if (status === 403) {
        // Account-level lockout — the invited email belongs to an account that
        // has hit the failed-attempt threshold (the SAME lockout the login path
        // enforces). Recoverable once the lock window elapses; keep the form.
        setError(t('guest.identity.errors.accountLocked'));
        setSubmitting(false);
        return;
      }
      if (status === 409) {
        // Concurrent-establish collision (UNIQUE-key race) — retrying lands on
        // the race-guard branch, so keep the form submittable.
        setError(t('guest.identity.errors.conflict'));
      } else if (status === 429) {
        setError(t('guest.identity.errors.throttled'));
      } else {
        // 400 / network / 5xx — recoverable; keep the form submittable.
        setError(t('guest.identity.errors.generic'));
      }
      setSubmitting(false);
    }
  };

  const passwordToggle = (shown: boolean, flip: () => void) => (
    <button
      type="button"
      onClick={flip}
      className="absolute top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-600 ltr:right-3 rtl:left-3"
      tabIndex={-1}
      aria-label={t(shown ? 'guest.identity.hidePassword' : 'guest.identity.showPassword')}
    >
      {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={close}
      title={t(returning ? 'guest.identity.returning.title' : 'guest.identity.title')}
      subtitle={
        returning
          ? t('guest.identity.returning.subtitle')
          : invitedEmail
            ? t('guest.identity.subtitleEmail', { email: invitedEmail })
            : t('guest.identity.subtitle')
      }
      size="sm"
      footer={
        linked ? (
          <>
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              {t('guest.identity.blocked.dismiss')}
            </button>
            <a
              href="/auth/login"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
            >
              {t('guest.identity.linked.cta')}
            </a>
          </>
        ) : blocked ? (
          <button
            type="button"
            onClick={close}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
          >
            {t('guest.identity.blocked.dismiss')}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={close}
              disabled={submitting}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('guest.identity.cancel')}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-60"
            >
              {submitting
                ? t('guest.identity.submitting')
                : t(returning ? 'guest.identity.returning.submit' : 'guest.identity.submit')}
            </button>
          </>
        )
      }
    >
      {linked ? (
        <div className="py-2 text-center">
          <div className="mb-3 text-4xl" aria-hidden="true">
            ✅
          </div>
          <h3 className="text-base font-semibold text-gray-900" dir="auto">
            {t('guest.identity.linked.title')}
          </h3>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-gray-500" dir="auto">
            {t('guest.identity.linked.body')}
          </p>
        </div>
      ) : blocked ? (
        <div className="py-2 text-center">
          <div className="mb-3 text-4xl" aria-hidden="true">
            🔒
          </div>
          <h3 className="text-base font-semibold text-gray-900" dir="auto">
            {t('guest.identity.blocked.title')}
          </h3>
          <p
            className="mx-auto mt-1.5 max-w-sm text-sm text-gray-500"
            dir="auto"
            role="alert"
          >
            {t('guest.identity.blocked.body')}
          </p>
        </div>
      ) : (
      <div className="space-y-4">
        {!returning && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {t('guest.identity.firstName')}{' '}
                <span className="text-gray-400">{t('guest.identity.optional')}</span>
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={100}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                dir="auto"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {t('guest.identity.lastName')}{' '}
                <span className="text-gray-400">{t('guest.identity.optional')}</span>
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={100}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                dir="auto"
              />
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t('guest.identity.password')}</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={returning ? 'current-password' : 'new-password'}
              onKeyDown={
                returning
                  ? (e) => {
                      if (e.key === 'Enter') submit();
                    }
                  : undefined
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none ltr:pr-10 rtl:pl-10"
            />
            {passwordToggle(showPassword, () => setShowPassword((s) => !s))}
          </div>
          {!returning && (
            <p className="mt-1 text-xs text-gray-400">
              {t('guest.identity.passwordHint')}
            </p>
          )}
        </div>

        {!returning && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('guest.identity.confirmPassword')}</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none ltr:pr-10 rtl:pl-10"
              />
              {passwordToggle(showConfirm, () => setShowConfirm((s) => !s))}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
      )}
    </ModalShell>
  );
}
