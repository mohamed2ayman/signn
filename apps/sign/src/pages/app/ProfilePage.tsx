import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldOff, Smartphone, Mail, Eye, EyeOff, Copy, Check } from 'lucide-react';
import api from '@/services/api/axios';
import { authService } from '@/services/auth/authService';
import type { MfaStatusResponse, MfaTotpSetupResponse } from '@/services/auth/authService';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import Button from '@/components/common/Button';
import type { User } from '@/types';
import { JOB_TITLES } from '@/types';

type MfaSetupStep =
  | 'idle'
  | 'choose-method'
  | 'totp-scan'
  | 'totp-verify'
  | 'email-confirm'
  | 'show-codes'
  | 'disable-confirm';

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    preferred_language: 'en',
    job_title: '',
  });

  // MFA state
  const [mfaStatus, setMfaStatus] = useState<MfaStatusResponse | null>(null);
  const [mfaStep, setMfaStep] = useState<MfaSetupStep>('idle');
  const [totpSetup, setTotpSetup] = useState<MfaTotpSetupResponse | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mfaError, setMfaError] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [codesConfirmed, setCodesConfirmed] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<User>('/users/me'),
      authService.getMfaStatus(),
    ])
      .then(([userRes, mfaRes]) => {
        const u = userRes.data;
        setUser(u);
        setForm({
          first_name: u.first_name || '',
          last_name: u.last_name || '',
          preferred_language: u.preferred_language || 'en',
          job_title: u.job_title || '',
        });
        setMfaStatus(mfaRes);
      })
      .catch(() => setError('Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await api.put<User>('/users/me', form);
      setUser(response.data);
      setSuccess('Profile updated successfully');
    } catch {
      setError('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  // ─── MFA Handlers ────────────────────────────────────────────

  const handleStartSetup = () => {
    setMfaError('');
    setMfaStep('choose-method');
  };

  const handleChooseTotp = async () => {
    setMfaLoading(true);
    setMfaError('');
    try {
      const setup = await authService.setupMfaTotp();
      setTotpSetup(setup);
      setMfaStep('totp-scan');
    } catch {
      setMfaError('Failed to initialize authenticator setup. Try again.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleChooseEmail = () => {
    setMfaStep('email-confirm');
  };

  const handleEnableTotp = async () => {
    if (totpCode.length !== 6) {
      setMfaError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setMfaLoading(true);
    setMfaError('');
    try {
      const result = await authService.enableMfaTotp(totpCode);
      setRecoveryCodes(result.recovery_codes);
      setMfaStep('show-codes');
      setMfaStatus((s) => s ? { ...s, mfa_enabled: true, mfa_method: 'totp' } : s);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMfaError(e.response?.data?.message || 'Invalid code. Try again.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleEnableEmail = async () => {
    setMfaLoading(true);
    setMfaError('');
    try {
      const result = await authService.enableMfaEmail();
      setRecoveryCodes(result.recovery_codes);
      setMfaStep('show-codes');
      setMfaStatus((s) => s ? { ...s, mfa_enabled: true, mfa_method: 'email' } : s);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMfaError(e.response?.data?.message || 'Failed to enable MFA.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleDisableMfa = async () => {
    if (!disablePassword) {
      setMfaError('Enter your password to disable MFA.');
      return;
    }
    setMfaLoading(true);
    setMfaError('');
    try {
      await authService.disableMfa(disablePassword);
      setMfaStatus((s) => s ? { ...s, mfa_enabled: false, mfa_method: null, recovery_codes_count: 0 } : s);
      setMfaStep('idle');
      setDisablePassword('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMfaError(e.response?.data?.message || 'Incorrect password.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleCopyAll = () => {
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopiedCode('all');
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleDoneShowingCodes = () => {
    setMfaStep('idle');
    setRecoveryCodes([]);
    setCodesConfirmed(false);
    setTotpCode('');
    setTotpSetup(null);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Profile Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your personal information and job title.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
      )}
      {success && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-600">{success}</div>
      )}

      {/* ── Profile Form ── */}
      <form onSubmit={handleSave}>
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">First Name</label>
                <input
                  type="text"
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">Last Name</label>
                <input
                  type="text"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                disabled
                value={user?.email || ''}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">System Role</label>
              <input
                type="text"
                disabled
                value={user?.role?.replace(/_/g, ' ') || ''}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Job Title</label>
              <select
                value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select a job title...</option>
                {JOB_TITLES.map((jt) => (
                  <option key={jt} value={jt}>{jt}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">
                Your job title determines your default permission level when added to projects.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">Preferred Language</label>
              <select
                value={form.preferred_language}
                onChange={(e) => setForm({ ...form, preferred_language: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="en">English</option>
                <option value="ar">Arabic</option>
                <option value="fr">French</option>
              </select>
            </div>
          </div>

          <div className="mt-8 flex justify-end">
            <Button type="submit" isLoading={saving}>Save Changes</Button>
          </div>
        </div>
      </form>

      {/* ── MFA Settings ── */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-8 py-5">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${mfaStatus?.mfa_enabled ? 'bg-emerald-100' : 'bg-gray-100'}`}>
              {mfaStatus?.mfa_enabled
                ? <ShieldCheck className="h-5 w-5 text-emerald-600" />
                : <ShieldOff className="h-5 w-5 text-gray-400" />
              }
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Two-Factor Authentication</h2>
              <p className="text-sm text-gray-500">
                {mfaStatus?.mfa_enabled
                  ? `Enabled · ${mfaStatus.mfa_method === 'totp' ? 'Authenticator App' : 'Email OTP'} · ${mfaStatus.recovery_codes_count} recovery code${mfaStatus.recovery_codes_count !== 1 ? 's' : ''} remaining`
                  : 'Add an extra layer of security to your account.'}
              </p>
            </div>
          </div>
          {mfaStatus?.mfa_enabled && mfaStep === 'idle' && (
            <button
              onClick={() => { setMfaStep('disable-confirm'); setMfaError(''); }}
              className="text-sm font-medium text-red-500 hover:text-red-600"
            >
              Disable
            </button>
          )}
        </div>

        <div className="px-8 py-6">
          {mfaError && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{mfaError}</div>
          )}

          {/* ── Idle: prompt to enable ── */}
          {mfaStep === 'idle' && !mfaStatus?.mfa_enabled && (
            <div className="text-center">
              <p className="mb-4 text-sm text-gray-500">
                Protect your account with two-factor authentication. Choose between an authenticator app (TOTP) or email-based OTP.
              </p>
              <Button onClick={handleStartSetup}>Enable Two-Factor Authentication</Button>
            </div>
          )}

          {/* ── Idle: already enabled ── */}
          {mfaStep === 'idle' && mfaStatus?.mfa_enabled && (
            <p className="text-sm text-gray-500">
              Your account is protected with two-factor authentication. To switch methods, disable MFA first and re-enable with your preferred method.
            </p>
          )}

          {/* ── Choose method ── */}
          {mfaStep === 'choose-method' && (
            <div className="space-y-3">
              <p className="mb-4 text-sm font-medium text-gray-700">Choose your authentication method:</p>
              <button
                onClick={handleChooseTotp}
                disabled={mfaLoading}
                className="flex w-full items-center gap-4 rounded-xl border-2 border-gray-200 p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Smartphone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Authenticator App (TOTP)</p>
                  <p className="text-sm text-gray-500">Use Google Authenticator, Authy, or any TOTP app. Most secure.</p>
                </div>
              </button>
              <button
                onClick={handleChooseEmail}
                className="flex w-full items-center gap-4 rounded-xl border-2 border-gray-200 p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                  <Mail className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Email OTP</p>
                  <p className="text-sm text-gray-500">Receive a one-time code by email each time you log in.</p>
                </div>
              </button>
              <button
                onClick={() => setMfaStep('idle')}
                className="mt-2 text-sm text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          )}

          {/* ── TOTP: Scan QR ── */}
          {mfaStep === 'totp-scan' && totpSetup && (
            <div className="space-y-5">
              <div>
                <p className="mb-3 text-sm text-gray-700">
                  <strong>Step 1:</strong> Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.).
                </p>
                <div className="flex justify-center">
                  <img
                    src={totpSetup.qr_code}
                    alt="TOTP QR Code"
                    className="h-48 w-48 rounded-lg border border-gray-200"
                  />
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-sm text-gray-500">Or enter this secret key manually:</p>
                <code className="block rounded-lg bg-gray-50 px-4 py-2 text-center font-mono text-sm tracking-widest text-gray-700">
                  {totpSetup.secret}
                </code>
              </div>
              <Button onClick={() => setMfaStep('totp-verify')} fullWidth>
                I've Scanned It → Enter Code
              </Button>
              <button
                onClick={() => setMfaStep('choose-method')}
                className="w-full text-sm text-gray-400 hover:text-gray-600"
              >
                Go back
              </button>
            </div>
          )}

          {/* ── TOTP: Verify Code ── */}
          {mfaStep === 'totp-verify' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                <strong>Step 2:</strong> Enter the 6-digit code shown in your authenticator app to confirm setup.
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-center font-mono text-2xl tracking-[0.5em] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                autoFocus
              />
              <Button onClick={handleEnableTotp} isLoading={mfaLoading} fullWidth>
                Confirm and Enable MFA
              </Button>
              <button
                onClick={() => setMfaStep('totp-scan')}
                className="w-full text-sm text-gray-400 hover:text-gray-600"
              >
                Go back
              </button>
            </div>
          )}

          {/* ── Email: Confirm ── */}
          {mfaStep === 'email-confirm' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                Email OTP will send a 6-digit code to <strong>{user?.email}</strong> every time you log in. Continue?
              </p>
              <Button onClick={handleEnableEmail} isLoading={mfaLoading} fullWidth>
                Enable Email OTP
              </Button>
              <button
                onClick={() => setMfaStep('choose-method')}
                className="w-full text-sm text-gray-400 hover:text-gray-600"
              >
                Go back
              </button>
            </div>
          )}

          {/* ── Show Recovery Codes ── */}
          {mfaStep === 'show-codes' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-800">Save your recovery codes</p>
                <p className="mt-1 text-sm text-amber-700">
                  These 8 single-use codes let you access your account if you lose access to your MFA method. <strong>Store them somewhere safe — they won't be shown again.</strong>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map((code) => (
                  <button
                    key={code}
                    onClick={() => handleCopyCode(code)}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-700 transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    {code}
                    {copiedCode === code
                      ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                      : <Copy className="h-3.5 w-3.5 text-gray-400" />
                    }
                  </button>
                ))}
              </div>
              <button
                onClick={handleCopyAll}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                {copiedCode === 'all' ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                Copy all codes
              </button>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={codesConfirmed}
                  onChange={(e) => setCodesConfirmed(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/20"
                />
                I have saved my recovery codes in a safe place
              </label>
              <Button
                onClick={handleDoneShowingCodes}
                disabled={!codesConfirmed}
                fullWidth
              >
                Done — I've Saved My Codes
              </Button>
            </div>
          )}

          {/* ── Disable Confirm ── */}
          {mfaStep === 'disable-confirm' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                To disable two-factor authentication, enter your account password to confirm.
              </p>
              <div className="relative">
                <input
                  type={showDisablePassword ? 'text' : 'password'}
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  placeholder="Your password"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 pr-10 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowDisablePassword(!showDisablePassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showDisablePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                onClick={handleDisableMfa}
                isLoading={mfaLoading}
                fullWidth
                className="bg-red-600 hover:bg-red-700"
              >
                Disable Two-Factor Authentication
              </Button>
              <button
                onClick={() => { setMfaStep('idle'); setDisablePassword(''); setMfaError(''); }}
                className="w-full text-sm text-gray-400 hover:text-gray-600"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
