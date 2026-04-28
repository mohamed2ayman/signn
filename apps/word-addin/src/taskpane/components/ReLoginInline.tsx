import * as React from 'react';
import { login, verifyMfa, MfaRequiredError } from '../lib/auth';
import type { AuthState } from '../lib/auth';

interface Props {
  onSuccess: (state: AuthState) => void;
  reason?: string;
}

/**
 * Inline re-login modal — shown when JWT and refresh token are both
 * unusable. Mounted as an overlay above the active tab so taskpane
 * state (selected text, in-flight risk results, chat history) is
 * preserved underneath. Per Decision 1.
 */
export function ReLoginInline({ onSuccess, reason }: Props) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [mfaCode, setMfaCode] = React.useState('');
  const [mfaEmail, setMfaEmail] = React.useState<string | null>(null);
  const [mfaMethod, setMfaMethod] = React.useState<'totp' | 'email' | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const onSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const state = await login(email, password);
      onSuccess(state);
    } catch (err) {
      if (err instanceof MfaRequiredError) {
        setMfaEmail(err.email);
        setMfaMethod(err.method);
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const onSubmitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const state = await verifyMfa(mfaEmail!, mfaCode);
      onSuccess(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sign-relogin-overlay" role="dialog" aria-modal="true">
      <div className="sign-relogin-card">
        <div className="sign-relogin-title">Sign in to SIGN</div>
        <div className="sign-relogin-sub">
          {reason ?? 'Your session expired. Sign in to continue.'}
        </div>

        {!mfaMethod ? (
          <form onSubmit={onSubmitCredentials}>
            <input
              className="sign-input"
              type="email"
              placeholder="Email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="sign-input"
              type="password"
              placeholder="Password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="submit"
              className="sign-button"
              disabled={busy}
              style={{ width: '100%' }}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            {error && <div className="sign-error">{error}</div>}
          </form>
        ) : (
          <form onSubmit={onSubmitMfa}>
            <div className="sign-relogin-sub">
              Enter the {mfaMethod === 'totp' ? 'TOTP' : 'email'} code for{' '}
              <strong>{mfaEmail}</strong>
            </div>
            <input
              className="sign-input"
              type="text"
              inputMode="numeric"
              placeholder="6-digit code"
              autoFocus
              required
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
            />
            <button
              type="submit"
              className="sign-button"
              disabled={busy}
              style={{ width: '100%' }}
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            {error && <div className="sign-error">{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
