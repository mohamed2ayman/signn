import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import AuthLayout from '@/components/common/AuthLayout';
import FormInput from '@/components/common/FormInput';
import Button from '@/components/common/Button';
import { authService } from '@/services/auth/authService';

const ForgotPasswordPage: React.FC = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('common.required');
      return;
    }

    setIsLoading(true);
    try {
      await authService.forgotPassword({ email });
      setIsSuccess(true);
    } catch {
      // Always show success to prevent email enumeration
      setIsSuccess(true);
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
            {t('auth.forgotPasswordSuccess')}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t('auth.checkEmailDescription', 'Check your email for a link to reset your password. If it doesn\'t appear within a few minutes, check your spam folder.')}
          </p>
          <Link
            to="/auth/login"
            className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-primary-600"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('auth.backToLogin')}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="mb-6 text-center">
        <h2 className="text-xl font-semibold text-text">
          {t('auth.forgotPassword')}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          {t('auth.forgotPasswordDescription')}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
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

        <Button
          type="submit"
          fullWidth
          isLoading={isLoading}
          size="lg"
        >
          {t('auth.sendResetLink')}
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

export default ForgotPasswordPage;
