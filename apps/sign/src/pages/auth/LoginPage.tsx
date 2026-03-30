import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, ShieldCheck, ArrowLeft } from 'lucide-react';
import AuthLayout from '@/components/common/AuthLayout';
import FormInput from '@/components/common/FormInput';
import Button from '@/components/common/Button';
import { useAuth } from '@/hooks/useAuth';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login, verifyMfa, cancelMfa, isAuthenticated, isLoading, mfaRequired, mfaEmail, user } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated && user) {
      const role = user.role;
      if (role === 'SYSTEM_ADMIN' || role === 'OPERATIONS') {
        navigate('/admin/dashboard', { replace: true });
      } else if (role.startsWith('CONTRACTOR_')) {
        navigate('/contractor/dashboard', { replace: true });
      } else {
        navigate('/app/dashboard', { replace: true });
      }
    }
  }, [isAuthenticated, user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('errors.validation');
      return;
    }

    const result = await login(email, password);
    if (result.error) {
      setError(result.error);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!otpCode || otpCode.length !== 6) {
      setError('auth.mfaError');
      return;
    }

    const result = await verifyMfa(mfaEmail || email, otpCode);
    if (result.error) {
      setError(result.error);
    }
  };

  const handleBackToLogin = () => {
    cancelMfa();
    setOtpCode('');
    setError('');
  };

  // MFA verification view
  if (mfaRequired) {
    return (
      <AuthLayout>
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-navy-900">
            {t('auth.mfaTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t('auth.mfaDescription')}
          </p>
          <p className="mt-1 text-sm font-medium text-primary">
            {mfaEmail}
          </p>
        </div>

        <form onSubmit={handleVerifyMfa}>
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
              <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              {t(error)}
            </div>
          )}

          <div className="mb-6">
            <label
              htmlFor="otp"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              {t('auth.otpCode')}
            </label>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-center text-2xl font-mono tracking-[0.5em] text-navy-900 transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
          </div>

          <Button
            type="submit"
            fullWidth
            isLoading={isLoading}
            size="lg"
          >
            {t('auth.verifyCode')}
          </Button>

          <button
            type="button"
            onClick={handleBackToLogin}
            className="mt-4 flex w-full items-center justify-center gap-2 text-sm text-gray-500 transition-colors hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('auth.backToLogin')}
          </button>
        </form>
      </AuthLayout>
    );
  }

  // Main login view
  return (
    <AuthLayout>
      <div className="mb-6 text-center">
        <h2 className="text-xl font-bold text-navy-900">
          {t('auth.signIn')}
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          Sign in to your account to continue
        </p>
      </div>

      <form onSubmit={handleLogin}>
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
            <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {t(error)}
          </div>
        )}

        <FormInput
          label="auth.email"
          name="email"
          type="email"
          placeholder="auth.email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          icon={<Mail className="h-4 w-4" />}
          required
          autoComplete="email"
        />

        <FormInput
          label="auth.password"
          name="password"
          type="password"
          placeholder="auth.password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          icon={<Lock className="h-4 w-4" />}
          required
          autoComplete="current-password"
        />

        <div className="mb-6 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-500">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/20"
            />
            {t('auth.rememberMe')}
          </label>
          <Link
            to="/auth/forgot-password"
            className="text-sm font-medium text-primary transition-colors hover:text-primary-600"
          >
            {t('auth.forgotPassword')}
          </Link>
        </div>

        <Button
          type="submit"
          fullWidth
          isLoading={isLoading}
          size="lg"
        >
          {t('auth.signIn')}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-sm text-gray-400">
          {t('auth.noAccount')}{' '}
          <Link
            to="/auth/register"
            className="font-semibold text-primary transition-colors hover:text-primary-600"
          >
            {t('auth.signUp')}
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
};

export default LoginPage;
