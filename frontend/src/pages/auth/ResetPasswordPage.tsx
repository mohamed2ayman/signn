import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft, CheckCircle } from 'lucide-react';
import AuthLayout from '@/components/common/AuthLayout';
import FormInput from '@/components/common/FormInput';
import Button from '@/components/common/Button';
import { authService } from '@/services/auth/authService';

const ResetPasswordPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError('common.required');
      return;
    }

    if (!/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/.test(password)) {
      setError('auth.passwordRequirements');
      return;
    }

    if (password !== confirmPassword) {
      setError('auth.passwordMismatch');
      return;
    }

    if (!token) {
      setError('auth.invalidToken');
      return;
    }

    setIsLoading(true);
    try {
      await authService.resetPassword({ token, password });
      setIsSuccess(true);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { message?: string } } };
      setError(error.response?.data?.message || 'errors.generic');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <AuthLayout>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
            <CheckCircle className="h-7 w-7 text-success" />
          </div>
          <h2 className="text-xl font-semibold text-text">
            {t('auth.resetPasswordSuccess')}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t('auth.canLoginNow', 'You can now log in with your new password.')}
          </p>
          <Button
            onClick={() => navigate('/auth/login')}
            className="mt-6"
          >
            {t('auth.signIn')}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  if (!token) {
    return (
      <AuthLayout>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-danger">
            {t('auth.invalidToken', 'Invalid or expired link')}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t('auth.invalidTokenDescription', 'This password reset link is invalid or has expired. Please request a new one.')}
          </p>
          <Link
            to="/auth/forgot-password"
            className="mt-4 inline-block text-sm font-medium text-primary transition-colors hover:text-primary-600"
          >
            {t('auth.forgotPassword')}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-6 text-center">
        <h2 className="text-xl font-semibold text-text">
          {t('auth.resetPassword')}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {t('auth.resetPasswordDescription', 'Enter your new password below.')}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
            {t(error)}
          </div>
        )}

        <FormInput
          label="auth.password"
          name="password"
          type="password"
          placeholder="auth.password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          icon={<Lock className="h-4 w-4" />}
          required
          autoComplete="new-password"
        />

        <FormInput
          label="auth.confirmPassword"
          name="confirmPassword"
          type="password"
          placeholder="auth.confirmPassword"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          icon={<Lock className="h-4 w-4" />}
          required
          autoComplete="new-password"
        />

        <p className="mb-4 -mt-2 text-xs text-gray-400">
          {t('auth.passwordHint', 'Min 8 characters, 1 uppercase, 1 number, 1 special character')}
        </p>

        <Button
          type="submit"
          fullWidth
          isLoading={isLoading}
          size="lg"
        >
          {t('auth.resetPassword')}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link
          to="/auth/login"
          className="inline-flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('auth.backToLogin')}
        </Link>
      </div>
    </AuthLayout>
  );
};

export default ResetPasswordPage;
