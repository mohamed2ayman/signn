import * as React from 'react';
import { login, verifyMfa, MfaRequiredError } from '../lib/auth';
import type { AuthState } from '../lib/auth';

interface Props {
  onAuth: (state: AuthState) => void;
}

export function LoginTab({ onAuth }: Props) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [mfaEmail, setMfaEmail] = React.useState<string | null>(null);
  const [mfaMethod, setMfaMethod] = React.useState<'totp' | 'email' | null>(
    null,
  );
  const [mfaCode, setMfaCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const state = await login(email, password);
      onAuth(state);
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

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const state = await verifyMfa(mfaEmail!, mfaCode);
      onAuth(state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA verification failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sign-card" style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>Sign in to SIGN</h3>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
        Use the same account you use for the SIGN web app.
      </div>

      {!mfaMethod ? (
        <form onSubmit={submit}>
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
        <form onSubmit={submitMfa}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
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
  );
}
