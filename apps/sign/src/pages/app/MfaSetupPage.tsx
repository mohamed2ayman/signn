import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Smartphone, Mail, Copy, Check, Eye, EyeOff } from 'lucide-react';
import { authService } from '@/services/auth/authService';
import type { MfaTotpSetupResponse } from '@/services/auth/authService';
import Button from '@/components/common/Button';
import { useAuth } from '@/hooks/useAuth';

type Step = 'choose' | 'totp-scan' | 'totp-verify' | 'email-confirm' | 'show-codes';

export default function MfaSetupPage() {
  const navigate = useNavigate();
  const { user, refreshUserProfile, completeMfaSetup } = useAuth();

  const [step, setStep] = useState<Step>('choose');
  const [totpSetup, setTotpSetup] = useState<MfaTotpSetupResponse | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [codesConfirmed, setCodesConfirmed] = useState(false);

  const handleChooseTotp = async () => {
    setLoading(true);
    setError('');
    try {
      const setup = await authService.setupMfaTotp();
      setTotpSetup(setup);
      setStep('totp-scan');
    } catch {
      setError('Failed to initialize authenticator setup. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnableTotp = async () => {
    if (totpCode.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await authService.enableMfaTotp(totpCode);
      setRecoveryCodes(result.recovery_codes);
      setStep('show-codes');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Invalid code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEnableEmail = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await authService.enableMfaEmail();
      setRecoveryCodes(result.recovery_codes);
      setStep('show-codes');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || 'Failed to enable MFA.');
    } finally {
      setLoading(false);
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

  const handleDone = async () => {
    await refreshUserProfile();
    completeMfaSetup();
    navigate('/app/dashboard', { replace: true });
  };

  const role = user?.role ?? '';
  const dashboardPath = role === 'SYSTEM_ADMIN' || role === 'OPERATIONS'
    ? '/admin/dashboard'
    : role.startsWith('CONTRACTOR_')
      ? '/contractor/dashboard'
      : '/app/dashboard';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Set Up Two-Factor Authentication</h1>
          <p className="mt-2 text-sm text-gray-500">
            Your organization requires MFA for all users. Set it up to continue.
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          {/* Choose method */}
          {step === 'choose' && (
            <div className="space-y-3">
              <p className="mb-4 text-sm font-medium text-gray-700">Choose your authentication method:</p>
              <button
                onClick={handleChooseTotp}
                disabled={loading}
                className="flex w-full items-center gap-4 rounded-xl border-2 border-gray-200 p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Smartphone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Authenticator App (Recommended)</p>
                  <p className="text-sm text-gray-500">Google Authenticator, Authy, or any TOTP app.</p>
                </div>
              </button>
              <button
                onClick={() => setStep('email-confirm')}
                className="flex w-full items-center gap-4 rounded-xl border-2 border-gray-200 p-4 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50">
                  <Mail className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Email OTP</p>
                  <p className="text-sm text-gray-500">Receive a code by email each time you log in.</p>
                </div>
              </button>
            </div>
          )}

          {/* TOTP: Scan QR */}
          {step === 'totp-scan' && totpSetup && (
            <div className="space-y-5">
              <p className="text-sm text-gray-700">
                <strong>Step 1:</strong> Scan this QR code with your authenticator app.
              </p>
              <div className="flex justify-center">
                <img
                  src={totpSetup.qr_code}
                  alt="TOTP QR Code"
                  className="h-48 w-48 rounded-lg border border-gray-200"
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs text-gray-500">Or enter this key manually:</p>
                <code className="block rounded-lg bg-gray-50 px-4 py-2 text-center font-mono text-sm tracking-widest text-gray-700">
                  {totpSetup.secret}
                </code>
              </div>
              <Button onClick={() => setStep('totp-verify')} fullWidth>
                I've Scanned It → Enter Code
              </Button>
              <button onClick={() => setStep('choose')} className="w-full text-sm text-gray-400 hover:text-gray-600">
                Go back
              </button>
            </div>
          )}

          {/* TOTP: Verify */}
          {step === 'totp-verify' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                <strong>Step 2:</strong> Enter the 6-digit code from your authenticator app.
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
              <Button onClick={handleEnableTotp} isLoading={loading} fullWidth>
                Confirm and Enable MFA
              </Button>
              <button onClick={() => setStep('totp-scan')} className="w-full text-sm text-gray-400 hover:text-gray-600">
                Go back
              </button>
            </div>
          )}

          {/* Email: Confirm */}
          {step === 'email-confirm' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                A 6-digit code will be sent to <strong>{user?.email}</strong> every time you log in.
              </p>
              <Button onClick={handleEnableEmail} isLoading={loading} fullWidth>
                Enable Email OTP
              </Button>
              <button onClick={() => setStep('choose')} className="w-full text-sm text-gray-400 hover:text-gray-600">
                Go back
              </button>
            </div>
          )}

          {/* Show Recovery Codes */}
          {step === 'show-codes' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-800">Save your recovery codes now</p>
                <p className="mt-1 text-sm text-amber-700">
                  These 8 single-use backup codes let you access your account if you lose your MFA device. <strong>They won't be shown again.</strong>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map((code) => (
                  <button
                    key={code}
                    onClick={() => handleCopyCode(code)}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-700 hover:border-primary hover:bg-primary/5"
                  >
                    {code}
                    {copiedCode === code
                      ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                      : <Copy className="h-3.5 w-3.5 text-gray-400" />}
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
                  className="h-4 w-4 rounded border-gray-300 text-primary"
                />
                I have saved my recovery codes in a safe place
              </label>
              <Button onClick={handleDone} disabled={!codesConfirmed} fullWidth>
                Complete Setup
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
