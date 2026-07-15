import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import axios from 'axios';
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
 * Progressive-identity step: a guest sets a password to gain a durable
 * (restricted) identity so they can leave attributed comments. On success the
 * caller receives the GUEST JWT pair and transitions the page into the
 * "identity established" state. The JWT is held in page state only — never the
 * app store.
 */
export default function EstablishIdentityModal({
  isOpen,
  onClose,
  token,
  invitedEmail,
  onEstablished,
  onUnusable,
}: {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  invitedEmail?: string | null;
  onEstablished: (identity: GuestIdentity) => void;
  /**
   * Fired when establish-identity reports a TERMINAL token failure (the
   * invitation can no longer be used to set up access — already used,
   * expired, revoked, or the supplied password doesn't match an identity
   * already established with this invitation). The page uses this to swap
   * the "Set a password to comment" CTA for a friendly note so the doomed
   * form can't be re-opened.
   */
  onUnusable?: () => void;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    if (!PASSWORD_RE.test(password)) {
      setError(t('guest.identity.errors.weakPassword'));
      return;
    }
    if (password !== confirm) {
      setError(t('guest.identity.errors.mismatch'));
      return;
    }
    setSubmitting(true);
    try {
      const identity = await establishGuestIdentity({
        token,
        password,
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
      });
      if (identity.requires_login || !identity.access_token) {
        // Unified membership — existing account with MFA: the binding is
        // attached but no tokens are issued here. Show the "linked" state;
        // the user signs in with their real account to access the contract.
        setSubmitting(false);
        setLinked(true);
        return;
      }
      toast.success(t('guest.identity.success'));
      reset();
      onEstablished(identity);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 401 || status === 404) {
        // TERMINAL. The backend returns a single generic 401 for every
        // "this invitation can't establish identity" axis (invalid/expired/
        // revoked token, or a password that doesn't match an identity
        // already set up with this invitation). We can't tell them apart —
        // and must not — so we stop the form here instead of letting the
        // user re-submit into the same wall. The page swaps the CTA too.
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
        // The backend distinguishes two 409 axes by CODE (the message
        // field is never displayed — copy lives in i18n, keyed on the
        // code): EXISTING_ACCOUNT_EMAIL = the invited email belongs to a
        // real (non-guest) SIGN account, so no password can ever succeed
        // here; anything else = the established-guest password conflict.
        const code = axios.isAxiosError(err)
          ? (err.response?.data as { error?: string } | undefined)?.error
          : undefined;
        setError(
          code === 'EXISTING_ACCOUNT_EMAIL'
            ? t('guest.identity.errors.existingAccount')
            : t('guest.identity.errors.conflict'),
        );
      } else if (status === 429) {
        setError(t('guest.identity.errors.throttled'));
      } else {
        // 400 / network / 5xx — recoverable; keep the form submittable.
        setError(t('guest.identity.errors.generic'));
      }
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={close}
      title={t('guest.identity.title')}
      subtitle={
        invitedEmail
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
              {submitting ? t('guest.identity.submitting') : t('guest.identity.submit')}
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

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t('guest.identity.password')}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            {t('guest.identity.passwordHint')}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">{t('guest.identity.confirmPassword')}</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </div>

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
